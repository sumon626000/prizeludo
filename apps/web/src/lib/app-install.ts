import { getRuntimeConfig } from "./api";

export const DEFAULT_APK_PATH = "/downloads/prizejito.apk";

export function isIosDevice(userAgent = navigator.userAgent): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isAndroidDevice(userAgent = navigator.userAgent): boolean {
  return /android/i.test(userAgent);
}

export function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    localStorage.getItem("khan-ludo-pwa-installed") === "true" ||
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    navigatorWithStandalone.standalone === true
  );
}

export function getApkDownloadUrl(): string {
  const configured = getRuntimeConfig()?.apkDownloadUrl?.trim();
  if (configured) return configured;
  if (typeof window === "undefined") return DEFAULT_APK_PATH;
  return new URL(DEFAULT_APK_PATH, window.location.origin).href;
}

export async function checkApkAvailable(url = getApkDownloadUrl()): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export function triggerApkDownload(url = getApkDownloadUrl()): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = "prizejito.apk";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
