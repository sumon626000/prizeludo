/* FX CASINO - Market Simulation & Candle Generation Algorithms */

import { CONFIG } from './config.js';

/**
 * Generate starter candle records mimicking stable real market history.
 */
export function generateInitialHistory(asset, count = 75) {
  let history = [];
  let price = asset.basePrice;
  let volatility = asset.basePrice * 0.0012;
  let trend = 'UPTREND';
  let remaining = 15;

  let sup = price - volatility * 4;
  let res = price + volatility * 4;

  for (let i = 0; i < count; i++) {
    remaining--;
    if (remaining <= 0) {
      trend = trend === 'UPTREND' ? 'RANGING' : trend === 'RANGING' ? 'DOWNTREND' : 'UPTREND';
      remaining = 10 + Math.floor(Math.random() * 15);
    }

    const tempStruct = { trend, volatility };
    const cand = generateUnguidedNextCandle({ close: price }, tempStruct);

    history.push({
      id: 'init-' + i,
      timestamp: Date.now() - (count - i) * 60000,
      open: cand.open,
      high: Math.max(cand.open, cand.close, cand.high),
      low: Math.min(cand.open, cand.close, cand.low),
      close: cand.close,
      isCompleted: true
    });

    price = cand.close;
  }

  return { 
    history, 
    structure: { 
      trend, 
      volatility, 
      supportPrice: sup, 
      resistancePrice: res, 
      strengthRemaining: remaining 
    } 
  };
}

/**
 * Interpolate ticks inside candle's Extreme boundaries.
 */
export function generateTickPath(open, close, high, low) {
  const ticks = new Array(CONFIG.TICKS_PER_CANDLE);
  const isBull = close >= open;
  const w1 = Math.floor(CONFIG.TICKS_PER_CANDLE * 0.28);
  const w2 = Math.floor(CONFIG.TICKS_PER_CANDLE * 0.72);
  const ext1 = isBull ? low : high;
  const ext2 = isBull ? high : low;

  for (let i = 0; i < CONFIG.TICKS_PER_CANDLE; i++) {
    let base = open;
    if (i < w1) {
      base = open + (ext1 - open) * Math.sin((i / w1) * Math.PI / 2);
    } else if (i < w2) {
      const p = (i - w1) / (w2 - w1);
      base = ext1 + (ext2 - ext1) * p;
    } else {
      const p = (i - w2) / (CONFIG.TICKS_PER_CANDLE - w2);
      base = ext2 + (close - ext2) * Math.sin(p * Math.PI / 2);
    }
    const noise = Math.abs(high - low) * 0.015 * Math.sin((i / CONFIG.TICKS_PER_CANDLE) * Math.PI);
    ticks[i] = Math.max(low, Math.min(high, base + (Math.random() - 0.5) * noise));
  }

  ticks[0] = open;
  ticks[CONFIG.TICKS_PER_CANDLE - 1] = close;
  return ticks;
}

/**
 * Perform Exponential Moving Average (EMA) mathematical wave.
 */
export function calculateEMA(arr, period) {
  const k = 2 / (period + 1);
  let emaVal = arr[0].close;
  const res = [];
  for (let i = 0; i < arr.length; i++) {
    emaVal = arr[i].close * k + emaVal * (1 - k);
    res.push(emaVal);
  }
  return res;
}

/**
 * Generate standard organic noise candle when there's no active order.
 */
export function generateUnguidedNextCandle(lastCandle, struct) {
  const open = lastCandle.close;
  const vol = struct.volatility;
  
  // Define candle direction based on trend
  let isUp = Math.random() > 0.5;
  if (struct.trend === 'UPTREND') {
    isUp = Math.random() > 0.35; // bullish bias
  } else if (struct.trend === 'DOWNTREND') {
    isUp = Math.random() < 0.35; // bearish bias
  }

  const typeRoll = Math.random();
  let close, high, low;
  
  if (typeRoll < 0.40) {
    // 1. Standard Candle
    const bodySize = (0.35 + Math.random() * 0.45) * vol;
    close = isUp ? open + bodySize : open - bodySize;
    
    const upperWick = (0.15 + Math.random() * 0.25) * vol;
    const lowerWick = (0.15 + Math.random() * 0.25) * vol;
    high = Math.max(open, close) + upperWick;
    low = Math.min(open, close) - lowerWick;
    
  } else if (typeRoll < 0.62) {
    // 2. Momentum / Marubozu (Large body, very tiny wicks)
    const bodySize = (0.8 + Math.random() * 0.7) * vol;
    close = isUp ? open + bodySize : open - bodySize;
    
    const upperWick = Math.random() * 0.08 * vol;
    const lowerWick = Math.random() * 0.08 * vol;
    high = Math.max(open, close) + upperWick;
    low = Math.min(open, close) - lowerWick;
    
  } else if (typeRoll < 0.80) {
    // 3. Hammer / Shooting Star
    const bodySize = (0.08 + Math.random() * 0.15) * vol;
    close = isUp ? open + bodySize : open - bodySize;
    
    if (isUp) {
      const lowerWick = (1.0 + Math.random() * 0.7) * vol;
      const upperWick = Math.random() * 0.12 * vol;
      high = Math.max(open, close) + upperWick;
      low = Math.min(open, close) - lowerWick;
    } else {
      const upperWick = (1.0 + Math.random() * 0.7) * vol;
      const lowerWick = Math.random() * 0.12 * vol;
      high = Math.max(open, close) + upperWick;
      low = Math.min(open, close) - lowerWick;
    }
    
  } else if (typeRoll < 0.90) {
    // 4. Doji (No body, average wicks)
    const bodySize = Math.random() * 0.06 * vol;
    close = isUp ? open + bodySize : open - bodySize;
    
    const upperWick = (0.2 + Math.random() * 0.3) * vol;
    const lowerWick = (0.2 + Math.random() * 0.3) * vol;
    high = Math.max(open, close) + upperWick;
    low = Math.min(open, close) - lowerWick;
    
  } else {
    // 5. Spinning Top
    const bodySize = (0.12 + Math.random() * 0.12) * vol;
    close = isUp ? open + bodySize : open - bodySize;
    
    const upperWick = (0.55 + Math.random() * 0.55) * vol;
    const lowerWick = (0.55 + Math.random() * 0.55) * vol;
    high = Math.max(open, close) + upperWick;
    low = Math.min(open, close) - lowerWick;
  }

  return { open, close, high, low };
}

/**
 * Generate guided settlement pathing when player holds an active order.
 */
export function generateGuidedPath(trade, steps = CONFIG.TRADE_DURATION_CANDLES, struct = null) {
  const path = [];
  const { type, entryPrice, stopLoss, takeProfit, outcome } = trade;
  const targetPrice = outcome === 'WIN' ? takeProfit : stopLoss;
  const isBuy = type === 'BUY';
  
  let prices = [entryPrice];
  const gapVal = Math.abs(entryPrice - targetPrice);
  const midPoint = Math.max(2, Math.floor(steps * 0.4));

  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    let p = entryPrice;

    if (outcome === 'WIN') {
      if (isBuy) {
        const sOffset = i < midPoint ? -gapVal * 0.22 * Math.sin((i / midPoint) * Math.PI / 2) : 0;
        p = entryPrice + sOffset + (takeProfit - entryPrice) * Math.pow(progress, 1.25);
      } else {
        const sOffset = i < midPoint ? gapVal * 0.22 * Math.sin((i / midPoint) * Math.PI / 2) : 0;
        p = entryPrice + sOffset + (takeProfit - entryPrice) * Math.pow(progress, 1.25);
      }
    } else {
      if (isBuy) {
        const sOffset = i < midPoint + 1 ? gapVal * 0.28 * Math.sin((i / (midPoint + 1)) * Math.PI / 2) : 0;
        p = entryPrice + sOffset + (stopLoss - entryPrice) * Math.pow(progress, 1.25);
      } else {
        const sOffset = i < midPoint + 1 ? -gapVal * 0.28 * Math.sin((i / (midPoint + 1)) * Math.PI / 2) : 0;
        p = entryPrice + sOffset + (stopLoss - entryPrice) * Math.pow(progress, 1.25);
      }
    }

    if (i < steps) {
      p += (Math.random() - 0.5) * (gapVal * 0.15); // Add dynamic organic noise
    }
    prices.push(p);
  }

  prices[prices.length - 1] = targetPrice;

  const vol = struct?.volatility || (entryPrice * 0.0012);

  for (let i = 0; i < steps; i++) {
    const o = prices[i];
    const c = prices[i + 1];
    const isCandleUp = c >= o;
    const bodySize = Math.abs(c - o);

    let h, l;
    const roll = Math.random();

    if (bodySize > vol * 0.6) {
      // 1. Momentum Style (solid bodies)
      const upperWick = Math.random() * 0.08 * vol;
      const lowerWick = Math.random() * 0.08 * vol;
      h = Math.max(o, c) + upperWick;
      l = Math.min(o, c) - lowerWick;
    } else if (roll < 0.25) {
      // 2. Pins / Hammer
      if (isCandleUp) {
        const lowerWick = (0.7 + Math.random() * 0.6) * vol;
        const upperWick = Math.random() * 0.15 * vol;
        h = Math.max(o, c) + upperWick;
        l = Math.min(o, c) - lowerWick;
      } else {
        const upperWick = (0.7 + Math.random() * 0.6) * vol;
        const lowerWick = Math.random() * 0.15 * vol;
        h = Math.max(o, c) + upperWick;
        l = Math.min(o, c) - lowerWick;
      }
    } else if (roll < 0.50) {
      // 3. Spinning tops
      const upperWick = (0.45 + Math.random() * 0.45) * vol;
      const lowerWick = (0.45 + Math.random() * 0.45) * vol;
      h = Math.max(o, c) + upperWick;
      l = Math.min(o, c) - lowerWick;
    } else if (roll < 0.70) {
      // 4. Small Dojis
      const upperWick = (0.25 + Math.random() * 0.25) * vol;
      const lowerWick = (0.25 + Math.random() * 0.25) * vol;
      h = Math.max(o, c) + upperWick;
      l = Math.min(o, c) - lowerWick;
    } else {
      // 5. Standard Candlestick
      const upperWick = (0.15 + Math.random() * 0.25) * vol;
      const lowerWick = (0.15 + Math.random() * 0.25) * vol;
      h = Math.max(o, c) + upperWick;
      l = Math.min(o, c) - lowerWick;
    }

    // Double safety bounds clamping
    h = Math.max(h, o, c);
    l = Math.min(l, o, c);

    path.push({ open: o, close: c, high: h, low: l });
  }

  return path;
}
