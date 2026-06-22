/* FX CASINO - Candlestick Canvas Rendering Component */

import { CONFIG } from './config.js';
import { state } from './state.js';
import { calculateEMA } from './market.js';

export class ForexChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      throw new Error(`Canvas element with ID '${canvasId}' not found.`);
    }
    this.ctx = this.canvas.getContext('2d');
    this.dimensions = { width: 0, height: 0 };
    
    this.setupListeners();
  }

  setupListeners() {
    window.addEventListener('resize', () => this.handleResize());
    
    // Canvas mouse events for panning and crosshairs
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      state.isDragging = true;
      state.dragStart = { x, pan: state.panOffset };
      state.isAutoScroll = false;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (x < this.dimensions.width - CONFIG.PADDING_RIGHT_AXIS && y < this.dimensions.height - 25) {
        state.crosshair = { x, y };
      } else {
        state.crosshair = null;
      }

      if (state.isDragging) {
        const dx = x - state.dragStart.x;
        state.panOffset = state.dragStart.pan + dx;
      }
      this.render();
    });

    window.addEventListener('mouseup', () => {
      state.isDragging = false;
    });

    this.canvas.addEventListener('mouseleave', () => {
      state.crosshair = null;
      this.render();
    });
  }

  handleResize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.dimensions.width = rect.width;
    this.dimensions.height = rect.height;
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    if (this.ctx) {
      this.ctx.resetTransform?.();
      this.ctx.scale(dpr, dpr);
    }
    
    this.render();
  }

  formatPrice(price) {
    const dec = state.activeAsset.pipsDecimal === 4 ? 5 : 3;
    return price.toFixed(dec);
  }

  render() {
    const ctx = this.ctx;
    if (!ctx || this.dimensions.width === 0) return;

    // Clear background
    ctx.fillStyle = '#06080b';
    ctx.fillRect(0, 0, this.dimensions.width, this.dimensions.height);

    const visibleCandlesAll = state.activeCandle ? [...state.candlesHistory, state.activeCandle] : state.candlesHistory;
    if (visibleCandlesAll.length === 0) return;

    const totalWidth = this.dimensions.width - CONFIG.PADDING_RIGHT_AXIS;
    const chartHeight = this.dimensions.height - 25;
    const candleStride = state.zoom + CONFIG.CANDLE_GAP;

    // Compute range segments
    const activeDrawingWidth = totalWidth - CONFIG.CHART_RIGHT_PADDING;
    const visibleCount = Math.ceil(activeDrawingWidth / candleStride);
    const panInCandles = Math.floor(state.panOffset / candleStride);
    const indexEnd = Math.max(1, visibleCandlesAll.length + panInCandles);
    const indexStart = Math.max(0, indexEnd - visibleCount);

    const visibleSegment = visibleCandlesAll.slice(indexStart, indexEnd);
    if (visibleSegment.length === 0) return;

    // Draw grid indicators
    const emaline = calculateEMA(visibleCandlesAll, 12);

    let minPrice = Infinity;
    let maxPrice = -Infinity;

    for (let c of visibleSegment) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    }

    const segEma = emaline.slice(indexStart, indexEnd);
    segEma.forEach(v => {
      if (v !== undefined) {
        minPrice = Math.min(minPrice, v);
        maxPrice = Math.max(maxPrice, v);
      }
    });

    const priceRange = maxPrice - minPrice || 0.0001;
    maxPrice += priceRange * 0.12;
    minPrice -= priceRange * 0.12;

    if (state.currentMinPrice === null) {
      state.currentMinPrice = minPrice;
    } else {
      state.currentMinPrice = state.currentMinPrice + (minPrice - state.currentMinPrice) * 0.08;
    }

    if (state.currentMaxPrice === null) {
      state.currentMaxPrice = maxPrice;
    } else {
      state.currentMaxPrice = state.currentMaxPrice + (maxPrice - state.currentMaxPrice) * 0.08;
    }
    const finalPriceRange = state.currentMaxPrice - state.currentMinPrice;

    const getPixelY = (price) => {
      return chartHeight - ((price - state.currentMinPrice) / finalPriceRange) * chartHeight;
    };

    const getPriceFromY = (y) => {
      return state.currentMaxPrice - (y / chartHeight) * finalPriceRange;
    };

    const isAtEnd = (indexEnd === visibleCandlesAll.length);
    const smoothShift = isAtEnd ? (state.tickIndex / CONFIG.TICKS_PER_CANDLE) * candleStride : 0;

    // 1. Draw horizontal lines and vertical bars grids
    ctx.strokeStyle = '#14181f';
    ctx.lineWidth = 1;
    
    const gridRows = 5;
    for (let i = 0; i <= gridRows; i++) {
      const ry = (chartHeight / gridRows) * i;
      ctx.beginPath();
      ctx.moveTo(0, ry);
      ctx.lineTo(totalWidth, ry);
      ctx.stroke();

      const rowPrice = getPriceFromY(ry);
      ctx.fillStyle = '#657285';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(this.formatPrice(rowPrice), totalWidth + 8, ry + 4);
    }

    const gridCols = 5;
    const spacingCols = totalWidth / gridCols;
    for (let i = 0; i <= gridCols; i++) {
      const rx = spacingCols * i;
      ctx.beginPath();
      ctx.moveTo(rx, 0);
      ctx.lineTo(rx, chartHeight);
      ctx.stroke();
    }

    // Save Context segment to clip overflows
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, totalWidth, chartHeight);
    ctx.clip();

    // 2. Draw risk target fills if held
    if (state.activeTrade && state.activeTrade.status === 'OPEN') {
      const entryY = getPixelY(state.activeTrade.entryPrice);
      const slY = getPixelY(state.activeTrade.stopLoss);
      const tpY = getPixelY(state.activeTrade.takeProfit);

      const slTop = Math.min(entryY, slY);
      const slHeight = Math.abs(entryY - slY);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
      ctx.fillRect(0, slTop, totalWidth, slHeight);

      const tpTop = Math.min(entryY, tpY);
      const tpHeight = Math.abs(entryY - tpY);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
      ctx.fillRect(0, tpTop, totalWidth, tpHeight);
    }

    // 3. Draw EMA ribbon wave
    ctx.lineWidth = 2.0;
    ctx.strokeStyle = '#34d399';
    ctx.shadowColor = 'rgba(52, 211, 153, 0.4)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    for (let i = 0; i < visibleSegment.length; i++) {
      const idx = indexStart + i;
      const x = i * candleStride + (state.zoom / 2) - smoothShift;
      const y = getPixelY(emaline[idx]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 4. Draw Trade Boundaries
    if (state.activeTrade && state.activeTrade.status === 'OPEN') {
      const entryY = getPixelY(state.activeTrade.entryPrice);
      const slY = getPixelY(state.activeTrade.stopLoss);
      const tpY = getPixelY(state.activeTrade.takeProfit);

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, tpY); ctx.lineTo(totalWidth, tpY); ctx.stroke();
      
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
      ctx.beginPath(); ctx.moveTo(0, slY); ctx.lineTo(totalWidth, slY); ctx.stroke();

      ctx.strokeStyle = 'rgba(212, 175, 55, 0.65)';
      ctx.beginPath(); ctx.moveTo(0, entryY); ctx.lineTo(totalWidth, entryY); ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillText('TAKE PROFIT (TP)', 5, tpY - 4);
      ctx.fillStyle = '#f87171';
      ctx.fillText('STOP LOSS (SL)', 5, slY + 11);
    }

    // 5. Drawing Candlesticks
    for (let i = 0; i < visibleSegment.length; i++) {
      const c = visibleSegment[i];
      const cx = i * candleStride - smoothShift;
      const isUp = c.close >= c.open;

      const cyOpen = getPixelY(c.open);
      const cyClose = getPixelY(c.close);
      const cyHigh = getPixelY(c.high);
      const cyLow = getPixelY(c.low);

      const top = Math.min(cyOpen, cyClose);
      const bottom = Math.max(cyOpen, cyClose);
      const height = Math.max(1.2, bottom - top);

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isUp ? '#37ba56' : '#bf2e2e';
      ctx.beginPath();
      ctx.moveTo(cx + (state.zoom / 2), cyHigh);
      ctx.lineTo(cx + (state.zoom / 2), cyLow);
      ctx.stroke();

      ctx.fillStyle = isUp ? '#24b245' : '#cf2e2e';
      ctx.fillRect(cx, top, state.zoom, height);

      if (state.zoom > 5) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = isUp ? '#177a2d' : '#911d1d';
        ctx.strokeRect(cx, top, state.zoom, height);
      }
    }

    ctx.restore();

    // 6. Draw Live ticker beacons
    const activeY = getPixelY(state.activePrice);
    const lastPrice = visibleCandlesAll[visibleCandlesAll.length - 2]?.close || state.activePrice;
    const colorMetric = state.activePrice >= lastPrice ? '#10b981' : '#ef4444';

    ctx.strokeStyle = colorMetric;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(0, activeY); ctx.lineTo(totalWidth, activeY); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = colorMetric;
    ctx.fillRect(totalWidth + 1, activeY - 9, CONFIG.PADDING_RIGHT_AXIS - 2, 18);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillText(this.formatPrice(state.activePrice), totalWidth + 8, activeY + 3.5);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(totalWidth, activeY, 3, 0, Math.PI * 2);
    ctx.fill();

    // 7. Render X-Axis timestamps
    ctx.fillStyle = '#657285';
    ctx.font = '9.5px "JetBrains Mono", monospace';
    const numLabels = 5;
    const stepLabel = Math.floor(visibleSegment.length / numLabels) || 1;
    for (let i = 0; i < visibleSegment.length; i += stepLabel) {
      const c = visibleSegment[i];
      if (!c) continue;
      const cx = i * candleStride - smoothShift;
      const labelTime = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      ctx.fillText(labelTime.substring(0, 5), cx, chartHeight + 16);
    }

    // 8. Crosshair tracers
    if (state.crosshair) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(state.crosshair.x, 0); ctx.lineTo(state.crosshair.x, chartHeight); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, state.crosshair.y); ctx.lineTo(this.dimensions.width, state.crosshair.y); ctx.stroke();
      ctx.setLineDash([]);

      const hoverPrice = getPriceFromY(state.crosshair.y);
      ctx.fillStyle = '#2d3748';
      ctx.fillRect(totalWidth + 2, state.crosshair.y - 8, CONFIG.PADDING_RIGHT_AXIS - 4, 16);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText(this.formatPrice(hoverPrice), totalWidth + 8, state.crosshair.y + 4);
    }
  }
}
