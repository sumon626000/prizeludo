import { config } from "../config.js";
import { AppError } from "../lib/errors.js";

export interface UddoktaPayCredentials {
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

export interface VerifiedUddoktaPayment {
  invoiceId: string;
  amount: string;
  status: string;
  transactionId: string | null;
  userId: string | null;
  raw: Record<string, unknown>;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  const apiIndex = url.pathname.indexOf("/api");
  url.pathname =
    apiIndex >= 0 ? url.pathname.slice(0, apiIndex + 4) : `${url.pathname}/api`;
  url.pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function providerRequest(
  credentials: UddoktaPayCredentials,
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
          "RT-UDDOKTAPAY-API-KEY": credentials.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    throw new AppError(
      502,
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "পেমেন্ট সেবায় সংযোগ করা যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।",
    );
  }

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new AppError(
      502,
      "PAYMENT_PROVIDER_ERROR",
      typeof payload.message === "string"
        ? payload.message
        : "পেমেন্ট সেবা অনুরোধটি গ্রহণ করেনি।",
    );
  }
  return payload;
}

export async function createUddoktaCheckout(
  credentials: UddoktaPayCredentials,
  input: CheckoutInput,
): Promise<string> {
  const payload = await providerRequest(credentials, "checkout-v2", {
    full_name: input.name,
    email: input.email ?? `${input.gameId}@khanludo.local`,
    amount: Number(input.amount),
    metadata: {
      transaction_id: input.transactionId,
      user_id: input.userId,
      game_id: input.gameId,
    },
    redirect_url: `${config.API_PUBLIC_URL}/api/wallet/uddoktapay/return`,
    return_type: "GET",
    cancel_url: `${config.WEB_ORIGIN}/wallet?payment=cancelled`,
    webhook_url: `${config.API_PUBLIC_URL}/api/wallet/uddoktapay/webhook`,
  });
  if (typeof payload.payment_url !== "string") {
    throw new AppError(
      502,
      "PAYMENT_URL_MISSING",
      "পেমেন্ট checkout URL পাওয়া যায়নি।",
    );
  }
  return payload.payment_url;
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

export async function verifyUddoktaPayment(
  credentials: UddoktaPayCredentials,
  invoiceId: string,
): Promise<VerifiedUddoktaPayment> {
  const payload = await providerRequest(credentials, "verify-payment", {
    invoice_id: invoiceId,
  });
  const metadata = readMetadata(payload);
  const amount = payload.amount ?? payload.charged_amount;
  return {
    invoiceId:
      typeof payload.invoice_id === "string" ? payload.invoice_id : invoiceId,
    amount: String(amount ?? ""),
    status: String(payload.status ?? payload.payment_status ?? ""),
    transactionId:
      typeof metadata.transaction_id === "string"
        ? metadata.transaction_id
        : null,
    userId: typeof metadata.user_id === "string" ? metadata.user_id : null,
    raw: payload,
  };
}

export function isCompletedUddoktaStatus(status: string): boolean {
  return ["completed", "success", "paid"].includes(status.trim().toLowerCase());
}
