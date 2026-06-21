import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createUddoktaCheckout,
  isCompletedUddoktaStatus,
  verifyUddoktaPayment,
} from "./uddoktapay.service.js";

describe("Uddokta Pay adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the official checkout endpoint and API key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ payment_url: "https://pay.example/checkout/abc" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const paymentUrl = await createUddoktaCheckout(
      {
        apiKey: "secret-key",
        baseUrl: "https://merchant.example/api/",
      },
      {
        transactionId: "deposit-id",
        userId: "user-id",
        gameId: "12345",
        name: "Khan Player",
        email: null,
        amount: "500.00",
      },
    );

    expect(paymentUrl).toBe("https://pay.example/checkout/abc");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://merchant.example/api/checkout-v2");
    expect(init.headers).toEqual(
      expect.objectContaining({
        "RT-UDDOKTAPAY-API-KEY": "secret-key",
      }),
    );
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        amount: 500,
        metadata: expect.objectContaining({
          transaction_id: "deposit-id",
          user_id: "user-id",
        }),
      }),
    );
  });

  it("normalizes verified payment metadata and completed statuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            invoice_id: "INV-100",
            status: "COMPLETED",
            amount: "500.00",
            metadata: {
              transaction_id: "deposit-id",
              user_id: "user-id",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const verified = await verifyUddoktaPayment(
      {
        apiKey: "secret-key",
        baseUrl: "https://merchant.example/api",
      },
      "INV-100",
    );

    expect(verified).toEqual(
      expect.objectContaining({
        invoiceId: "INV-100",
        status: "COMPLETED",
        amount: "500.00",
        transactionId: "deposit-id",
        userId: "user-id",
      }),
    );
    expect(isCompletedUddoktaStatus(verified.status)).toBe(true);
    expect(isCompletedUddoktaStatus("pending")).toBe(false);
  });
});
