import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

const emptyToUndefined = (value: unknown) =>
  value === "" || value === undefined ? undefined : value;

const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());

const optionalNonemptyString = z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.url().default("http://localhost:5173"),
  API_PUBLIC_URL: z.url().default("http://localhost:4000"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://khan_ludo:khan_ludo@localhost:5432/khan_ludo"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15_000),
  JWT_SECRET: z
    .string()
    .min(32)
    .default("development-only-secret-change-before-deploy"),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(604800),
  COOKIE_NAME: z.string().min(1).default("khan_ludo_session"),
  ADMIN_CLAIM_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(24).optional(),
  ),
  GITHUB_WEBHOOK_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(16).optional(),
  ),
  DEPLOY_REPO_PATH: z
    .string()
    .min(1)
    .default("/home/nixbazar/prizeludo"),
  WEB_ROOT: z.string().min(1).default("/home/nixbazar/prizejito.com"),
  DEPLOY_BRANCH: z.string().min(1).default("main"),
  DEPLOY_SCRIPT: z.string().min(1).optional(),
  DEPLOY_RESTART_COMMAND: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: optionalNonemptyString,
  GOOGLE_CLIENT_SECRET: optionalNonemptyString,
  GOOGLE_CALLBACK_URL: optionalUrl,
  ZINI_PAY_API_KEY: optionalNonemptyString,
  ZINI_PAY_BRAND_ORIGIN: optionalUrl,
  ZINI_PAY_WEBHOOK_URL: optionalUrl,
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
});

const parsed = envSchema.parse(process.env);

export const config = {
  ...parsed,
  TRUST_PROXY:
    parsed.TRUST_PROXY > 0
      ? parsed.TRUST_PROXY
      : parsed.NODE_ENV === "production"
        ? 1
        : 0,
};
export const isProduction = config.NODE_ENV === "production";

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

export function resolveZiniPayBrandOrigin(): string {
  if (config.ZINI_PAY_BRAND_ORIGIN) {
    return stripTrailingSlash(config.ZINI_PAY_BRAND_ORIGIN);
  }
  try {
    const web = new URL(config.WEB_ORIGIN);
    if (
      web.hostname === "localhost" ||
      web.hostname === "127.0.0.1" ||
      web.hostname === "[::1]"
    ) {
      return "https://prizejito.com";
    }
    if (web.hostname.startsWith("api.")) {
      return stripTrailingSlash(`${web.protocol}//${web.hostname.slice(4)}`);
    }
    return stripTrailingSlash(config.WEB_ORIGIN);
  } catch {
    return "https://prizejito.com";
  }
}

export function resolveZiniPayWebhookUrl(): string {
  if (config.ZINI_PAY_WEBHOOK_URL) {
    return stripTrailingSlash(config.ZINI_PAY_WEBHOOK_URL);
  }
  return `${stripTrailingSlash(config.API_PUBLIC_URL)}/api/wallet/zinipay/webhook`;
}

export function isAllowedWebOrigin(origin: string | undefined) {
  if (!origin || origin === config.WEB_ORIGIN) return true;
  if (isProduction) return false;

  try {
    const url = new URL(origin);
    const localPort = url.port === "5173" || url.port === "5174";
    const localHostname =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      /^10\./.test(url.hostname) ||
      /^192\.168\./.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
    return localPort && localHostname;
  } catch {
    return false;
  }
}

if (isProduction) {
  if (config.JWT_SECRET === "development-only-secret-change-before-deploy") {
    throw new Error(
      "Production configuration is incomplete. Set a strong JWT_SECRET.",
    );
  }
  if (!config.ADMIN_CLAIM_SECRET) {
    throw new Error(
      "Production configuration is incomplete. Set ADMIN_CLAIM_SECRET before exposing the API.",
    );
  }
  if (
    config.DATABASE_URL ===
    "postgresql://khan_ludo:khan_ludo@localhost:5432/khan_ludo"
  ) {
    throw new Error(
      "Production configuration is incomplete. Set DATABASE_URL to your production database.",
    );
  }
}
