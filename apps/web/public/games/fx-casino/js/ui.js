/* FX CASINO - HUD & UI Modular Components Manager */

import { CONFIG } from './config.js';
import { state } from './state.js';
import { synth } from './synth.js';

/**
 * Custom Promise-driven Alert Dialog utility.
 */
export function showCustomAlert(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-alert-modal');
    const titleEl = document.getElementById('custom-alert-title');
    const msgEl = document.getElementById('custom-alert-message');
    const okBtn = document.getElementById('custom-alert-btn-ok');

    if (!modal) return resolve();

    titleEl.innerText = title;
    msgEl.innerText = message;
    modal.classList.add('active');

    const handleOk = () => {
      synth.playTap();
      modal.classList.remove('active');
      okBtn.removeEventListener('click', handleOk);
      resolve();
    };
    okBtn.addEventListener('click', handleOk);
  });
}

/**
 * Custom Promise-driven Prompt utility.
 */
export function showCustomPrompt(title, message, defaultValue = "") {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-prompt-modal');
    const titleEl = document.getElementById('custom-prompt-title');
    const msgEl = document.getElementById('custom-prompt-msg');
    const field = document.getElementById('custom-prompt-field');
    const confirmBtn = document.getElementById('custom-prompt-btn-confirm');
    const cancelBtn = document.getElementById('custom-prompt-btn-cancel');
    const errorEl = document.getElementById('custom-prompt-error');

    if (!modal) return resolve(null);

    titleEl.innerText = title;
    msgEl.innerText = message;
    field.value = defaultValue;
    errorEl.classList.remove('active');
    modal.classList.add('active');

    field.focus();
    field.select();

    const handleConfirm = () => {
      const val = field.value.trim();
      const parsed = parseFloat(val);
      if (isNaN(parsed) || parsed < CONFIG.MIN_STAKE || parsed > CONFIG.MAX_STAKE) {
        synth.playLoss();
        errorEl.classList.add('active');
        return;
      }
      synth.playTap();
      modal.classList.remove('active');
      cleanup();
      resolve(val);
    };

    const handleCancel = () => {
      synth.playTap();
      modal.classList.remove('active');
      cleanup();
      resolve(null);
    };

    const cleanup = () => {
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
  });
}

/**
 * Balance Update displays in mobile/desktop headers.
 */
export function updateBalancesUI() {
  const formatted = '$' + state.account.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.querySelectorAll('.stat-balance-val').forEach(el => {
    el.innerText = formatted;
  });
  const legacyEl = document.getElementById('stat-balance');
  if (legacyEl) legacyEl.innerText = formatted;
}

/**
 * Wager/Stake selection slider updates.
 */
export function updateStakeUI() {
  document.getElementById('amount-text-stake').innerText = '$' + state.stakeAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const payout = state.stakeAmount * 1.0;
  const infoPayout = document.getElementById('info-payout');
  if (infoPayout) {
    infoPayout.innerText = '+$' + payout.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

/**
 * General rules modal hook ups.
 */
export function setupTradingRulesModal() {
  const modal = document.getElementById('clay-rules-modal');
  const openBtn = document.getElementById('btn-open-rules');
  const closeBtn = document.getElementById('btn-close-rules');
  const gotitBtn = document.getElementById('btn-close-rules-gotit');

  if (!modal || !openBtn) return;

  const showRules = () => {
    synth.init();
    synth.playTap();
    modal.classList.add('active');
  };

  const hideRules = () => {
    synth.init();
    synth.playTap();
    modal.classList.remove('active');
  };

  openBtn.addEventListener('click', showRules);
  if (closeBtn) closeBtn.addEventListener('click', hideRules);
  if (gotitBtn) gotitBtn.addEventListener('click', hideRules);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideRules();
    }
  });
}

/**
 * Onboarding step-by-step masterclass guidelines overlay setup.
 */
export function setupTutorialSystem() {
  const overlay = document.getElementById('game-tutorial-overlay');
  const btnNext = document.getElementById('btn-tuto-next');
  const btnSkip = document.getElementById('btn-tuto-skip');
  const indicator = document.getElementById('tutorial-indicator');
  
  if (!overlay) return;

  const navDots = document.querySelectorAll('#tuto-dots-nav .tuto-dot');
  const stepPanels = [
    document.getElementById('tuto-step-1'),
    document.getElementById('tuto-step-2'),
    document.getElementById('tuto-step-3'),
    document.getElementById('tuto-step-4')
  ];

  let currentTutoStep = 1;

  function showStep(stepNum) {
    currentTutoStep = stepNum;
    indicator.innerText = `STEP ${stepNum} of 4`;
    
    stepPanels.forEach((panel, i) => {
      if (panel) {
        if (i + 1 === stepNum) {
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
        }
      }
    });

    navDots.forEach((dot, i) => {
      if (dot) {
        if (i + 1 === stepNum) {
          dot.classList.add('active');
        } else {
          dot.classList.remove('active');
        }
      }
    });

    if (stepNum === 4) {
      btnNext.innerText = "START SIMULATOR";
    } else {
      btnNext.innerText = "NEXT";
    }
  }

  btnNext.addEventListener('click', () => {
    synth.playTap();
    if (currentTutoStep < 4) {
      showStep(currentTutoStep + 1);
    } else {
      overlay.classList.remove('active');
    }
  });

  btnSkip.addEventListener('click', () => {
    synth.playTap();
    overlay.classList.remove('active');
  });

  const openTutoBtn = document.getElementById('btn-open-tutorial');
  if (openTutoBtn) {
    openTutoBtn.addEventListener('click', () => {
      overlay.classList.add('active');
      showStep(1);
    });
  }

  // Interactive step 3 practice widgets
  const btnMockBuy = document.getElementById('btn-tuto-mock-buy');
  const btnMockSell = document.getElementById('btn-tuto-mock-sell');
  const tutoFeedback = document.getElementById('tuto-interactive-feedback');
  const tutoBoard = document.getElementById('tuto-simulation-candles');
  const tutoDotsRow = document.querySelectorAll('#tuto-candles-row .tuto-dot');

  let tutoActive = false;
  let tutoStepIndex = 0;
  let tutoInterval = null;

  async function startTutoSimulation(type) {
    if (tutoActive) return;
    tutoActive = true;
    synth.playOrder();

    if (btnMockBuy) btnMockBuy.disabled = true;
    if (btnMockSell) btnMockSell.disabled = true;

    if (tutoFeedback) tutoFeedback.innerText = `Placing mock order...`;
    if (tutoBoard) tutoBoard.style.display = 'block';

    tutoDotsRow.forEach(dot => {
      dot.className = 'tuto-dot';
    });

    tutoStepIndex = 0;
    tutoInterval = setInterval(() => {
      if (tutoStepIndex < 7) {
        synth.playTap();
        tutoDotsRow[tutoStepIndex].classList.add(Math.random() > 0.35 ? 'won' : 'lost');
        if (tutoFeedback) tutoFeedback.innerText = `Simulating Candle ${tutoStepIndex + 1} of 7...`;
        tutoStepIndex++;
      } else {
        clearInterval(tutoInterval);
        const isWin = Math.random() > 0.3; // Favor win
        tutoActive = false;
        if (btnMockBuy) btnMockBuy.disabled = false;
        if (btnMockSell) btnMockSell.disabled = false;

        if (isWin) {
          synth.playWin();
          if (tutoFeedback) tutoFeedback.innerHTML = `<span class="styled-97">SIMULATED TAKEUOUT! +$100</span>. Great trend-aligned trade!`;
        } else {
          synth.playLoss();
          if (tutoFeedback) tutoFeedback.innerHTML = `<span class="styled-98">SIMULATED STOP-LOSS HIT.</span> Trend pulled reverse structures.`;
        }
      }
    }, 350);
  }

  if (btnMockBuy) btnMockBuy.addEventListener('click', () => startTutoSimulation('BUY'));
  if (btnMockSell) btnMockSell.addEventListener('click', () => startTutoSimulation('SELL'));
}

/**
 * Set up click hooks for sound icon, stake MIN/MAX and presets double-clicks etc.
 */
export function setupUIInteractions(chartInstance) {
  // Sound controls speaker icons
  const btnSound = document.getElementById('btn-toggle-sound');
  const soundIcon = document.getElementById('sound-icon-meta');
  
  if (btnSound && soundIcon) {
    btnSound.addEventListener('click', (e) => {
      e.stopPropagation();
      state.soundEnabled = !state.soundEnabled;
      synth.playTap();
      
      if (state.soundEnabled) {
        soundIcon.setAttribute('data-lucide', 'volume-2');
        soundIcon.className = 'h-4 w-4 text-emerald-400 animate-pulse';
      } else {
        soundIcon.setAttribute('data-lucide', 'volume-x');
        soundIcon.className = 'h-4 w-4 text-slate-500';
      }
      if (window.lucide) window.lucide.createIcons();
    });
  }

  // Wager Preset selectors
  const minBtn = document.getElementById('btn-amount-min');
  const maxBtn = document.getElementById('btn-amount-max');
  const steelBtn = document.getElementById('btn-steel-interactive');

  if (minBtn) {
    minBtn.addEventListener('click', () => {
      synth.playTap();
      state.stakeAmount = CONFIG.MIN_STAKE;
      updateStakeUI();
    });
  }

  if (maxBtn) {
    maxBtn.addEventListener('click', () => {
      synth.playTap();
      state.stakeAmount = Math.max(CONFIG.MIN_STAKE, Math.min(state.account.balance, CONFIG.MAX_STAKE));
      updateStakeUI();
    });
  }

  if (steelBtn) {
    steelBtn.addEventListener('click', () => {
      synth.playTap();
      const presets = CONFIG.STAKE_PRESETS;
      let currIdx = presets.findIndex(v => v >= state.stakeAmount);
      let nextIdx = (currIdx + 1) % presets.length;
      
      state.stakeAmount = presets[nextIdx];
      if (state.stakeAmount > state.account.balance) {
        state.stakeAmount = CONFIG.MIN_STAKE; // clamp back
      }
      updateStakeUI();
    });

    // Custom text input prompt on double click
    steelBtn.addEventListener('dblclick', async () => {
      synth.init();
      const userInput = await showCustomPrompt("CUSTOM STAKE", `Enter wager amount ($${CONFIG.MIN_STAKE} to $${CONFIG.MAX_STAKE}):`, state.stakeAmount.toFixed(2));
      if (userInput !== null) {
        const parsed = parseFloat(userInput);
        if (!isNaN(parsed) && parsed >= CONFIG.MIN_STAKE && parsed <= CONFIG.MAX_STAKE) {
          state.stakeAmount = parsed;
          updateStakeUI();
        } else {
          await showCustomAlert("INVALID ENTRY", `Wager must range between $${CONFIG.MIN_STAKE} and $${CONFIG.MAX_STAKE}.`);
        }
      }
    });
  }

  // Wallet reset balances buttons
  document.querySelectorAll('.btn-balance-reset-trigger').forEach(btn => {
    btn.addEventListener('click', async () => {
      synth.playTap();
      state.account.balance = CONFIG.BASE_BALANCE;
      state.tradeHistory = [];
      updateBalancesUI();
      await showCustomAlert("BALANCE TOPPED UP", `Your simulated account balance has been reset to $${CONFIG.BASE_BALANCE.toFixed(2)}.`);
    });
  });

  // Easter eggs parameters inspection logs
  let clickCount = 0;
  document.querySelectorAll('.btn-logo-easter-trigger').forEach(logoBtn => {
    logoBtn.addEventListener('click', async () => {
      clickCount++;
      synth.playTap();
      if (clickCount >= 3) {
        await showCustomAlert("ENGINE METRICS", `💎 FX CASINO PREMIUM ENGINE v1.5\n- Trend Force: ${state.marketStructure.trend}\n- Volatility: ${state.marketStructure.volatility.toFixed(6)}\n- Total Play Stake: $${state.stakeAmount.toFixed(2)}`);
        clickCount = 0;
      }
    });
  });
}
