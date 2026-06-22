import { describe, expect, it } from "vitest";
import { mapTradeJitoSettings } from "./trade-jito-settings.service.js";

describe("trade jito settings", () => {
  it("maps stored values with defaults", () => {
    expect(
      mapTradeJitoSettings({
        "trade_jito.enabled": "true",
        "trade_jito.min_stake": "20",
        "trade_jito.max_stake": "5000",
        "trade_jito.default_stake": "50",
        "trade_jito.win_bias_trend": "65",
        "trade_jito.win_bias_counter_trend": "25",
        "trade_jito.win_bias_neutral": "50",
        "trade_jito.win_multiplier": "2.5",
        "trade_jito.win_commission_percent": "5",
      }),
    ).toEqual({
      enabled: true,
      minStake: 20,
      maxStake: 5000,
      defaultStake: 50,
      winBiasTrend: 65,
      winBiasCounterTrend: 25,
      winBiasNeutral: 50,
      winMultiplier: 2.5,
      winCommissionPercent: 5,
    });
  });
});
