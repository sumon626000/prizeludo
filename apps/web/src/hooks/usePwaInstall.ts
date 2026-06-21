import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const installedKey = "khan-ludo-pwa-installed";
const dismissedKey = "khan-ludo-pwa-prompt-dismissed";

export function usePwaInstall() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(dismissedKey) === "true",
  );
  const isIos =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const navigatorWithStandalone = navigator as Navigator & {
      standalone?: boolean;
    };
    if (
      localStorage.getItem(installedKey) === "true" ||
      window.matchMedia?.("(display-mode: standalone)").matches ||
      navigatorWithStandalone.standalone === true
    ) {
      localStorage.setItem(installedKey, "true");
      setInstalled(true);
      return;
    }

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const installed = () => {
      localStorage.setItem(installedKey, "true");
      localStorage.removeItem(dismissedKey);
      setInstalled(true);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") {
      localStorage.setItem(installedKey, "true");
      setInstallEvent(null);
    }
  };

  const dismiss = () => {
    localStorage.setItem(dismissedKey, "true");
    setDismissed(true);
  };

  return {
    canInstall: Boolean(installEvent),
    isIos,
    visible: !installed && !dismissed && (Boolean(installEvent) || isIos),
    install,
    dismiss,
  };
}
