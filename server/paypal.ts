import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

export interface PayoutExecutionResult {
  batchId: string;
  batchStatus: string;
  recipientEmail: string;
}

export interface OrderCreationResult {
  orderId: string;
  status: string;
  approveUrl: string;
}

export interface OrderCaptureResult {
  orderId: string;
  status: string;
  captureId: string | null;
}

let cachedToken: CachedToken | null = null;
let cachedToolkit: PayPalAgentToolkit | null = null;

function getPayPalAgentToolkit(): PayPalAgentToolkit {
  if (cachedToolkit) return cachedToolkit;
  const { clientId, clientSecret } = getPayPalCredentials();
  cachedToolkit = new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: {
      actions: {
        orders: { create: true, get: true, capture: true },
        transactions: { list: true },
      },
      context: {
        sandbox: process.env.PAYPAL_ENV !== "live",
      },
    },
  });
  return cachedToolkit;
}

/**
 * Queries order details via PayPal's official Agent Toolkit (@paypal/agent-toolkit).
 */
export async function getOrderViaToolkit(orderId: string): Promise<unknown> {
  const tools = getPayPalAgentToolkit().getTools();
  const getOrderTool = tools.get_order as unknown as {
    execute: (args: { id: string }, ctx?: unknown) => Promise<string>;
  };
  const raw = await getOrderTool.execute(
    { id: orderId },
    { toolCallId: `get_order_${Date.now()}`, messages: [] }
  );
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { raw };
  }
}

/**
 * Lists recent sandbox transactions via PayPal's official Agent Toolkit.
 */
export async function listTransactionsViaToolkit(): Promise<unknown> {
  const tools = getPayPalAgentToolkit().getTools();
  const listTxTool = tools.list_transactions as unknown as {
    execute: (args: Record<string, unknown>, ctx?: unknown) => Promise<string>;
  };
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const raw = await listTxTool.execute(
    {
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      page_size: 10,
    },
    { toolCallId: `list_tx_${Date.now()}`, messages: [] }
  );
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { raw };
  }
}

function getPayPalBaseUrl(): string {
  return process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function getPayPalCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in environment."
    );
  }
  return { clientId, clientSecret };
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 60_000) {
    return cachedToken.token;
  }

  const { clientId, clientSecret } = getPayPalCredentials();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `PayPal OAuth failed (${res.status}): ${data.error_description || JSON.stringify(data)}`
    );
  }

  cachedToken = {
    token: data.access_token,
    expiresAtMs: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedToken.token;
}

/**
 * Executes an autonomous server-to-server PayPal Payout for an approved
 * replacement part purchase without requiring browser interaction.
 */
export async function sendAutonomousPayout(params: {
  amountUsd: number;
  note: string;
  itemId: string;
  recipientEmail?: string;
}): Promise<PayoutExecutionResult> {
  const recipientEmail =
    params.recipientEmail?.trim() ||
    process.env.PAYPAL_SANDBOX_RECIPIENT_EMAIL?.trim();
  if (!recipientEmail) {
    throw new Error(
      "Missing PAYPAL_SANDBOX_RECIPIENT_EMAIL for autonomous payout."
    );
  }

  const token = await getAccessToken();
  const batchSenderId = `sentinel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const res = await fetch(`${getPayPalBaseUrl()}/v1/payments/payouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: batchSenderId,
        email_subject: "SentinelPay Autonomous Parts Procurement",
        email_message: params.note.slice(0, 200),
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: {
            value: params.amountUsd.toFixed(2),
            currency: "USD",
          },
          note: params.note.slice(0, 200),
          sender_item_id: params.itemId.slice(0, 63),
          receiver: recipientEmail,
        },
      ],
    }),
  });

  const data = (await res.json()) as {
    batch_header?: { payout_batch_id: string; batch_status: string };
    name?: string;
    message?: string;
    details?: Array<{ field?: string; issue?: string }>;
  };
  if (!res.ok || !data.batch_header?.payout_batch_id) {
    const details = data.details ? ` ${JSON.stringify(data.details)}` : "";
    throw new Error(
      `PayPal Payouts failed (${res.status}): ${data.name || ""} ${data.message || JSON.stringify(data)}${details}`
    );
  }

  return {
    batchId: data.batch_header.payout_batch_id,
    batchStatus: data.batch_header.batch_status,
    recipientEmail,
  };
}

export async function getPayoutBatchStatus(batchId: string): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch(
    `${getPayPalBaseUrl()}/v1/payments/payouts/${encodeURIComponent(batchId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data = (await res.json()) as {
    batch_header?: { batch_status?: string };
    message?: string;
  };
  if (!res.ok || !data.batch_header?.batch_status) {
    throw new Error(
      `Failed to fetch payout status (${res.status}): ${data.message || JSON.stringify(data)}`
    );
  }
  return data.batch_header.batch_status;
}

/**
 * Creates a PayPal Orders v2 checkout order for transactions that exceed
 * autonomous policy caps and require Human-in-the-Loop approval.
 */
export async function createHitlOrder(params: {
  amountUsd: number;
  description: string;
  referenceId: string;
  returnBaseUrl: string;
}): Promise<OrderCreationResult> {
  const cleanBase = params.returnBaseUrl.replace(/\/+$/, "");
  const token = await getAccessToken();
  const res = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: params.referenceId,
          description: params.description.slice(0, 127),
          amount: {
            currency_code: "USD",
            value: params.amountUsd.toFixed(2),
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "SentinelPay Procurement",
            user_action: "PAY_NOW",
            return_url: `${cleanBase}/?paypal_status=approved`,
            cancel_url: `${cleanBase}/?paypal_status=cancelled`,
          },
        },
      },
    }),
  });

  const data = (await res.json()) as {
    id?: string;
    status?: string;
    links?: Array<{ rel: string; href: string }>;
    message?: string;
  };
  if (!res.ok || !data.id) {
    throw new Error(
      `PayPal Create Order failed (${res.status}): ${data.message || JSON.stringify(data)}`
    );
  }

  const approveUrl =
    data.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")
      ?.href || "";

  return {
    orderId: data.id,
    status: data.status || "PAYER_ACTION_REQUIRED",
    approveUrl,
  };
}

export async function captureHitlOrder(
  orderId: string
): Promise<OrderCaptureResult> {
  const token = await getAccessToken();
  const res = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  const data = (await res.json()) as {
    id?: string;
    status?: string;
    purchase_units?: Array<{
      payments?: { captures?: Array<{ id: string }> };
    }>;
    message?: string;
    details?: Array<{ issue?: string; description?: string }>;
  };

  if (!res.ok || !data.id) {
    const issue = data.details?.[0]?.issue || data.message || JSON.stringify(data);
    throw new Error(`PayPal Capture failed (${res.status}): ${issue}`);
  }

  const captureId =
    data.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

  return {
    orderId: data.id,
    status: data.status || "COMPLETED",
    captureId,
  };
}
