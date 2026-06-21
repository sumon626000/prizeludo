import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createZiniPayCheckout,
  isCompletedZiniPayStatus,
  verifyZiniPayPayment,
} from "./zinipay.service.js";

describe("ZiniPay adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the official create payment endpoint and API key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          payment_url: "https://pay.zinipay.com/payment/INV-123",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const invoice = await createZiniPayCheckout(
      {
        apiKey: "secret-key",
        baseUrl: "https://api.zinipay.com/",
      },
      {
        transactionId: "deposit-id",
        userId: "user-id",
        gameId: "12345",
        name: "Prize Player",
        email: null,
        amount: "500.00",
      },
    );

    expect(invoice.paymentUrl).toBe("https://pay.zinipay.com/payment/INV-123");
    expect(invoice.invoiceId).toBe("INV-123");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.zinipay.com/v1/payment/create");
    expect(init.headers).toEqual(
      expect.objectContaining({
        "zini-api-key": "secret-key",
      }),
    );
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        cus_name: "Prize Player",
        cus_email: "12345@prizejito.local",
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
            status: "paid",
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

    const verified = await verifyZiniPayPayment(
      {
        apiKey: "secret-key",
        baseUrl: "https://api.zinipay.com",
      },
      "INV-100",
    );

    expect(verified).toEqual(
      expect.objectContaining({
        invoiceId: "INV-100",
        status: "paid",
        amount: "500.00",
        transactionId: "deposit-id",
        userId: "user-id",
      }),
    );
    expect(isCompletedZiniPayStatus(verified.status)).toBe(true);
    expect(isCompletedZiniPayStatus("pending")).toBe(false);
  });
});
