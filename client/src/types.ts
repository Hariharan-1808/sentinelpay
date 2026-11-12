export type NodeHealth = "HEALTHY" | "WARNING" | "CRITICAL";

export type FaultPreset =
  | "cooling_fan_wear"
  | "spindle_controller_burnout"
  | "ambiguous_drift";

export interface TelemetryPoint {
  timestamp: string;
  tempC: number;
  vibrationMmS: number;
  fanRpm: number;
  currentAmps: number;
}

export interface TelemetryBaseline {
  tempC: number;
  vibrationMmS: number;
  fanRpm: number;
  currentAmps: number;
}

export interface IoTNode {
  id: string;
  name: string;
  location: string;
  machineType: string;
  status: NodeHealth;
  uptimeHours: number;
  telemetry: TelemetryPoint;
  baseline: TelemetryBaseline;
  history: TelemetryPoint[];
  activeFault: FaultPreset | null;
}

export interface DiagnosisResult {
  actionNeeded: boolean;
  failingComponent: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  confidence: number;
  reasoning: string;
  recommendedPartQuery: string;
  estimatedFailureWindowHours: number;
}

export interface CatalogCandidate {
  id: string;
  title: string;
  priceUsd: number;
  currency: string;
  vendor: string;
  url: string;
  imageUrl?: string;
  availability: string;
  source: "CHANNEL3" | "FALLBACK_CATALOG";
}

export interface PolicyCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface PolicyConfig {
  autoPayLimitUsd: number;
  dailySpendCapUsd: number;
  minConfidence: number;
}

export interface ProcurementRecord {
  id: string;
  timestamp: string;
  nodeId: string;
  nodeName: string;
  failingComponent: string;
  confidence: number;
  selectedPartTitle: string;
  selectedPartUrl?: string;
  catalogSource: "CHANNEL3" | "FALLBACK_CATALOG";
  amountUsd: number;
  vendor: string;
  policyAction: "AUTO_PAYOUT" | "HITL_ORDER_APPROVAL" | "NO_ACTION";
  paypalMethod: "PAYOUT_V1" | "ORDER_V2" | "NONE";
  paypalTransactionId: string;
  paypalStatus: string;
  approveUrl?: string;
  reasoning: string;
  policyChecks: PolicyCheck[];
}

export interface HealthStatus {
  ok: boolean;
  paypalConfigured: boolean;
  payoutRecipientConfigured: boolean;
  geminiConfigured: boolean;
  channel3Configured: boolean;
}

export interface CycleOutcome {
  diagnosis: DiagnosisResult;
  candidates: CatalogCandidate[];
  selectedPart: CatalogCandidate | null;
  record: ProcurementRecord;
  todaySpentUsd: number;
}
