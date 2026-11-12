import "dotenv/config";
import { GoogleGenAI, Type } from "@google/genai";

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

const results: CheckResult[] = [];
const PAYPAL_BASE_URL =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

async function getPayPalAccessToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = (await res.json()) as {
    access_token?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `HTTP ${res.status}: ${data.error_description || JSON.stringify(data)}`
    );
  }
  return data.access_token;
}

async function verifyPayPal(): Promise<void> {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  const recipientEmail = process.env.PAYPAL_SANDBOX_RECIPIENT_EMAIL?.trim();

  if (!clientId || !clientSecret) {
    results.push({
      name: "PayPal Sandbox OAuth",
      status: "SKIP",
      detail: "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env",
    });
    return;
  }

  let token: string;
  try {
    token = await getPayPalAccessToken(clientId, clientSecret);
    results.push({
      name: "PayPal Sandbox OAuth",
      status: "PASS",
      detail: "Access token acquired from api-m.sandbox.paypal.com",
    });
  } catch (err) {
    results.push({
      name: "PayPal Sandbox OAuth",
      status: "FAIL",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Test Orders v2 creation (used for Human-in-the-Loop escalated approvals)
  try {
    const orderRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: `sentinel-verify-${Date.now()}`,
            description: "SentinelPay Verification Order (HITL Test)",
            amount: { currency_code: "USD", value: "12.50" },
          },
        ],
      }),
    });
    const orderData = (await orderRes.json()) as {
      id?: string;
      status?: string;
      links?: Array<{ rel: string; href: string }>;
      message?: string;
    };
    if (!orderRes.ok || !orderData.id) {
      throw new Error(
        `HTTP ${orderRes.status}: ${orderData.message || JSON.stringify(orderData)}`
      );
    }
    const approveUrl = orderData.links?.find((l) => l.rel === "approve")?.href;
    results.push({
      name: "PayPal Orders v2 (HITL Flow)",
      status: "PASS",
      detail: `Order ${orderData.id} (${orderData.status}), approve link ready: ${Boolean(approveUrl)}`,
    });
  } catch (err) {
    results.push({
      name: "PayPal Orders v2 (HITL Flow)",
      status: "FAIL",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Test Payouts v1 (used for autonomous server-to-server vendor disbursements)
  if (!recipientEmail) {
    results.push({
      name: "PayPal Payouts v1 (Autonomous Flow)",
      status: "SKIP",
      detail: "Set PAYPAL_SANDBOX_RECIPIENT_EMAIL in .env (Personal sandbox email)",
    });
    return;
  }

  try {
    const batchId = `sentinel_verify_${Date.now()}`;
    const payoutRes = await fetch(`${PAYPAL_BASE_URL}/v1/payments/payouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender_batch_header: {
          sender_batch_id: batchId,
          email_subject: "SentinelPay Autonomous Vendor Payout Test",
          email_message: "Verification payout from SentinelPay IoT Agent.",
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: { value: "1.25", currency: "USD" },
            note: "SentinelPay verification test payout",
            sender_item_id: `item_${Date.now()}`,
            receiver: recipientEmail,
          },
        ],
      }),
    });
    const payoutData = (await payoutRes.json()) as {
      batch_header?: { payout_batch_id: string; batch_status: string };
      name?: string;
      message?: string;
    };
    if (!payoutRes.ok || !payoutData.batch_header?.payout_batch_id) {
      throw new Error(
        `HTTP ${payoutRes.status}: ${payoutData.name || ""} ${payoutData.message || JSON.stringify(payoutData)}`
      );
    }
    results.push({
      name: "PayPal Payouts v1 (Autonomous Flow)",
      status: "PASS",
      detail: `Batch ${payoutData.batch_header.payout_batch_id} (${payoutData.batch_header.batch_status})`,
    });
  } catch (err) {
    results.push({
      name: "PayPal Payouts v1 (Autonomous Flow)",
      status: "FAIL",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function verifyGemini(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const preferred =
    process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
  const models = Array.from(
    new Set([
      preferred,
      "gemini-3.1-flash-lite",
      "gemini-flash-lite-latest",
      "gemini-3.1-flash-lite-preview",
      "gemini-3-flash-preview",
    ])
  );

  if (!apiKey) {
    results.push({
      name: "Gemini Structured Reasoning",
      status: "SKIP",
      detail: "Set GEMINI_API_KEY in .env (https://aistudio.google.com/apikey)",
    });
    return;
  }

  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 20000 } });
  let lastErr: unknown;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents:
          "Node CNC-04 telemetry: motorTempC=89.4 (baseline 54C), vibrationMmS=9.8 (baseline 2.1), coolingFanRpm=920 (expected 3200). Diagnose likely failing part and generate a concise replacement search query.",
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              diagnosis: { type: Type.STRING },
              failingComponent: { type: Type.STRING },
              recommendedPartQuery: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              urgency: { type: Type.STRING },
            },
            required: [
              "diagnosis",
              "failingComponent",
              "recommendedPartQuery",
              "confidence",
              "urgency",
            ],
          },
        },
      });

      if (!response.text) {
        throw new Error("Empty response from Gemini");
      }
      const parsed = JSON.parse(response.text) as {
        failingComponent: string;
        recommendedPartQuery: string;
        confidence: number;
      };
      results.push({
        name: `Gemini (${model})`,
        status: "PASS",
        detail: `Diagnosed "${parsed.failingComponent}" (conf=${parsed.confidence}) -> query "${parsed.recommendedPartQuery}"`,
      });
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  results.push({
    name: `Gemini (${preferred})`,
    status: "FAIL",
    detail: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
}

async function verifyChannel3(): Promise<void> {
  const apiKey = process.env.CHANNEL3_API_KEY?.trim();
  if (!apiKey) {
    results.push({
      name: "Channel3 Product Search",
      status: "SKIP",
      detail:
        "Set CHANNEL3_API_KEY in .env (trychannel3.com/developers, promo PAYPAL-HACKATHON-2026)",
    });
    return;
  }

  try {
    const res = await fetch("https://api.trychannel3.com/v1/search", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: "24v brushless cooling fan 80mm",
        limit: 3,
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
    }
    const data = JSON.parse(raw) as unknown;
    const obj = data as {
      data?: unknown[];
      products?: unknown[];
      results?: unknown[];
    };
    const items = Array.isArray(data)
      ? data
      : obj.data || obj.products || obj.results || [];
    results.push({
      name: "Channel3 Product Search",
      status: "PASS",
      detail: `Returned ${items.length} product result(s)`,
    });
  } catch (err) {
    results.push({
      name: "Channel3 Product Search",
      status: "FAIL",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function main() {
  console.log("\n=== SentinelPay API Verification ===\n");
  await verifyPayPal();
  await verifyGemini();
  await verifyChannel3();

  for (const r of results) {
    const tag =
      r.status === "PASS" ? "[PASS]" : r.status === "FAIL" ? "[FAIL]" : "[SKIP]";
    console.log(`${tag} ${r.name}\n       ${r.detail}\n`);
  }

  const hasFailures = results.some((r) => r.status === "FAIL");
  if (hasFailures) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Unexpected verification error:", err);
  process.exit(1);
});
