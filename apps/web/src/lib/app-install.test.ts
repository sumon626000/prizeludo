import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APK_PATH,
  getApkDownloadUrl,
  isAndroidDevice,
  isIosDevice,
} from "./app-install";

vi.mock("./api", () => ({
  getRuntimeConfig: vi.fn(() => null),
}));

describe("app install helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects android and ios user agents", () => {
    expect(isAndroidDevice("Mozilla/5.0 (Linux; Android 14)")).toBe(true);
    expect(isAndroidDevice("Mozilla/5.0 (Windows NT 10.0)")).toBe(false);
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
  });

  it("falls back to the default apk path", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://prizejito.com" },
    });
    expect(getApkDownloadUrl()).toBe(`https://prizejito.com${DEFAULT_APK_PATH}`);
  });
});
