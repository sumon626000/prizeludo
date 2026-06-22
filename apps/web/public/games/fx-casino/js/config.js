/* FX CASINO - Game Parameters & Global Constants Configuration */

export const CONFIG = {
  // Available tradeable assets configuration
  FOREX_ASSETS: [
    { 
      symbol: 'EUR/USD', 
      name: 'Euro / US Dollar', 
      pipsDecimal: 4, 
      basePrice: 1.09645, 
      pipValueUSD: 10.0, 
      spread: 0.6 
    }
  ],

  // Market Simulator intervals properties
  TICKS_PER_CANDLE: 45,
  TICK_INTERVAL_MS: 50,

  // Stake configuration limits
  DEFAULT_STAKE: 100.00,
  MIN_STAKE: 10.00,
  MAX_STAKE: 10000.00,
  STAKE_PRESETS: [10, 50, 100, 250, 500, 1000, 2000, 5000],

  // Simulator accounts settings
  BASE_BALANCE: 1000.00,

  // Settlement rules
  TRADE_DURATION_CANDLES: 7, // Trades mature in 7 completed candlesticks
  WIN_MULTIPLIER: 2,

  // Probabilities & Win Bias parameters (aligning with active trend boosts winning probability)
  WIN_BIAS_TREND: 0.70,         // 70% chance of winning when trading in the trend direction
  WIN_BIAS_COUNTER_TREND: 0.30, // Lower chance when gaming against trend force
  WIN_BIAS_NORMAL: 0.52,        // Mild baseline bias for unguided conditions

  // Canvas Layout constants
  PADDING_RIGHT_AXIS: 80,
  CHART_RIGHT_PADDING: 40,
  DEFAULT_ZOOM: 11,
  CANDLE_GAP: 2
};
