import {
  resolveZiniPayBrandOrigin,
  resolveZiniPayWebhookUrl,
} from "../config.js";
import { AppError } from "../lib/errors.js";

export interface ZiniPayCredentials {
  apiKey: string;
  baseUrl: string;
}

interface CheckoutInput {
  transactionId: string;
  userId: string;
  gameId: string;
  name: string;
  email: string | null;
  amount: string;
}

export interface CreatedZiniPayInvoice {
  paymentUrl: string;
  invoiceId: string | null;
  raw: Record<string, unknown>;
}

export interface VerifiedZiniPayPayment {
  invoiceId: string;
  amount: string;
  status: string;
  transactionId: string | null;
  userId: string | null;
  raw: Record<string, unknown>;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value || "https://api.zinipay.com");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function mapProviderError(message: string): string {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("invalid api key")) {
    return "ZiniPay Brand API key সঠিক নয়। Dashboard → Brands → Brand Key কপি করে Admin Settings-এ দিন। Brand website domain prizejito.com হতে হবে।";
  }
  if (normalized.includes("redirect") || normalized.includes("domain")) {
    return "ZiniPay brand domain match হচ্ছে না। ZiniPay dashboard-এ brand website prizejito.com সেট করুন।";
  }
  return message;
}

function providerRequestFailed(payload: Record<string, unknown>): boolean {
  if (payload.status === false || payload.success === false) return true;
  if (payload.status === true || payload.success === true) return false;
  return false;
}

async function providerRequest(
  credentials: ZiniPayCredentials,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(
      `${normalizeBaseUrl(credentials.baseUrl)}/${endpoint.replace(/^\//, "")}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "zini-api-key": credentials.apiKey,
          "zinipay-api-key": credentials.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    throw new AppError(
      502,
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Payment provider unavailable. Please try again.",
    );
  }

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok || providerRequestFailed(payload)) {
    const rawMessage =
      typeof payload.message === "string"
        ? payload.message
        : "Payment provider rejected the request.";
    throw new AppError(
      502,
      "PAYMENT_PROVIDER_ERROR",
      mapProviderError(rawMessage),
    );
  }
  return payload;
}

function extractInvoiceId(paymentUrl: string): string | null {
  try {
    const url = new URL(paymentUrl);
    return url.pathname.split("/").filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

function readMetadata(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return payload.metadata &&
    typeof payload.metadata === "object" &&
    !Array.isArray(payload.metadata)
    ? (payload.metadata as Record<string, unknown>)
    : {};
}

export async function createZiniPayCheckout(
  credentials: ZiniPayCredentials,
  input: CheckoutInput,
): Promise<CreatedZiniPayInvoice> {
  const brandOrigin = resolveZiniPayBrandOrigin();
  const payload = await providerRequest(credentials, "v1/payment/create", {
    cus_name: input.name,
    cus_email: input.email ?? `${input.gameId}@prizejito.local`,
    amount: Number(input.amount),
    metadata: {
      transaction_id: input.transactionId,
      user_id: input.userId,
      game_id: input.gameId,
    },
    redirect_url: `${brandOrigin}/wallet?payment=return`,
    cancel_url: `${brandOrigin}/wallet?tab=deposit&payment=cancelled`,
    webhook_url: resolveZiniPayWebhookUrl(),
  });
  if (typeof payload.payment_url !== "string") {
    throw new AppError(
      502,
      "PAYMENT_URL_MISSING",
      "Payment checkout URL was not returned.",
    );
  }
  return {
    paymentUrl: payload.payment_url,
    invoiceId:
      typeof payload.invoice_id === "string"
        ? payload.invoice_id
        : typeof payload.invoiceId === "string"
          ? payload.invoiceId
          : extractInvoiceId(payload.payment_url),
    raw: payload,
  };
}

export async function verifyZiniPayPayment(
  credentials: ZiniPayCredentials,
  invoiceId: string,
): Promise<VerifiedZiniPayPayment> {
  const payload = await providerRequest(credentials, "v1/payment/verify", {
    invoice_id: invoiceId,
  });
  const metadata = readMetadata(payload);
  return {
    invoiceId:
      typeof payload.invoice_id === "string" ? payload.invoice_id : invoiceId,
    amount: String(payload.amount ?? ""),
    status: String(payload.status ?? ""),
    transactionId:
      typeof metadata.transaction_id === "string"
        ? metadata.transaction_id
        : null,
    userId: typeof metadata.user_id === "string" ? metadata.user_id : null,
    raw: payload,
  };
}

export function isCompletedZiniPayStatus(status: string): boolean {
  return ["completed", "success", "paid", "true"].includes(
    status.trim().toLowerCase(),
  );
}
