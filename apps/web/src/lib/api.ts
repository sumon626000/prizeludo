import FingerprintJS from "@fingerprintjs/fingerprintjs";

function normalizeUrl(value: string) {
  return value.replace(/\/$/, "");
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function resolveApiUrlFromHost(): string | null {
  if (typeof window === "undefined") return null;

  const { hostname, protocol } = window.location;
  if (hostname === "prizejito.com" || hostname === "www.prizejito.com") {
    return "https://api.prizejito.com";
  }

  const baseHost = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  if (
    baseHost === "localhost" ||
    baseHost === "127.0.0.1" ||
    /^\d+\.\d+\.\d+\.\d+$/.test(baseHost)
  ) {
    return null;
  }

  return normalizeUrl(`${protocol}//api.${baseHost}`);
}

function resolveApiUrl(): string {
  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    // Local dev/preview: same-origin requests via Vite proxy → local API.
    if (isLocalHostname(hostname)) {
      return origin;
    }
  }

  const configuredUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (
    configuredUrl &&
    !/localhost|127\.0\.0\.1/.test(configuredUrl)
  ) {
    return normalizeUrl(configuredUrl);
  }

  return resolveApiUrlFromHost() ?? normalizeUrl(configuredUrl || "http://localhost:4000");
}

export let API_URL = resolveApiUrl();

export async function initRuntimeConfig(): Promise<string> {
  if (typeof window === "undefined") {
    API_URL = resolveApiUrl();
    return API_URL;
  }

  // Never use production runtime-config on localhost/LAN — always hit local API.
  if (isLocalHostname(window.location.hostname)) {
    API_URL = resolveApiUrl();
    return API_URL;
  }

  try {
    const response = await fetch("/runtime-config.json", { cache: "no-store" });
    if (response.ok) {
      const body = (await response.json()) as { apiUrl?: string };
      if (body.apiUrl && !/localhost|127\.0\.0\.1/.test(body.apiUrl)) {
        API_URL = normalizeUrl(body.apiUrl);
        return API_URL;
      }
    }
  } catch {
    // Fall back to build-time/host mapping below.
  }

  API_URL = resolveApiUrl();
  return API_URL;
}

export function getGoogleLoginUrl() {
  return `${API_URL}/api/auth/google`;
}

let deviceIdPromise: Promise<string> | undefined;

function getDeviceId(): Promise<string> {
  deviceIdPromise ??= Promise.race([
    FingerprintJS.load()
      .then((agent) => agent.get())
      .then((result) => result.visitorId),
    new Promise<string>((resolve) => {
      window.setTimeout(() => resolve("local-device"), 4_000);
    }),
  ]).catch(() => "local-device");
  return deviceIdPromise;
}

export async function apiUpload<T>(
  path: string,
  file: File,
): Promise<T> {
  const deviceId = await getDeviceId();
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": file.type,
      "x-device-id": deviceId,
    },
    body: file,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string } }
      | undefined;
    throw new ApiError(
      body?.error?.code || "UPLOAD_FAILED",
      body?.error?.message || "Upload failed.",
      response.status,
    );
  }
  return (await response.json()) as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const deviceId = await getDeviceId();
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "x-device-id": deviceId },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string } }
      | undefined;
    throw new ApiError(
      body?.error?.code || "DOWNLOAD_FAILED",
      body?.error?.message || "Download failed.",
      response.status,
    );
  }
  return response.blob();
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function formatFetchError(error: unknown): Error {
  if (error instanceof ApiError) return error;
  if (error instanceof TypeError) {
    return new Error(
      "API server unreachable. Please wait a moment and try again.",
    );
  }
  if (error instanceof Error) return error;
  return new Error("Request failed.");
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const deviceId = await getDeviceId();
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-device-id": deviceId,
        ...init.headers,
      },
    });
  } catch (error) {
    throw formatFetchError(error);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string } }
      | undefined;
    throw new ApiError(
      body?.error?.code || "REQUEST_FAILED",
      body?.error?.message || "Request failed.",
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      "API server unreachable. Please wait a moment and try again.",
    );
  }
  return (await response.json()) as T;
}

/** @deprecated Use getGoogleLoginUrl() so runtime config stays in sync. */
export const googleLoginUrl = getGoogleLoginUrl();
