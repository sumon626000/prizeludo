import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    NODE_ENV: "production",
    API_PUBLIC_URL: "https://api.prizejito.com",
  },
  isAllowedWebOrigin: () => true,
  isProduction: true,
}));

describe("enforceHttps behind Apache", () => {
  it("does not redirect when Apache proxies from localhost without x-forwarded-proto", async () => {
    const { enforceHttps } = await import("./security.js");

    const request = {
      secure: false,
      originalUrl: "/api/health",
      header(name: string) {
        if (name === "x-forwarded-proto") return undefined;
        return undefined;
      },
      get(name: string) {
        if (name === "host") return "api.prizejito.com";
        return undefined;
      },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;

    let nextCalled = false;
    const response = {
      redirect: vi.fn(),
    };

    enforceHttps(request, response as never, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(response.redirect).not.toHaveBeenCalled();
  });

  it("redirects plain HTTP requests that are not behind the public host or localhost proxy", async () => {
    const { enforceHttps } = await import("./security.js");

    const request = {
      secure: false,
      originalUrl: "/api/health",
      header() {
        return undefined;
      },
      get(name: string) {
        if (name === "host") return "example.com";
        return undefined;
      },
      socket: { remoteAddress: "203.0.113.10" },
    } as unknown as Request;

    const response = {
      redirect: vi.fn(),
    };

    enforceHttps(request, response as never, () => {});

    expect(response.redirect).toHaveBeenCalledWith(
      308,
      "https://api.prizejito.com/api/health",
    );
  });
});
