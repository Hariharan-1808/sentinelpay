import { GoogleGenAI, Type } from "@google/genai";
import { searchReplacementParts } from "./catalog.js";
import {
  captureHitlOrder,
  createHitlOrder,
  sendAutonomousPayout,
} from "./paypal.js";
import { evaluateProcurementPolicy } from "./policy.js";
import {
  appendRecord,
  getPolicy,
  getRecord,
  getTodaySpentUsd,
  updateRecord,
} from "./store.js";
import type {
  CatalogCandidate,
  DiagnosisResult,
  IoTNode,
  ProcurementRecord,
} from "./types.js";

function getGeminiClient(): { ai: GoogleGenAI; models: string[] } {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Missing GEMINI_API_KEY in .env. Get a free key at https://aistudio.google.com/apikey"
    );
  }
  const preferred =
    process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
  const fallbacks = [
    preferred,
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-flash-lite-latest",
  ];
  return {
    ai: new GoogleGenAI({ apiKey, httpOptions: { timeout: 20000 } }),
    models: Array.from(new Set(fallbacks)),
  };
}

function formatModelError(model: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `[${model}] ${msg.slice(0, 180)}`;
}

async function callSingleGemini<T>(
  ai: GoogleGenAI,
  model: string,
  contents: string,
  responseSchema: Record<string, unknown>
): Promise<T> {
  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      responseMimeType: "application/json",
      responseSchema,
    },
  });
  if (!response.text) {
    throw new Error(`Model ${model} returned an empty response.`);
  }
  return JSON.parse(response.text) as T;
}

async function generateStructuredJson<T>(
  contents: string,
  responseSchema: Record<string, unknown>
): Promise<T> {
  const { ai, models } = getGeminiClient();
  const [primary, ...backups] = models;

  try {
    return await callSingleGemini<T>(ai, primary, contents, responseSchema);
  } catch (primaryErr) {
    console.warn(`Primary model ${primary} failed, racing backups:`, primaryErr);
    if (backups.length === 0) throw primaryErr;
    try {
      return await Promise.any(
        backups.map((model) =>
          callSingleGemini<T>(ai, model, contents, responseSchema)
        )
      );
    } catch (aggErr) {
      const details = [formatModelError(primary, primaryErr)];
      if (aggErr instanceof AggregateError) {
        aggErr.errors.forEach((e, idx) =>
          details.push(formatModelError(backups[idx] || `backup-${idx}`, e))
        );
      } else {
        details.push(formatModelError("backups", aggErr));
      }
      throw new Error(`Gemini calls failed: ${details.join(" | ")}`);
    }
  }
}

/**
 * Analyzes multi-signal IoT telemetry history against baseline using Gemini
 * structured output to diagnose hardware degradation and recommend a part query.
 */
export async function diagnoseNodeTelemetry(
  node: IoTNode
): Promise<DiagnosisResult> {
  const recent = node.history.slice(-8);

  const prompt = [
    `You are SentinelPay's predictive maintenance AI for industrial IoT hardware.`,
    `Machine: ${node.name} (${node.machineType}) at ${node.location}, uptime ${node.uptimeHours}h.`,
    `Normal Baseline: tempC=${node.baseline.tempC}, vibrationMmS=${node.baseline.vibrationMmS}, fanRpm=${node.baseline.fanRpm}, currentAmps=${node.baseline.currentAmps}.`,
    `Recent Telemetry Trend (oldest -> newest):`,
    JSON.stringify(recent),
    ``,
    `Instructions:`,
    `- Determine if an actionable hardware fault is occurring based on multi-signal drift vs baseline.`,
    `- Signature 1 (Fan Bearing Wear): cooling fan RPM collapsed (<50% of baseline) while currentAmps stayed near baseline (<1.4x baseline) and temperature climbed moderately. Diagnose "Cooling Fan Assembly", set severity="MEDIUM", confidence>=0.90, and recommendedPartQuery="24v brushless cooling fan 80mm".`,
    `- Signature 2 (Controller / Power Fault): currentAmps spiked heavily (>=1.8x baseline) with extreme vibration (>=3x baseline) and severe over-temperature while fan is still spinning. Diagnose "Spindle Power & Motor Controller", set severity="CRITICAL", confidence>=0.90, and recommendedPartQuery="24v industrial power supply DIN rail".`,
    `- Signature 3 (Ambiguous Drift): minor noisy fluctuations without a clear physical fault signature. Set severity="LOW", confidence<=0.72 so spending guardrails trigger human inspection.`,
    `- Return confidence as a number between 0 and 1.`,
  ].join("\n");

  const parsed = await generateStructuredJson<DiagnosisResult>(prompt, {
    type: Type.OBJECT,
    properties: {
      actionNeeded: { type: Type.BOOLEAN },
      failingComponent: { type: Type.STRING },
      severity: {
        type: Type.STRING,
        enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      },
      confidence: { type: Type.NUMBER },
      reasoning: { type: Type.STRING },
      recommendedPartQuery: { type: Type.STRING },
      estimatedFailureWindowHours: { type: Type.NUMBER },
    },
    required: [
      "actionNeeded",
      "failingComponent",
      "severity",
      "confidence",
      "reasoning",
      "recommendedPartQuery",
      "estimatedFailureWindowHours",
    ],
  });

  parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence)));
  return parsed;
}

async function selectBestCandidate(
  diagnosis: DiagnosisResult,
  candidates: CatalogCandidate[]
): Promise<{ selected: CatalogCandidate; selectionNote: string }> {
  if (candidates.length === 0) {
    throw new Error("No replacement part candidates returned.");
  }
  if (candidates.length === 1) {
    return {
      selected: candidates[0],
      selectionNote: `Selected "${candidates[0].title}" from ${candidates[0].vendor} ($${candidates[0].priceUsd.toFixed(2)}).`,
    };
  }

  try {
    const compact = candidates.map((c, index) => ({
      index,
      title: c.title,
      priceUsd: c.priceUsd,
      vendor: c.vendor,
      availability: c.availability,
    }));

    const parsed = await generateStructuredJson<{
      selectedIndex: number;
      selectionNote: string;
    }>(
      [
        `Diagnosis: ${diagnosis.failingComponent} (urgency: ${diagnosis.severity}).`,
        `Recommended query: "${diagnosis.recommendedPartQuery}".`,
        `Pick the most suitable real hardware/electronics replacement part index from these candidates. Ignore books, manuals, or unrelated consumer toys:`,
        JSON.stringify(compact),
      ].join("\n"),
      {
        type: Type.OBJECT,
        properties: {
          selectedIndex: { type: Type.INTEGER },
          selectionNote: { type: Type.STRING },
        },
        required: ["selectedIndex", "selectionNote"],
      }
    );

    const picked = candidates[parsed.selectedIndex];
    if (picked) {
      return { selected: picked, selectionNote: parsed.selectionNote };
    }
  } catch (err) {
    console.warn("Candidate ranking fallback to top result:", err);
  }

  return {
    selected: candidates[0],
    selectionNote: `Selected top catalog match "${candidates[0].title}" ($${candidates[0].priceUsd.toFixed(2)}).`,
  };
}

export interface CycleOutcome {
  diagnosis: DiagnosisResult;
  candidates: CatalogCandidate[];
  selectedPart: CatalogCandidate | null;
  record: ProcurementRecord;
}

/**
 * Runs the full SentinelPay autonomous loop for a node:
 * Telemetry diagnosis -> Channel3 product search -> Policy evaluation -> PayPal execution.
 */
export async function runProcurementCycle(
  node: IoTNode,
  returnBaseUrl: string
): Promise<CycleOutcome> {
  const diagnosis = await diagnoseNodeTelemetry(node);

  let candidates: CatalogCandidate[] = [];
  let selectedPart: CatalogCandidate | null = null;
  let selectionNote = "";

  if (diagnosis.actionNeeded) {
    const isCritical = diagnosis.severity === "CRITICAL";
    const searchOpts = isCritical
      ? { limit: 6, minPriceUsd: 55, maxPriceUsd: 350 }
      : { limit: 6, minPriceUsd: 5, maxPriceUsd: 45 };
    candidates = await searchReplacementParts(
      diagnosis.recommendedPartQuery,
      searchOpts
    );
    if (candidates.length === 0) {
      candidates = await searchReplacementParts(
        isCritical
          ? "24v industrial power supply DIN rail"
          : "24v brushless cooling fan 80mm",
        searchOpts
      );
    }
    if (candidates.length === 0) {
      candidates = await searchReplacementParts(diagnosis.recommendedPartQuery, {
        limit: 5,
      });
    }
    if (candidates.length > 0) {
      const choice = await selectBestCandidate(diagnosis, candidates);
      selectedPart = choice.selected;
      selectionNote = choice.selectionNote;
    }
  }

  const policy = getPolicy();
  const decision = evaluateProcurementPolicy(
    diagnosis,
    selectedPart,
    getTodaySpentUsd(),
    policy
  );

  const recordId = `proc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const fullReasoning = [diagnosis.reasoning, selectionNote, ...decision.reasons]
    .filter(Boolean)
    .join(" ");

  if (decision.action === "NO_ACTION" || !selectedPart) {
    const record = appendRecord({
      id: recordId,
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      nodeName: node.name,
      failingComponent: diagnosis.failingComponent || "None",
      confidence: diagnosis.confidence,
      selectedPartTitle: "No purchase required",
      catalogSource: "FALLBACK_CATALOG",
      amountUsd: 0,
      vendor: "-",
      policyAction: "NO_ACTION",
      paypalMethod: "NONE",
      paypalTransactionId: "-",
      paypalStatus: "SKIPPED",
      reasoning: fullReasoning,
      policyChecks: decision.checks,
    });
    return { diagnosis, candidates, selectedPart: null, record };
  }

  const hasPayPalKeys = Boolean(
    process.env.PAYPAL_CLIENT_ID?.trim() &&
      process.env.PAYPAL_CLIENT_SECRET?.trim()
  );

  if (!hasPayPalKeys) {
    const record = appendRecord({
      id: recordId,
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      nodeName: node.name,
      failingComponent: diagnosis.failingComponent,
      confidence: diagnosis.confidence,
      selectedPartTitle: selectedPart.title,
      selectedPartUrl: selectedPart.url,
      catalogSource: selectedPart.source,
      amountUsd: selectedPart.priceUsd,
      vendor: selectedPart.vendor,
      policyAction: decision.action,
      paypalMethod: decision.action === "AUTO_PAYOUT" ? "PAYOUT_V1" : "ORDER_V2",
      paypalTransactionId: "AWAITING_SANDBOX_KEYS",
      paypalStatus: "AWAITING_PAYPAL_CREDENTIALS",
      reasoning: `${fullReasoning} (Preview mode: add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env to execute live Sandbox payment.)`,
      policyChecks: decision.checks,
    });
    return { diagnosis, candidates, selectedPart, record };
  }

  if (decision.action === "AUTO_PAYOUT") {
    const payout = await sendAutonomousPayout({
      amountUsd: selectedPart.priceUsd,
      itemId: recordId,
      note: `SentinelPay auto-procurement for ${node.id}: ${selectedPart.title}`,
    });

    const record = appendRecord({
      id: recordId,
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      nodeName: node.name,
      failingComponent: diagnosis.failingComponent,
      confidence: diagnosis.confidence,
      selectedPartTitle: selectedPart.title,
      selectedPartUrl: selectedPart.url,
      catalogSource: selectedPart.source,
      amountUsd: selectedPart.priceUsd,
      vendor: selectedPart.vendor,
      policyAction: "AUTO_PAYOUT",
      paypalMethod: "PAYOUT_V1",
      paypalTransactionId: payout.batchId,
      paypalStatus: payout.batchStatus,
      reasoning: fullReasoning,
      policyChecks: decision.checks,
    });

    return { diagnosis, candidates, selectedPart, record };
  }

  // Escalated: Create a PayPal Orders v2 checkout order for Human-in-the-Loop approval
  const order = await createHitlOrder({
    amountUsd: selectedPart.priceUsd,
    description: `${node.id}: ${selectedPart.title}`,
    referenceId: recordId,
    returnBaseUrl,
  });

  const record = appendRecord({
    id: recordId,
    timestamp: new Date().toISOString(),
    nodeId: node.id,
    nodeName: node.name,
    failingComponent: diagnosis.failingComponent,
    confidence: diagnosis.confidence,
    selectedPartTitle: selectedPart.title,
    selectedPartUrl: selectedPart.url,
    catalogSource: selectedPart.source,
    amountUsd: selectedPart.priceUsd,
    vendor: selectedPart.vendor,
    policyAction: "HITL_ORDER_APPROVAL",
    paypalMethod: "ORDER_V2",
    paypalTransactionId: order.orderId,
    paypalStatus: order.status,
    approveUrl: order.approveUrl,
    reasoning: fullReasoning,
    policyChecks: decision.checks,
  });

  return { diagnosis, candidates, selectedPart, record };
}

export async function finalizeHitlOrder(
  recordId: string
): Promise<ProcurementRecord> {
  const existing = getRecord(recordId);
  if (!existing) {
    throw new Error(`Procurement record ${recordId} not found.`);
  }
  if (existing.paypalMethod !== "ORDER_V2") {
    throw new Error(`Record ${recordId} is not a PayPal Order v2 transaction.`);
  }

  const capture = await captureHitlOrder(existing.paypalTransactionId);
  const updated = updateRecord(recordId, {
    paypalStatus: capture.status,
  });
  return updated!;
}
