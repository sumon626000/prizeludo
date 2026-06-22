/* FX CASINO - Master Application Hub & Bootstrap Engine */

import { CONFIG } from './config.js';
import { state } from './state.js';
import { synth } from './synth.js';
import {
  generateInitialHistory,
  generateTickPath,
  generateUnguidedNextCandle,
  generateGuidedPath
} from './market.js';
import { ForexChart } from './chart.js';
import {
  updateBalancesUI,
  updateStakeUI,
  setupTradingRulesModal,
  setupTutorialSystem,
  setupUIInteractions,
  showCustomAlert
} from './ui.js';

let chart = null;

/**
 * Format helper for numbers.
 */
function formatPrice(price) {
  const dec = state.activeAsset.pipsDecimal === 4 ? 5 : 3;
  return price.toFixed(dec);
}

function getPriceDeltaFromPips(pips) {
  return pips / Math.pow(10, state.activeAsset.pipsDecimal);
}

/**
 * Sync prices with HTML tags.
 */
function updateBuySellLabels() {
  const buyPrice = state.activePrice + getPriceDeltaFromPips(state.activeAsset.spread / 2);
  const sellPrice = state.activePrice - getPriceDeltaFromPips(state.activeAsset.spread / 2);

  const buyTag = document.getElementById('active-buy-tag');
  const sellTag = document.getElementById('active-sell-tag');
  const priceHeader = document.getElementById('live-price-header');
  const pctTag = document.getElementById('pct-change-header');

  if (buyTag) buyTag.innerText = formatPrice(buyPrice);
  if (sellTag) sellTag.innerText = formatPrice(sellPrice);
  if (priceHeader) priceHeader.innerText = formatPrice(state.activePrice);

  // Daily percentage calculation
  const initialOpen = state.candlesHistory[0]?.open || state.activeAsset.basePrice;
  const pct = ((state.activePrice - initialOpen) / initialOpen) * 100;
  
  if (pctTag) {
    pctTag.innerText = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    if (pct >= 0) {
      pctTag.className = 'pct-change-header-val text-up';
      if (priceHeader) priceHeader.className = 'live-price-header-val text-up';
    } else {
      pctTag.className = 'pct-change-header-val text-down';
      if (priceHeader) priceHeader.className = 'live-price-header-val text-down';
    }
  }
}

/**
 * Toggle active trade action button disability
 */
function updateActionButtonsState() {
  const buyBtn = document.getElementById('btn-action-buy');
  const sellBtn = document.getElementById('btn-action-sell');
  if (!buyBtn || !sellBtn) return;

  if (state.activeTrade && state.activeTrade.status === 'OPEN') {
    buyBtn.disabled = true;
    sellBtn.disabled = true;
  } else {
    buyBtn.disabled = false;
    sellBtn.disabled = false;
  }
}

/**
 * Initialize / resetting starting Forex assets history.
 */
function initAssetMarket() {
  const { history, structure } = generateInitialHistory(state.activeAsset, 75);
  state.candlesHistory = history;
  state.marketStructure = structure;
  state.currentMinPrice = null;
  state.currentMaxPrice = null;

  const lastCandle = history[history.length - 1];
  const nextC = generateUnguidedNextCandle(lastCandle, structure);
  state.tickPath = generateTickPath(nextC.open, nextC.close, nextC.high, nextC.low);
  state.tickIndex = 0;
  state.activePrice = state.tickPath[0];

  state.activeCandle = {
    id: 'live-start',
    timestamp: Date.now(),
    open: nextC.open,
    high: state.activePrice,
    low: state.activePrice,
    close: state.activePrice,
    isCompleted: false
  };

  state.activeTrade = null;
  const positionWidget = document.getElementById('active-position-widget');
  if (positionWidget) positionWidget.style.display = 'none';

  updateActionButtonsState();
  updateBuySellLabels();
  
  if (chart) {
    chart.render();
  }
}

/**
 * Execute buy/sell transaction desk triggers
 */
function handleOpenPosition(type) {
  if (state.activeTrade) return;

  synth.playOrder();

  const entryPrice = state.activePrice;
  const isBuy = type === 'BUY';
  
  // Set pip targets for resolution
  const targetPips = 45;
  const pipsDeltaPrice = getPriceDeltaFromPips(targetPips);

  const takeProfit = isBuy ? entryPrice + pipsDeltaPrice : entryPrice - pipsDeltaPrice;
  const stopLoss = isBuy ? entryPrice - pipsDeltaPrice : entryPrice + pipsDeltaPrice;

  // Aligning with trend shifts raises odds to 70%!
  let winningProb = CONFIG.WIN_BIAS_NORMAL;
  if (state.marketStructure.trend === 'UPTREND' && isBuy) winningProb = CONFIG.WIN_BIAS_TREND;
  if (state.marketStructure.trend === 'DOWNTREND' && !isBuy) winningProb = CONFIG.WIN_BIAS_TREND;
  if (state.marketStructure.trend === 'UPTREND' && !isBuy) winningProb = CONFIG.WIN_BIAS_COUNTER_TREND;
  if (state.marketStructure.trend === 'DOWNTREND' && isBuy) winningProb = CONFIG.WIN_BIAS_COUNTER_TREND;

  const outcome = Math.random() < winningProb ? 'WIN' : 'LOSS';

  state.activeTrade = {
    type,
    entryPrice,
    stopLoss,
    takeProfit,
    status: 'OPEN',
    outcome,
    profit: 0.0
  };

  state.guidedCandles = generateGuidedPath(state.activeTrade, CONFIG.TRADE_DURATION_CANDLES, state.marketStructure);
  state.guidedCandleIndex = 0;

  // DOM visual update
  const profitWidgetVal = document.getElementById('widget-profit');
  if (profitWidgetVal) {
    profitWidgetVal.innerText = '$0.00';
    profitWidgetVal.className = 'pnl-val-compact text-up';
  }
  const widgetFrame = document.getElementById('active-position-widget');
  if (widgetFrame) widgetFrame.style.display = 'flex';

  updateActionButtonsState();

  if (chart) {
    chart.render();
  }
}

/**
 * Main High Frequency Pulsing loop (Runs at 50ms intervals)
 */
function startSimulatorHeartbeat() {
  setInterval(() => {
    if (state.tickPath.length === 0) return;

    const price = state.tickPath[state.tickIndex];
    state.activePrice = price;

    if (state.activeCandle) {
      state.activeCandle.close = price;
      if (price > state.activeCandle.high) state.activeCandle.high = price;
      if (price < state.activeCandle.low) state.activeCandle.low = price;
    }

    // Update active PnL status if trade is held
    if (state.activeTrade && state.activeTrade.status === 'OPEN') {
      const entry = state.activeTrade.entryPrice;
      let pips = 0;
      if (state.activeTrade.type === 'BUY') {
        pips = (price - entry) * Math.pow(10, state.activeAsset.pipsDecimal);
      } else {
        pips = (entry - price) * Math.pow(10, state.activeAsset.pipsDecimal);
      }
      
      const currentProfitRatio = pips / 45.0;
      state.activeTrade.profit = Math.max(-state.stakeAmount, Math.min(state.stakeAmount, currentProfitRatio * state.stakeAmount));

      const profitWidgetVal = document.getElementById('widget-profit');
      if (profitWidgetVal) {
        profitWidgetVal.innerText = (state.activeTrade.profit >= 0 ? '+' : '') + '$' + state.activeTrade.profit.toFixed(2);
        profitWidgetVal.className = `pnl-val-compact ${state.activeTrade.profit >= 0 ? 'text-up' : 'text-down'}`;
      }
    }

    updateBuySellLabels();
    if (chart) {
      chart.render();
    }
    state.tickIndex++;

    // Switch candle structures
    if (state.tickIndex >= CONFIG.TICKS_PER_CANDLE) {
      const completedCandle = Object.assign({}, state.activeCandle, { isCompleted: true });
      state.candlesHistory.push(completedCandle);

      state.marketStructure.strengthRemaining--;
      if (state.marketStructure.strengthRemaining <= 0) {
        state.marketStructure.trend = Math.random() > 0.45 ? 'UPTREND' : 'DOWNTREND';
        state.marketStructure.strengthRemaining = 12 + Math.floor(Math.random() * 15);
      }

      // Check order settlement bounds
      if (state.activeTrade && state.activeTrade.status === 'OPEN') {
        if (state.guidedCandleIndex >= state.guidedCandles.length) {
          const isWin = state.activeTrade.outcome === 'WIN';
          state.activeTrade.status = isWin ? 'WON' : 'LOST';

          const finalPayoutProfit = isWin ? state.stakeAmount * 1.0 : -state.stakeAmount;
          
          state.account.balance += finalPayoutProfit;
          updateBalancesUI();

          if (isWin) {
            synth.playWin();
          } else {
            synth.playLoss();
          }

          const resolvedTrade = Object.assign({}, state.activeTrade, {
            payout: finalPayoutProfit,
            time: new Date().toLocaleTimeString()
          });
          state.tradeHistory.push(resolvedTrade);

          state.activeTrade = null;
          const widgetFrame = document.getElementById('active-position-widget');
          if (widgetFrame) widgetFrame.style.display = 'none';
          
          updateActionButtonsState();
        }
      }

      // Build parameters for next candle interval
      let nextO = completedCandle.close;
      let nextC = nextO;
      let nextH = nextO;
      let nextL = nextO;

      if (state.activeTrade && state.guidedCandles.length > 0) {
        const guided = state.guidedCandles[state.guidedCandleIndex];
        nextO = guided.open;
        nextC = guided.close;
        nextH = guided.high;
        nextL = guided.low;
        state.guidedCandleIndex++;
      } else {
        const normal = generateUnguidedNextCandle(completedCandle, state.marketStructure);
        nextO = normal.open;
        nextC = normal.close;
        nextH = normal.high;
        nextL = normal.low;
      }

      state.tickPath = generateTickPath(nextO, nextC, nextH, nextL);
      state.tickIndex = 0;

      state.activeCandle = {
        id: 'live-' + Date.now(),
        timestamp: Date.now(),
        open: nextO,
        high: state.tickPath[0],
        low: state.tickPath[0],
        close: state.tickPath[0],
        isCompleted: false
      };
    }
  }, CONFIG.TICK_INTERVAL_MS);
}

/**
 * Claymorphic Preloader Splash Entry Scene logic
 */
function runClaySplashScreen() {
  const percentEl = document.getElementById('clay-splash-percent');
  const fillEl = document.getElementById('clay-splash-fill');
  const loaderGroup = document.getElementById('clay-splash-loader-group');
  const enterBtn = document.getElementById('btn-clay-splash-enter');
  const splashOverlay = document.getElementById('clay-splash-screen');
  
  if (!percentEl || !fillEl) return;

  let progress = 0;
  const duration = 1800;
  const intervalTime = 30;
  const step = 100 / (duration / intervalTime);
  
  const loaderInterval = setInterval(() => {
    progress += step + (Math.random() * 2);
    if (progress >= 100) {
      progress = 100;
      clearInterval(loaderInterval);
      
      if (loaderGroup) {
        loaderGroup.style.transition = 'all 0.5s ease';
        loaderGroup.style.opacity = '0';
      }
      setTimeout(() => {
        if (loaderGroup) loaderGroup.style.display = 'none';
        if (enterBtn) {
          enterBtn.style.display = 'flex';
          enterBtn.classList.add('transition-opacity', 'duration-500', 'opacity-100');
        }
      }, 500);
    }
    
    percentEl.innerText = Math.floor(progress) + '%';
    fillEl.style.width = progress + '%';
  }, intervalTime);
  
  if (enterBtn) {
    enterBtn.addEventListener('click', () => {
      synth.init();
      synth.playTap();
      
      if (splashOverlay) {
        splashOverlay.classList.add('opacity-0', 'pointer-events-none', 'scale-105');
      }
      
      setTimeout(() => {
        if (splashOverlay) splashOverlay.remove();
        // Fire tutorial onboarding masterclass immediately
        const guideOverlay = document.getElementById('game-tutorial-overlay');
        if (guideOverlay) guideOverlay.classList.add('active');
      }, 800);
    });
  }
}

/**
 * Main modular bootstrap sequence
 */
function bootstrap() {
  // Initialize canvas drawings
  chart = new ForexChart('forex-candlestick-canvas');
  chart.handleResize();

  // Draw HUD statistics initially
  updateStakeUI();
  updateBalancesUI();

  // Setup modals and alerts handlers
  setupTradingRulesModal();
  setupTutorialSystem();
  setupUIInteractions(chart);

  // Hook up Buy/Sell primary desk click listeners
  const buyActionBtn = document.getElementById('btn-action-buy');
  const sellActionBtn = document.getElementById('btn-action-sell');

  if (buyActionBtn) {
    buyActionBtn.addEventListener('click', () => handleOpenPosition('BUY'));
  }
  if (sellActionBtn) {
    sellActionBtn.addEventListener('click', () => handleOpenPosition('SELL'));
  }

  // Pre-load market tickers historical data
  initAssetMarket();

  // Build Lucide vectors on DOM
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Execute Splash transitions
  runClaySplashScreen();
  
  // Start pricing walking pulse intervals
  startSimulatorHeartbeat();
}

window.addEventListener('DOMContentLoaded', bootstrap);
setTimeout(() => {
  if (chart) chart.handleResize();
}, 150);
export { chart };
