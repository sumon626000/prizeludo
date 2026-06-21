import { createHmac } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

describe("API shell", () => {
  const app = createApp();

  it("applies security headers and structured 404 errors", async () => {
    const response = await request(app)
      .get("/api/missing")
      .set("x-device-id", "test-device-00000001");

    expect(response.status).toBe(404);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects unsafe requests from untrusted browser origins", async () => {
    const response = await request(app)
      .post("/api/missing")
      .set("origin", "https://attacker.example")
      .set("sec-fetch-site", "cross-site")
      .set("x-device-id", "test-device-00000002")
      .send({ action: "mutate" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("UNTRUSTED_ORIGIN");
  });
});

describe("GitHub deploy webhook", () => {
  const secret = "test-github-webhook-secret-123456";

  afterEach(() => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  it("accepts signed ping events", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    vi.resetModules();
    const { createApp: createFreshApp } = await import("./app.js");
    const app = createFreshApp();
    const payloadText = JSON.stringify({ zen: "test" });
    const signature = `sha256=${createHmac("sha256", secret).update(payloadText).digest("hex")}`;

    const response = await request(app)
      .post("/api/webhook/git-update")
      .set("x-github-event", "ping")
      .set("x-hub-signature-256", signature)
      .set("content-type", "application/json")
      .send(payloadText);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("pong");
  });
});
