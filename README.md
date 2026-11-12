# SentinelPay

**Autonomous Predictive Maintenance & Procurement Agent for Industrial IoT Fleets**  
Built for **PayPal AI Hackathon 2026 ("Build What's Next with PayPal and AI")**.

## Architecture

```
Edge IoT Telemetry Stream (4 Industrial Nodes)
        │
        ▼
Gemini 3.8 Flash (Structured Multi-Signal Diagnosis + Candidate Ranking)
        │
        ▼
Channel3 Product Search API (Live Replacement Part Discovery)
        │
        ▼
SentinelPay Policy Guardrail Engine (Per-Order Cap · Daily Cap · AI Confidence)
        ├── Within Mandate ──▶ PayPal Payouts v1 (Autonomous Server-to-Server)
        └── Exceeds / Uncertain ──▶ PayPal Orders v2 (1-Click Human Approval + Capture)
        │
        ▼
AG Grid Audit & Spend Ledger + Render Live Deployment
```

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   npm --prefix client install
   ```

2. **Configure `.env`:**
   Copy `.env.example` to `.env` and fill in:
   - `PAYPAL_CLIENT_ID` & `PAYPAL_CLIENT_SECRET` (PayPal Developer Sandbox)
   - `PAYPAL_SANDBOX_RECIPIENT_EMAIL` (Sandbox Personal test account email)
   - `GEMINI_API_KEY` (Google AI Studio)
   - `CHANNEL3_API_KEY` (Channel3 Developer API)

3. **Verify all external APIs work:**
   ```bash
   npm run verify
   ```

4. **Run locally (2 terminals):**
   ```bash
   npm run dev
   npm --prefix client run dev
   ```
   Open `http://localhost:5173`.

5. **Production build (Render):**
   ```bash
   npm run build && npm --prefix client run build
   npm start
   ```

## License

MIT — see [LICENSE](./LICENSE).
