import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { finalizeHitlOrder, runProcurementCycle } from "./agent.js";
import {
  getOrderViaToolkit,
  getPayoutBatchStatus,
  listTransactionsViaToolkit,
} from "./paypal.js";
import {
  clearRecords,
  getPolicy,
  getRecord,
  getTodaySpentUsd,
  listRecords,
  updatePolicy,
  updateRecord,
} from "./store.js";
import {
  getNode,
  injectFault,
  listNodes,
  resetNode,
  tickAllNodes,
} from "./telemetry.js";
import type { FaultPreset } from "./types.js";

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3001);

// Background telemetry heartbeat every 3 seconds
setInterval(() => {
  tickAllNodes();
}, 3000);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    paypalConfigured: Boolean(
      process.env.PAYPAL_CLIENT_ID?.trim() &&
        process.env.PAYPAL_CLIENT_SECRET?.trim()
    ),
    payoutRecipientConfigured: Boolean(
      process.env.PAYPAL_SANDBOX_RECIPIENT_EMAIL?.trim()
    ),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite",
    channel3Configured: Boolean(process.env.CHANNEL3_API_KEY?.trim()),
    nodeVersion: process.version,
  });
});

app.get("/api/dashboard", (_req, res) => {
  res.json({
    nodes: listNodes(),
    records: listRecords(),
    policy: getPolicy(),
    todaySpentUsd: getTodaySpentUsd(),
  });
});

app.post("/api/nodes/:id/fault", (req, res) => {
  const preset = req.body?.preset as FaultPreset;
  const valid: FaultPreset[] = [
    "cooling_fan_wear",
    "spindle_controller_burnout",
    "ambiguous_drift",
  ];
  if (!valid.includes(preset)) {
    res.status(400).json({ error: "Invalid fault preset." });
    return;
  }
  const node = injectFault(req.params.id, preset);
  if (!node) {
    res.status(404).json({ error: "Node not found." });
    return;
  }
  res.json({ node });
});

app.post("/api/nodes/:id/reset", (req, res) => {
  const node = resetNode(req.params.id);
  if (!node) {
    res.status(404).json({ error: "Node not found." });
    return;
  }
  res.json({ node });
});

app.post("/api/nodes/:id/analyze", async (req, res) => {
  const node = getNode(req.params.id);
  if (!node) {
    res.status(404).json({ error: "Node not found." });
    return;
  }

  const origin =
    (req.headers.origin as string | undefined) ||
    `${req.protocol}://${req.get("host")}`;

  try {
    const outcome = await runProcurementCycle(node, origin);
    res.json({
      ...outcome,
      todaySpentUsd: getTodaySpentUsd(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/orders/:recordId/capture", async (req, res) => {
  try {
    const record = await finalizeHitlOrder(req.params.recordId);
    res.json({ record, todaySpentUsd: getTodaySpentUsd() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.post("/api/payouts/:recordId/refresh", async (req, res) => {
  const record = getRecord(req.params.recordId);
  if (!record || record.paypalMethod !== "PAYOUT_V1") {
    res.status(404).json({ error: "Payout record not found." });
    return;
  }
  try {
    const status = await getPayoutBatchStatus(record.paypalTransactionId);
    const updated = updateRecord(record.id, { paypalStatus: status });
    res.json({ record: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/orders/:recordId/sync", async (req, res) => {
  const record = getRecord(req.params.recordId);
  if (!record || record.paypalMethod !== "ORDER_V2") {
    res.status(404).json({ error: "Order record not found." });
    return;
  }
  try {
    const orderData = (await getOrderViaToolkit(record.paypalTransactionId)) as {
      status?: string;
    };
    const nextStatus = orderData?.status || record.paypalStatus;
    const updated = updateRecord(record.id, { paypalStatus: nextStatus });
    res.json({ record: updated, orderData });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/api/paypal/transactions", async (_req, res) => {
  try {
    const transactions = await listTransactionsViaToolkit();
    res.json({ transactions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/policy", (req, res) => {
  const updated = updatePolicy(req.body || {});
  res.json({ policy: updated });
});

app.delete("/api/records", (_req, res) => {
  clearRecords();
  res.json({ ok: true });
});

// Serve built React frontend in production (Render)
const clientDist = path.resolve(process.cwd(), "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*splat", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`SentinelPay API running on http://localhost:${PORT}`);
});
