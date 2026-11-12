import { useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cpu,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sliders,
  Zap,
} from "lucide-react";
import { Sparkline } from "./components/Sparkline";
import type {
  CycleOutcome,
  FaultPreset,
  HealthStatus,
  IoTNode,
  PolicyConfig,
  ProcurementRecord,
} from "./types";

ModuleRegistry.registerModules([AllCommunityModule]);

const sentinelGridTheme = themeQuartz.withParams({
  backgroundColor: "#0e1525",
  foregroundColor: "#e2e8f0",
  headerBackgroundColor: "#141d31",
  headerTextColor: "#94a3b8",
  borderColor: "#23304c",
  oddRowBackgroundColor: "#10182b",
  rowHoverColor: "#18243e",
  fontSize: 13,
});

function healthBadgeClass(status: IoTNode["status"]): string {
  if (status === "CRITICAL") return "badge badge-crit";
  if (status === "WARNING") return "badge badge-warn";
  return "badge badge-ok";
}

export default function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [nodes, setNodes] = useState<IoTNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("CNC-04");
  const [records, setRecords] = useState<ProcurementRecord[]>([]);
  const [policy, setPolicy] = useState<PolicyConfig>({
    autoPayLimitUsd: 50,
    dailySpendCapUsd: 150,
    minConfidence: 0.85,
  });
  const [todaySpentUsd, setTodaySpentUsd] = useState<number>(0);
  const [lastOutcome, setLastOutcome] = useState<CycleOutcome | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);
  const [showPolicyEditor, setShowPolicyEditor] = useState(false);

  async function loadDashboard(): Promise<ProcurementRecord[]> {
    try {
      const [dashRes, healthRes] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/health"),
      ]);
      let nextRecords: ProcurementRecord[] = [];
      if (dashRes.ok) {
        const dash = await dashRes.json();
        setNodes(dash.nodes);
        setRecords(dash.records);
        setPolicy(dash.policy);
        setTodaySpentUsd(dash.todaySpentUsd);
        nextRecords = dash.records;
      }
      if (healthRes.ok) {
        setHealth(await healthRes.json());
      }
      return nextRecords;
    } catch {
      return [];
    }
  }

  useEffect(() => {
    (async () => {
      const loaded = await loadDashboard();
      const params = new URLSearchParams(window.location.search);
      const paypalStatus = params.get("paypal_status");
      const token = params.get("token");
      if (paypalStatus === "approved" && token) {
        const match = loaded.find(
          (r) =>
            r.paypalTransactionId === token && r.paypalStatus !== "COMPLETED"
        );
        window.history.replaceState({}, "", window.location.pathname);
        if (match) {
          await handleCaptureOrder(match.id);
          setInfoBanner(
            `PayPal approved & captured Order ${token} (${match.selectedPartTitle}).`
          );
        }
      } else if (paypalStatus === "cancelled") {
        window.history.replaceState({}, "", window.location.pathname);
        setInfoBanner("PayPal checkout approval was cancelled.");
      }
    })();
    const timer = setInterval(loadDashboard, 3000);
    return () => clearInterval(timer);
  }, []);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || nodes[0],
    [nodes, selectedNodeId]
  );

  async function handleInjectFault(preset: FaultPreset) {
    if (!selectedNode) return;
    setErrorBanner(null);
    setBusyAction(`fault:${preset}`);
    try {
      const res = await fetch(`/api/nodes/${selectedNode.id}/fault`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Fault failed");
      await loadDashboard();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleResetNode() {
    if (!selectedNode) return;
    setErrorBanner(null);
    setBusyAction("reset");
    try {
      await fetch(`/api/nodes/${selectedNode.id}/reset`, { method: "POST" });
      await loadDashboard();
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRunAgent() {
    if (!selectedNode) return;
    setErrorBanner(null);
    setBusyAction("analyze");
    try {
      const res = await fetch(`/api/nodes/${selectedNode.id}/analyze`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Agent cycle failed");
      }
      setLastOutcome(data as CycleOutcome);
      await loadDashboard();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCaptureOrder(recordId: string) {
    setErrorBanner(null);
    setBusyAction(`capture:${recordId}`);
    try {
      const res = await fetch(`/api/orders/${recordId}/capture`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Order capture failed");
      }
      if (data.record) {
        setLastOutcome((prev) =>
          prev && prev.record.id === data.record.id
            ? { ...prev, record: data.record }
            : prev
        );
      }
      await loadDashboard();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRefreshPayout(recordId: string) {
    setErrorBanner(null);
    setBusyAction(`refresh:${recordId}`);
    try {
      const res = await fetch(`/api/payouts/${recordId}/refresh`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      if (data.record) {
        setLastOutcome((prev) =>
          prev && prev.record.id === data.record.id
            ? { ...prev, record: data.record }
            : prev
        );
      }
      await loadDashboard();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleClearLedger() {
    setErrorBanner(null);
    setInfoBanner(null);
    setBusyAction("clear");
    try {
      await fetch("/api/records", { method: "DELETE" });
      setLastOutcome(null);
      await loadDashboard();
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSavePolicy(next: PolicyConfig) {
    setBusyAction("policy");
    try {
      const res = await fetch("/api/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        const data = await res.json();
        setPolicy(data.policy);
        setShowPolicyEditor(false);
      }
    } finally {
      setBusyAction(null);
    }
  }

  const colDefs = useMemo<ColDef<ProcurementRecord>[]>(
    () => [
      {
        headerName: "Time",
        field: "timestamp",
        width: 110,
        valueFormatter: (p) =>
          p.value ? new Date(p.value).toLocaleTimeString() : "",
      },
      { headerName: "Node", field: "nodeId", width: 95 },
      {
        headerName: "Diagnosis",
        field: "failingComponent",
        minWidth: 160,
        flex: 1,
      },
      {
        headerName: "Conf.",
        field: "confidence",
        width: 85,
        valueFormatter: (p) => `${Math.round((p.value || 0) * 100)}%`,
      },
      {
        headerName: "Sourced Part",
        field: "selectedPartTitle",
        minWidth: 200,
        flex: 1.4,
      },
      {
        headerName: "Catalog",
        field: "catalogSource",
        width: 115,
      },
      {
        headerName: "Amount",
        field: "amountUsd",
        width: 95,
        valueFormatter: (p) => `$${Number(p.value || 0).toFixed(2)}`,
      },
      {
        headerName: "Policy Gate",
        field: "policyAction",
        width: 155,
      },
      {
        headerName: "PayPal ID",
        field: "paypalTransactionId",
        width: 165,
      },
      {
        headerName: "PayPal Status",
        field: "paypalStatus",
        width: 145,
      },
      {
        headerName: "Action",
        field: "id",
        width: 215,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<ProcurementRecord>) => {
          const rec = params.data;
          if (!rec) return null;
          if (rec.paypalStatus === "AWAITING_PAYPAL_CREDENTIALS") {
            return (
              <span style={{ color: "#fbbf24", fontSize: 12 }}>
                Needs PayPal Keys
              </span>
            );
          }
          if (rec.paypalMethod === "PAYOUT_V1") {
            return (
              <button
                className="btn"
                style={{ padding: "3px 9px", fontSize: 12 }}
                onClick={() => handleRefreshPayout(rec.id)}
                disabled={busyAction === `refresh:${rec.id}`}
              >
                <RefreshCw size={12} /> Sync Status
              </button>
            );
          }
          if (
            rec.paypalMethod === "ORDER_V2" &&
            rec.paypalStatus !== "COMPLETED"
          ) {
            return (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {rec.approveUrl && (
                  <a
                    href={rec.approveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-amber"
                    style={{
                      padding: "3px 8px",
                      fontSize: 12,
                      textDecoration: "none",
                    }}
                  >
                    Approve <ExternalLink size={11} />
                  </a>
                )}
                <button
                  className="btn btn-emerald"
                  style={{ padding: "3px 8px", fontSize: 12 }}
                  onClick={() => handleCaptureOrder(rec.id)}
                  disabled={busyAction === `capture:${rec.id}`}
                >
                  Capture
                </button>
              </div>
            );
          }
          return (
            <span style={{ color: "#64748b", fontSize: 12 }}>Settled</span>
          );
        },
      },
    ],
    [busyAction]
  );

  const spendPct = Math.min(
    100,
    Math.round((todaySpentUsd / (policy.dailySpendCapUsd || 1)) * 100)
  );

  return (
    <div className="layout-shell">
      {/* Header */}
      <header
        className="panel"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Bot size={24} color="#38bdf8" />
            <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.02em" }}>
              SentinelPay
            </h1>
            <span className="badge badge-info">
              Agentic IoT Maintenance &amp; PayPal Commerce
            </span>
          </div>
          <p style={{ margin: "5px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Multi-signal telemetry diagnosis → Channel3 live part sourcing →
            Policy-gated PayPal Payouts &amp; HITL Orders
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
          }}
        >
          {health && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span
                className={`badge ${health.paypalConfigured && health.payoutRecipientConfigured ? "badge-ok" : "badge-warn"}`}
              >
                PayPal{" "}
                {health.paypalConfigured && health.payoutRecipientConfigured
                  ? "Sandbox Ready"
                  : "Needs Keys"}
              </span>
              <span
                className={`badge ${health.geminiConfigured ? "badge-ok" : "badge-warn"}`}
              >
                Gemini {health.geminiConfigured ? "Ready" : "Needs Key"}
              </span>
              <span
                className={`badge ${health.channel3Configured ? "badge-ok" : "badge-info"}`}
              >
                Channel3 {health.channel3Configured ? "Live API" : "Fallback"}
              </span>
            </div>
          )}

          <div
            className="card"
            style={{ padding: "6px 12px", minWidth: 195 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#94a3b8",
                marginBottom: 4,
              }}
            >
              <span>Daily Auto-Spend</span>
              <strong style={{ color: "#f1f5f9" }}>
                ${todaySpentUsd.toFixed(2)} / ${policy.dailySpendCapUsd}
              </strong>
            </div>
            <div
              style={{
                height: 6,
                background: "#1e293b",
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${spendPct}%`,
                  height: "100%",
                  background: spendPct > 85 ? "#f59e0b" : "#10b981",
                }}
              />
            </div>
          </div>

          <button
            className="btn"
            onClick={() => setShowPolicyEditor((v) => !v)}
          >
            <Sliders size={14} /> Guardrails
          </button>
        </div>
      </header>

      {showPolicyEditor && (
        <section
          className="panel"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "flex-end",
          }}
        >
          <label style={{ fontSize: 12, color: "#94a3b8" }}>
            Max Auto-Pay / Order (USD)
            <input
              type="number"
              value={policy.autoPayLimitUsd}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  autoPayLimitUsd: Number(e.target.value),
                })
              }
              style={{
                display: "block",
                marginTop: 4,
                background: "#070b14",
                color: "#f1f5f9",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "6px 10px",
                width: 150,
              }}
            />
          </label>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>
            Daily Cap (USD)
            <input
              type="number"
              value={policy.dailySpendCapUsd}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  dailySpendCapUsd: Number(e.target.value),
                })
              }
              style={{
                display: "block",
                marginTop: 4,
                background: "#070b14",
                color: "#f1f5f9",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "6px 10px",
                width: 150,
              }}
            />
          </label>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>
            Min Confidence (0–1)
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={policy.minConfidence}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  minConfidence: Number(e.target.value),
                })
              }
              style={{
                display: "block",
                marginTop: 4,
                background: "#070b14",
                color: "#f1f5f9",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "6px 10px",
                width: 150,
              }}
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={() => handleSavePolicy(policy)}
            disabled={busyAction === "policy"}
          >
            Save Mandate
          </button>
        </section>
      )}

      {infoBanner && (
        <div
          className="panel"
          style={{
            borderColor: "rgba(16, 185, 129, 0.5)",
            background: "rgba(16, 185, 129, 0.1)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle2 size={16} color="#34d399" />
            <span style={{ fontSize: 13 }}>{infoBanner}</span>
          </div>
          <button
            className="btn"
            style={{ padding: "4px 10px" }}
            onClick={() => setInfoBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {errorBanner && (
        <div
          className="panel"
          style={{
            borderColor: "rgba(244, 63, 94, 0.55)",
            background: "rgba(244, 63, 94, 0.1)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={16} color="#fb7185" />
            <span style={{ fontSize: 13 }}>{errorBanner}</span>
          </div>
          <button
            className="btn"
            style={{ padding: "4px 10px" }}
            onClick={() => setErrorBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Split: Fleet Monitor + Agent Reasoning Trace */}
      <div className="grid-two">
        {/* Left: Fleet & Telemetry */}
        <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Cpu size={17} color="#38bdf8" /> Edge IoT Hardware Fleet
            </h2>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Live 3s telemetry stream
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            {nodes.map((node) => {
              const active = selectedNode?.id === node.id;
              return (
                <button
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className="card"
                  style={{
                    textAlign: "left",
                    borderColor: active ? "#38bdf8" : "#23304c",
                    boxShadow: active
                      ? "0 0 0 1px rgba(56,189,248,0.4)"
                      : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4,
                    }}
                  >
                    <strong style={{ fontSize: 13 }}>{node.id}</strong>
                    <span className={healthBadgeClass(node.status)}>
                      {node.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#cbd5e1" }}>
                    {node.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {node.location} · {node.telemetry.tempC}°C ·{" "}
                    {node.telemetry.fanRpm} RPM
                  </div>
                </button>
              );
            })}
          </div>

          {selectedNode && (
            <>
              <div className="telemetry-grid">
                <div className="card">
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    Motor Temp
                  </div>
                  <div style={{ fontSize: 19, fontWeight: 700, margin: "2px 0" }}>
                    {selectedNode.telemetry.tempC}°C
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    Base {selectedNode.baseline.tempC}°C
                  </div>
                  <Sparkline
                    values={selectedNode.history.map((h) => h.tempC)}
                    color={
                      selectedNode.telemetry.tempC >
                      selectedNode.baseline.tempC + 20
                        ? "#fb7185"
                        : "#38bdf8"
                    }
                  />
                </div>

                <div className="card">
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    Vibration
                  </div>
                  <div style={{ fontSize: 19, fontWeight: 700, margin: "2px 0" }}>
                    {selectedNode.telemetry.vibrationMmS} mm/s
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    Base {selectedNode.baseline.vibrationMmS} mm/s
                  </div>
                  <Sparkline
                    values={selectedNode.history.map((h) => h.vibrationMmS)}
                    color="#fbbf24"
                  />
                </div>

                <div className="card">
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    Cooling Fan
                  </div>
                  <div style={{ fontSize: 19, fontWeight: 700, margin: "2px 0" }}>
                    {selectedNode.telemetry.fanRpm} RPM
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    Base {selectedNode.baseline.fanRpm} RPM
                  </div>
                  <Sparkline
                    values={selectedNode.history.map((h) => h.fanRpm)}
                    color="#34d399"
                  />
                </div>

                <div className="card">
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    Current Draw
                  </div>
                  <div style={{ fontSize: 19, fontWeight: 700, margin: "2px 0" }}>
                    {selectedNode.telemetry.currentAmps} A
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    Base {selectedNode.baseline.currentAmps} A
                  </div>
                  <Sparkline
                    values={selectedNode.history.map((h) => h.currentAmps)}
                    color="#a78bfa"
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  paddingTop: 4,
                }}
              >
                <button
                  className="btn btn-amber"
                  onClick={() => handleInjectFault("cooling_fan_wear")}
                  disabled={Boolean(busyAction)}
                >
                  <Activity size={14} /> Inject Fan Wear (Auto-Pay)
                </button>
                <button
                  className="btn btn-rose"
                  onClick={() =>
                    handleInjectFault("spindle_controller_burnout")
                  }
                  disabled={Boolean(busyAction)}
                >
                  <AlertTriangle size={14} /> Inject Spindle Fault (Escalation)
                </button>
                <button
                  className="btn"
                  onClick={() => handleInjectFault("ambiguous_drift")}
                  disabled={Boolean(busyAction)}
                >
                  Inject Noisy Drift
                </button>
                <button
                  className="btn"
                  onClick={handleResetNode}
                  disabled={Boolean(busyAction)}
                >
                  Reset Healthy
                </button>
              </div>

              <button
                className="btn btn-primary"
                style={{ width: "100%", padding: "11px 16px", fontSize: 14 }}
                onClick={handleRunAgent}
                disabled={Boolean(busyAction)}
              >
                <Zap size={16} />
                {busyAction === "analyze"
                  ? "Running Gemini Diagnosis → Channel3 Search → PayPal Policy Gate..."
                  : `Run SentinelPay AI Procurement Cycle on ${selectedNode.id}`}
              </button>
            </>
          )}
        </section>

        {/* Right: Agent Trace & PayPal Decision */}
        <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <ShieldCheck size={17} color="#10b981" /> AI Decision &amp; PayPal
            Execution Trace
          </h2>

          {!lastOutcome ? (
            <div
              className="card"
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                textAlign: "center",
                color: "#94a3b8",
                padding: 28,
              }}
            >
              <Bot size={34} color="#475569" style={{ marginBottom: 10 }} />
              <div style={{ fontWeight: 600, color: "#cbd5e1" }}>
                Ready for Telemetry Diagnosis
              </div>
              <p style={{ fontSize: 13, maxWidth: 390, marginTop: 6 }}>
                Inject a hardware fault on any IoT node (or test a healthy
                node) and click <strong>Run SentinelPay AI Procurement Cycle</strong>{" "}
                to watch Gemini diagnose the trend, source parts via Channel3,
                and enforce your PayPal spending policy.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Step 1: Gemini */}
              <div className="card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <strong style={{ fontSize: 13 }}>
                    1. Gemini Predictive Diagnosis
                  </strong>
                  <span className="badge badge-info">
                    Confidence:{" "}
                    {Math.round(lastOutcome.diagnosis.confidence * 100)}% ·{" "}
                    {lastOutcome.diagnosis.severity}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f8fafc" }}>
                  {lastOutcome.diagnosis.failingComponent}
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#94a3b8" }}>
                  {lastOutcome.diagnosis.reasoning}
                </p>
              </div>

              {/* Step 2: Channel3 */}
              <div className="card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <strong
                    style={{
                      fontSize: 13,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <ShoppingBag size={14} color="#38bdf8" /> 2. Part Sourcing (
                    {lastOutcome.selectedPart?.source ||
                      lastOutcome.candidates[0]?.source ||
                      "NONE"}
                    )
                  </strong>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>
                    Query: "{lastOutcome.diagnosis.recommendedPartQuery}"
                  </span>
                </div>

                {lastOutcome.candidates.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>
                    No purchase triggered.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {lastOutcome.candidates.slice(0, 3).map((cand) => {
                      const picked = lastOutcome.selectedPart?.id === cand.id;
                      return (
                        <div
                          key={cand.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "6px 9px",
                            borderRadius: 7,
                            background: picked
                              ? "rgba(56, 189, 248, 0.12)"
                              : "#0e1525",
                            border: picked
                              ? "1px solid rgba(56, 189, 248, 0.45)"
                              : "1px solid #1e293b",
                            fontSize: 12,
                          }}
                        >
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {picked && (
                              <strong style={{ color: "#38bdf8", marginRight: 6 }}>
                                [SELECTED]
                              </strong>
                            )}
                            <span>{cand.title}</span>
                            <span style={{ color: "#64748b", marginLeft: 6 }}>
                              · {cand.vendor}
                            </span>
                          </div>
                          <strong style={{ marginLeft: 10 }}>
                            ${cand.priceUsd.toFixed(2)}
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Step 3: Guardrails + PayPal Execution */}
              <div className="card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <strong style={{ fontSize: 13 }}>
                    3. Spending Guardrails &amp; PayPal Action
                  </strong>
                  <span
                    className={`badge ${
                      lastOutcome.record.policyAction === "AUTO_PAYOUT"
                        ? "badge-ok"
                        : lastOutcome.record.policyAction ===
                            "HITL_ORDER_APPROVAL"
                          ? "badge-warn"
                          : "badge-info"
                    }`}
                  >
                    {lastOutcome.record.policyAction}
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    marginBottom: 10,
                  }}
                >
                  {lastOutcome.record.policyChecks.map((chk) => (
                    <div
                      key={chk.rule}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        fontSize: 12,
                        color: chk.passed ? "#cbd5e1" : "#fda4af",
                      }}
                    >
                      {chk.passed ? (
                        <CheckCircle2 size={14} color="#34d399" />
                      ) : (
                        <ShieldAlert size={14} color="#fb7185" />
                      )}
                      <strong>{chk.rule}:</strong>
                      <span>{chk.detail}</span>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "#0b1120",
                    border: "1px solid #1e293b",
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <div>
                    <div>
                      Method: <strong>{lastOutcome.record.paypalMethod}</strong>{" "}
                      · ID:{" "}
                      <code>{lastOutcome.record.paypalTransactionId}</code>
                    </div>
                    <div style={{ color: "#94a3b8", marginTop: 2 }}>
                      Status: <strong>{lastOutcome.record.paypalStatus}</strong>
                    </div>
                  </div>

                  {lastOutcome.record.paypalMethod === "ORDER_V2" &&
                    lastOutcome.record.paypalStatus !== "COMPLETED" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        {lastOutcome.record.approveUrl && (
                          <a
                            href={lastOutcome.record.approveUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-amber"
                            style={{ textDecoration: "none" }}
                          >
                            1. Approve in PayPal <ExternalLink size={13} />
                          </a>
                        )}
                        <button
                          className="btn btn-emerald"
                          onClick={() =>
                            handleCaptureOrder(lastOutcome.record.id)
                          }
                          disabled={
                            busyAction === `capture:${lastOutcome.record.id}`
                          }
                        >
                          2. Capture Order
                        </button>
                      </div>
                    )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Bottom: AG Grid Enterprise Spend & Audit Ledger */}
      <section className="panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15 }}>
            Autonomous Procurement &amp; Audit Ledger (AG Grid)
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              {records.length} logged decision(s)
            </span>
            {records.length > 0 && (
              <button
                className="btn"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={handleClearLedger}
                disabled={busyAction === "clear"}
              >
                Clear Ledger
              </button>
            )}
          </div>
        </div>

        <div style={{ height: 320, width: "100%" }}>
          <AgGridReact<ProcurementRecord>
            theme={sentinelGridTheme}
            rowData={records}
            columnDefs={colDefs}
            defaultColDef={{
              sortable: true,
              filter: true,
              resizable: true,
            }}
            pagination={true}
            paginationPageSize={10}
          />
        </div>
      </section>
    </div>
  );
}
