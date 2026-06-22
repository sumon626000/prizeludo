const params = new URLSearchParams(window.location.search);
const embedded = params.get("embedded") === "prizejito";
const autostart = params.get("autostart") === "1";

let balancePushHandler = null;
let settingsPushHandler = null;
let autoSyncTimer = null;

function pendingRequest(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!embedded || window.parent === window) {
      reject(new Error("Platform bridge unavailable"));
      return;
    }
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Platform request timed out"));
    }, 15_000);
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (data.ok) resolve(data);
      else reject(new Error(data.message || "Platform request failed"));
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage(
      {
        source: "trade-jito",
        type,
        requestId,
        payload,
      },
      window.location.origin,
    );
  });
}

function handleHostMessage(event) {
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.source !== "trade-jito-host") return;

  if (data.type === "balance") {
    const balance = Number(data.balance);
    if (!Number.isFinite(balance) || !balancePushHandler) return;
    balancePushHandler(balance);
    return;
  }

  if (data.type === "settings" && data.settings && settingsPushHandler) {
    settingsPushHandler(data.settings);
  }
}

window.addEventListener("message", handleHostMessage);

export const PrizeJitoBridge = {
  isActive() {
    return embedded && window.parent !== window;
  },
  shouldAutostart() {
    return autostart;
  },
  currencySymbol() {
    return this.isActive() ? "৳" : "$";
  },
  onBalancePush(handler) {
    balancePushHandler = handler;
  },
  onSettingsPush(handler) {
    settingsPushHandler = handler;
  },
  async syncSettings(retries = 8, delayMs = 500) {
    if (!this.isActive()) return null;
    let lastError = null;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const result = await pendingRequest("trade-jito:settings");
        return result.settings ?? null;
      } catch (error) {
        lastError = error;
        if (attempt < retries - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Could not sync trade settings");
  },
  startAutoSync(syncFn, intervalMs = 20_000) {
    if (autoSyncTimer !== null) {
      window.clearInterval(autoSyncTimer);
    }
    if (!this.isActive()) return;
    autoSyncTimer = window.setInterval(() => {
      void syncFn();
    }, intervalMs);
  },
  stopAutoSync() {
    if (autoSyncTimer !== null) {
      window.clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }
  },
  async syncBalance(retries = 8, delayMs = 500) {
    if (!this.isActive()) return null;
    let lastError = null;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const result = await pendingRequest("trade-jito:balance");
        return Number(result.balance);
      } catch (error) {
        lastError = error;
        if (attempt < retries - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Could not sync wallet balance");
  },
  async openTrade(payload) {
    if (!this.isActive()) return null;
    return pendingRequest("trade-jito:open", payload);
  },
  async settleTrade(payload) {
    if (!this.isActive()) return null;
    return pendingRequest("trade-jito:settle", payload);
  },
};

window.PrizeJitoBridge = PrizeJitoBridge;
