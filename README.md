# SentinelPay

**Autonomous Predictive Maintenance & Procurement Agent for Industrial IoT Fleets**  
Built for **PayPal AI Hackathon 2026 ("Build What's Next with PayPal and AI")**.

**Live Demo:** [https://sentinelpay-wvkn.onrender.com](https://sentinelpay-wvkn.onrender.com) *(hosted on Render free tier — allow ~50s cold start if idle)*

---

## Overview

Industrial equipment degradation often shows up across multiple correlated telemetry signals before a catastrophic failure occurs. **SentinelPay** connects live IoT hardware monitoring to real-world catalog discovery and **policy-gated PayPal commerce**:

1. **Multi-Signal AI Diagnosis (Gemini):** Evaluates telemetry history (`tempC`, `vibrationMmS`, `fanRpm`, `currentAmps`) against each machine's baseline via structured JSON outputs (`gemini-3.1-flash-lite` with automated parallel backup models).
2. **Live Part Discovery (Channel3):** Queries `https://api.trychannel3.com/v1/search` with stock and severity-aware price filters to pull real replacement parts, pricing, and merchants, then ranks the best hardware match.
3. **Policy Guardrail Engine:** Enforces user-configurable financial mandates before any funds move:
   * Per-Order Autonomous Cap (default `$50`)
   * Daily Autonomous Spend Cap (default `$150`)
   * Minimum AI Confidence Threshold (default `85%`)
4. **Dual PayPal Sandbox Execution (`@paypal/agent-toolkit` + REST):**
   * **Within Mandate (`AUTO_PAYOUT`):** Executes server-to-server **PayPal Payouts v1** directly to the registered vendor/technician sandbox account with zero human click required.
   * **Escalated (`HITL_ORDER_APPROVAL`):** Creates a **PayPal Orders v2** checkout order (`PAYER_ACTION_REQUIRED`), pauses for 1-click Human-in-the-Loop approval, and automatically captures on return redirect (`COMPLETED`).
   * **Order Verification & Reconciliation:** Integrates `@paypal/agent-toolkit/ai-sdk` (`get_order`, `list_transactions`).
5. **Enterprise Spend & Audit Ledger (AG Grid):** Sortable, filterable audit table recording every AI diagnosis, confidence score, Channel3 catalog source, policy rule evaluation, and PayPal transaction status.

---

## Architecture

```
Edge IoT Telemetry Stream (4 Industrial Nodes: CNC-04, COLD-07, HVAC-02, PRINT-01)
        │
        ▼
Gemini Structured Reasoning (@google/genai)
        │  Diagnoses root cause + ranks part candidates
        ▼
Channel3 Product Search API (/v1/search)
        │  Real InStock hardware listings + pricing + merchant domains
        ▼
SentinelPay Policy Guardrail Engine (Order Cap · Daily Cap · AI Confidence)
        ├── Within Mandate ──────▶ PayPal Payouts v1 (Autonomous Server-to-Server)
        └── Exceeds / Uncertain ─▶ PayPal Orders v2 (1-Click Human Approval + Auto-Capture)
        │
        ▼
AG Grid Audit & Spend Ledger + Render Deployment
```

---

## 60-Second Judge Walkthrough

1. Open [https://sentinelpay-wvkn.onrender.com](https://sentinelpay-wvkn.onrender.com) and verify the header badges show **PayPal Sandbox Ready**, **Gemini Ready**, and **Channel3 Live API**.
2. **Autonomous Flow:** Select `CNC-04` → click **Inject Fan Wear (Auto-Pay)** → **Run SentinelPay AI Procurement Cycle on CNC-04**. Gemini diagnoses fan bearing wear, Channel3 sources a replacement cooling fan (`<$50`), all guardrails pass, and PayPal executes `PAYOUT_V1` automatically.
3. **Human-in-the-Loop Flow:** Click **Inject Spindle Fault (Escalation)** → **Run SentinelPay AI Procurement Cycle on CNC-04**. Gemini diagnoses spindle power/controller failure, Channel3 sources an industrial DIN-rail power supply (`>$50`), the policy gate blocks auto-spend and creates a PayPal `ORDER_V2` checkout link for manual approval and capture.

---

## Quick Start (Local Development)

### Prerequisites
- Node.js `>= 20` (tested on Node `v26.13.0` / `22`)
- PayPal Developer Sandbox App (`Client ID`, `Client Secret`, US Business + US Personal Sandbox accounts for Payouts)
- Google Gemini API Key ([aistudio.google.com/apikey](https://aistudio.google.com/apikey))
- Channel3 API Key ([trychannel3.com/developers](https://trychannel3.com/developers))

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   npm --prefix client install
   ```

2. **Configure environment variables:**
   Copy `.env.example` to `.env` and fill in:
   - `PAYPAL_CLIENT_ID` & `PAYPAL_CLIENT_SECRET`
   - `PAYPAL_SANDBOX_RECIPIENT_EMAIL`
   - `GEMINI_API_KEY`
   - `CHANNEL3_API_KEY` *(optional; falls back to labeled local catalog if omitted)*

3. **Verify all external APIs:**
   ```bash
   npm run verify
   ```

4. **Run locally:**
   ```bash
   npm run build && npm --prefix client run build
   npm start
   ```
   Open `http://localhost:3001` *(or run `npm run dev` + `npm --prefix client run dev` on port `5173`)*.

---

## License

MIT — see [LICENSE](./LICENSE).
