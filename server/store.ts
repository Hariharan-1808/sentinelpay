import fs from "node:fs";
import path from "node:path";
import type { PolicyConfig, ProcurementRecord } from "./types.js";
import { getPolicyConfigFromEnv } from "./policy.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const LEDGER_PATH = path.join(DATA_DIR, "ledger.json");

let runtimePolicy: PolicyConfig = getPolicyConfigFromEnv();
let records: ProcurementRecord[] = loadLedger();

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadLedger(): ProcurementRecord[] {
  try {
    if (!fs.existsSync(LEDGER_PATH)) return [];
    const raw = fs.readFileSync(LEDGER_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProcurementRecord[]) : [];
  } catch {
    return [];
  }
}

function persistLedger(): void {
  ensureDataDir();
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(records, null, 2), "utf-8");
}

export function getPolicy(): PolicyConfig {
  return { ...runtimePolicy };
}

export function updatePolicy(patch: Partial<PolicyConfig>): PolicyConfig {
  runtimePolicy = {
    autoPayLimitUsd:
      typeof patch.autoPayLimitUsd === "number" && patch.autoPayLimitUsd > 0
        ? patch.autoPayLimitUsd
        : runtimePolicy.autoPayLimitUsd,
    dailySpendCapUsd:
      typeof patch.dailySpendCapUsd === "number" && patch.dailySpendCapUsd > 0
        ? patch.dailySpendCapUsd
        : runtimePolicy.dailySpendCapUsd,
    minConfidence:
      typeof patch.minConfidence === "number" &&
      patch.minConfidence >= 0 &&
      patch.minConfidence <= 1
        ? patch.minConfidence
        : runtimePolicy.minConfidence,
  };
  return getPolicy();
}

export function listRecords(): ProcurementRecord[] {
  return [...records].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function getRecord(id: string): ProcurementRecord | undefined {
  return records.find((r) => r.id === id);
}

export function appendRecord(record: ProcurementRecord): ProcurementRecord {
  records.unshift(record);
  persistLedger();
  return record;
}

export function updateRecord(
  id: string,
  patch: Partial<ProcurementRecord>
): ProcurementRecord | undefined {
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return undefined;
  records[idx] = { ...records[idx], ...patch };
  persistLedger();
  return records[idx];
}

export function clearRecords(): void {
  records = [];
  persistLedger();
}

export function getTodaySpentUsd(): number {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const total = records
    .filter((r) => {
      if (!r.timestamp.startsWith(todayPrefix)) return false;
      if (r.paypalStatus === "AWAITING_PAYPAL_CREDENTIALS") return false;
      if (r.paypalMethod === "PAYOUT_V1") return true;
      return r.paypalMethod === "ORDER_V2" && r.paypalStatus === "COMPLETED";
    })
    .reduce((sum, r) => sum + r.amountUsd, 0);
  return Number(total.toFixed(2));
}
