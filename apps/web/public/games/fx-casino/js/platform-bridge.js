const params = new URLSearchParams(window.location.search);
const embedded = params.get("embedded") === "prizejito";
const autostart = params.get("autostart") === "1";

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
  async syncBalance() {
    if (!this.isActive()) return null;
    const result = await pendingRequest("trade-jito:balance");
    return Number(result.balance);
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
