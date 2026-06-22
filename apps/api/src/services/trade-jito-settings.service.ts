import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { getSettings, updateSettingsWithAudit } from "./settings.service.js";

export const TRADE_JITO_SETTING_KEYS = [
  "trade_jito.enabled",
  "trade_jito.min_stake",
  "trade_jito.max_stake",
  "trade_jito.default_stake",
  "trade_jito.win_bias_trend",
  "trade_jito.win_bias_counter_trend",
  "trade_jito.win_bias_neutral",
  "trade_jito.win_multiplier",
  "trade_jito.win_commission_percent",
] as const;

export type TradeJitoSettings = {
  enabled: boolean;
  minStake: number;
  maxStake: number;
  defaultStake: number;
  winBiasTrend: number;
  winBiasCounterTrend: number;
  winBiasNeutral: number;
  winMultiplier: number;
  winCommissionPercent: number;
};

export type TradeJitoPublicSettings = Pick<
  TradeJitoSettings,
  "enabled" | "minStake" | "maxStake" | "defaultStake" | "winMultiplier"
>;

const DEFAULTS: TradeJitoSettings = {
  enabled: true,
  minStake: 10,
  maxStake: 10_000,
  defaultStake: 10,
  winBiasTrend: 70,
  winBiasCounterTrend: 30,
  winBiasNeutral: 52,
  winMultiplier: 2,
  winCommissionPercent: 0,
};

let cachedSettings: TradeJitoSettings | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 15_000;

function parsePercent(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

function parseMoney(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseMultiplier(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 10);
}

export function mapTradeJitoSettings(
  values: Partial<Record<(typeof TRADE_JITO_SETTING_KEYS)[number], string>>,
): TradeJitoSettings {
  const minStake = parseMoney(values["trade_jito.min_stake"], DEFAULTS.minStake);
  const maxStake = parseMoney(values["trade_jito.max_stake"], DEFAULTS.maxStake);
  const defaultStake = parseMoney(
    values["trade_jito.default_stake"],
    DEFAULTS.defaultStake,
  );

  return {
    enabled: values["trade_jito.enabled"] !== "false",
    minStake: Math.min(minStake, maxStake),
    maxStake: Math.max(minStake, maxStake),
    defaultStake: Math.min(Math.max(defaultStake, minStake), maxStake),
    winBiasTrend: parsePercent(
      values["trade_jito.win_bias_trend"],
      DEFAULTS.winBiasTrend,
    ),
    winBiasCounterTrend: parsePercent(
      values["trade_jito.win_bias_counter_trend"],
      DEFAULTS.winBiasCounterTrend,
    ),
    winBiasNeutral: parsePercent(
      values["trade_jito.win_bias_neutral"],
      DEFAULTS.winBiasNeutral,
    ),
    winMultiplier: parseMultiplier(
      values["trade_jito.win_multiplier"],
      DEFAULTS.winMultiplier,
    ),
    winCommissionPercent: parsePercent(
      values["trade_jito.win_commission_percent"],
      DEFAULTS.winCommissionPercent,
    ),
  };
}

export function toPublicTradeJitoSettings(
  settings: TradeJitoSettings,
): TradeJitoPublicSettings {
  return {
    enabled: settings.enabled,
    minStake: settings.minStake,
    maxStake: settings.maxStake,
    defaultStake: settings.defaultStake,
    winMultiplier: settings.winMultiplier,
  };
}

export async function loadTradeJitoSettings(): Promise<TradeJitoSettings> {
  const values = await getSettings(TRADE_JITO_SETTING_KEYS);
  return mapTradeJitoSettings(values);
}

export async function getTradeJitoSettings(): Promise<TradeJitoSettings> {
  if (cachedSettings && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }
  cachedSettings = await loadTradeJitoSettings();
  cacheLoadedAt = Date.now();
  return cachedSettings;
}

export function invalidateTradeJitoSettingsCache() {
  cachedSettings = null;
  cacheLoadedAt = 0;
}

const adminPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    minStake: z.number().positive().max(1_000_000).optional(),
    maxStake: z.number().positive().max(1_000_000).optional(),
    defaultStake: z.number().positive().max(1_000_000).optional(),
    winBiasTrend: z.number().min(0).max(100).optional(),
    winBiasCounterTrend: z.number().min(0).max(100).optional(),
    winBiasNeutral: z.number().min(0).max(100).optional(),
    winMultiplier: z.number().min(1).max(10).optional(),
    winCommissionPercent: z.number().min(0).max(100).optional(),
  })
  .strict();

export async function updateTradeJitoSettings(input: {
  patch: z.infer<typeof adminPatchSchema>;
  actorId: string;
  ipAddress: string;
}) {
  const current = await getTradeJitoSettings();
  const next: TradeJitoSettings = {
    enabled: input.patch.enabled ?? current.enabled,
    minStake: input.patch.minStake ?? current.minStake,
    maxStake: input.patch.maxStake ?? current.maxStake,
    defaultStake: input.patch.defaultStake ?? current.defaultStake,
    winBiasTrend: input.patch.winBiasTrend ?? current.winBiasTrend,
    winBiasCounterTrend:
      input.patch.winBiasCounterTrend ?? current.winBiasCounterTrend,
    winBiasNeutral: input.patch.winBiasNeutral ?? current.winBiasNeutral,
    winMultiplier: input.patch.winMultiplier ?? current.winMultiplier,
    winCommissionPercent:
      input.patch.winCommissionPercent ?? current.winCommissionPercent,
  };

  if (next.minStake > next.maxStake) {
    throw new AppError(
      400,
      "INVALID_STAKE_RANGE",
      "Minimum stake cannot exceed maximum stake.",
    );
  }
  if (next.defaultStake < next.minStake || next.defaultStake > next.maxStake) {
    throw new AppError(
      400,
      "INVALID_DEFAULT_STAKE",
      "Default stake must stay within the min/max range.",
    );
  }

  await updateSettingsWithAudit({
    values: {
      "trade_jito.enabled": String(next.enabled),
      "trade_jito.min_stake": String(next.minStake),
      "trade_jito.max_stake": String(next.maxStake),
      "trade_jito.default_stake": String(next.defaultStake),
      "trade_jito.win_bias_trend": String(next.winBiasTrend),
      "trade_jito.win_bias_counter_trend": String(next.winBiasCounterTrend),
      "trade_jito.win_bias_neutral": String(next.winBiasNeutral),
      "trade_jito.win_multiplier": String(next.winMultiplier),
      "trade_jito.win_commission_percent": String(next.winCommissionPercent),
    },
    actorId: input.actorId,
    ipAddress: input.ipAddress,
    action: "trade_jito.settings.update",
    targetType: "trade_jito_settings",
  });

  invalidateTradeJitoSettingsCache();
  return getTradeJitoSettings();
}

export { adminPatchSchema };
