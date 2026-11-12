import type {
  CatalogCandidate,
  DiagnosisResult,
  PolicyCheck,
  PolicyConfig,
  PolicyDecision,
} from "./types.js";

export function getPolicyConfigFromEnv(): PolicyConfig {
  return {
    autoPayLimitUsd: Number(process.env.AUTO_PAY_LIMIT_USD || 50),
    dailySpendCapUsd: Number(process.env.DAILY_SPEND_CAP_USD || 150),
    minConfidence: Number(process.env.MIN_CONFIDENCE || 0.85),
  };
}

/**
 * Evaluates whether an AI procurement proposal may execute autonomously via
 * PayPal Payouts or must escalate to Human-in-the-Loop PayPal Checkout approval.
 */
export function evaluateProcurementPolicy(
  diagnosis: DiagnosisResult,
  selectedPart: CatalogCandidate | null,
  dailySpentUsd: number,
  config: PolicyConfig
): PolicyDecision {
  if (!diagnosis.actionNeeded || !selectedPart) {
    return {
      action: "NO_ACTION",
      reasons: ["Telemetry indicates normal operation; no replacement needed."],
      checks: [
        {
          rule: "Fault Detected",
          passed: false,
          detail: "No actionable hardware fault diagnosed.",
        },
      ],
    };
  }

  const withinOrderCap = selectedPart.priceUsd <= config.autoPayLimitUsd;
  const projectedDaily = Number(
    (dailySpentUsd + selectedPart.priceUsd).toFixed(2)
  );
  const withinDailyCap = projectedDaily <= config.dailySpendCapUsd;
  const highConfidence = diagnosis.confidence >= config.minConfidence;

  const checks: PolicyCheck[] = [
    {
      rule: "Per-Order Autonomous Cap",
      passed: withinOrderCap,
      detail: `$${selectedPart.priceUsd.toFixed(2)} <= $${config.autoPayLimitUsd.toFixed(2)} limit`,
    },
    {
      rule: "Daily Spend Mandate",
      passed: withinDailyCap,
      detail: `$${projectedDaily.toFixed(2)} projected <= $${config.dailySpendCapUsd.toFixed(2)} daily cap`,
    },
    {
      rule: "AI Diagnostic Confidence",
      passed: highConfidence,
      detail: `${Math.round(diagnosis.confidence * 100)}% >= ${Math.round(config.minConfidence * 100)}% threshold`,
    },
  ];

  const failedReasons = checks.filter((c) => !c.passed).map((c) => c.detail);

  if (failedReasons.length === 0) {
    return {
      action: "AUTO_PAYOUT",
      reasons: [
        "All spending and confidence guardrails passed. Executing autonomous PayPal payout.",
      ],
      checks,
    };
  }

  return {
    action: "HITL_ORDER_APPROVAL",
    reasons: [
      `Escalated to human approval: ${failedReasons.join("; ")}.`,
    ],
    checks,
  };
}
