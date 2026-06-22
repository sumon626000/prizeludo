/* FX CASINO - Game Central Registry State Management */

import { CONFIG } from './config.js';

export const state = {
  // Active tradeable asset
  activeAsset: CONFIG.FOREX_ASSETS[0],

  // Market historical state
  candlesHistory: [],
  activePrice: CONFIG.FOREX_ASSETS[0].basePrice,
  activeCandle: null,

  // Active trade entries
  activeTrade: null,
  tradeHistory: [],

  // Wallet holdings
  account: {
    balance: CONFIG.BASE_BALANCE
  },

  // Active stake sizing choice
  stakeAmount: CONFIG.DEFAULT_STAKE,

  // Chart viewport states
  zoom: CONFIG.DEFAULT_ZOOM,
  panOffset: 0,
  isAutoScroll: true,
  currentMinPrice: null,
  currentMaxPrice: null,
  crosshair: null,
  isDragging: false,
  dragStart: { x: 0, pan: 0 },

  // Sound indicators preference
  soundEnabled: true,

  // Trade settlers pathing lists
  guidedCandles: [],
  guidedCandleIndex: 0,

  // Live market trend structure
  marketStructure: {
    trend: 'UPTREND',
    volatility: CONFIG.FOREX_ASSETS[0].basePrice * 0.0012,
    supportPrice: CONFIG.FOREX_ASSETS[0].basePrice * 0.995,
    resistancePrice: CONFIG.FOREX_ASSETS[0].basePrice * 1.005,
    strengthRemaining: 20
  },

  // Tick generator arrays
  tickPath: [],
  tickIndex: 0
};
