import { useEffect, useState } from "react";
import {
  checkApkAvailable,
  getApkDownloadUrl,
  isAndroidDevice,
  isIosDevice,
  isStandaloneApp,
  triggerApkDownload,
} from "../lib/app-install";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const installedKey = "khan-ludo-pwa-installed";
const dismissedKey = "khan-ludo-pwa-prompt-dismissed";

export function usePwaInstall() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandaloneApp());
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(dismissedKey) === "true",
  );
  const [apkAvailable, setApkAvailable] = useState(false);
  const isIos = isIosDevice();
  const isAndroid = isAndroidDevice();

  useEffect(() => {
    if (isStandaloneApp()) {
      localStorage.setItem(installedKey, "true");
      setInstalled(true);
      return;
    }

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      localStorage.setItem(installedKey, "true");
      localStorage.removeItem(dismissedKey);
      setInstalled(true);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!isAndroid || installed) {
      setApkAvailable(false);
      return;
    }
    let cancelled = false;
    void checkApkAvailable(getApkDownloadUrl()).then((available) => {
      if (!cancelled) setApkAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, [installed, isAndroid]);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") {
      localStorage.setItem(installedKey, "true");
      setInstallEvent(null);
      setInstalled(true);
    }
  };

  const downloadApk = () => {
    triggerApkDownload(getApkDownloadUrl());
  };

  const dismiss = () => {
    localStorage.setItem(dismissedKey, "true");
    setDismissed(true);
  };

  const reopenPrompt = () => {
    localStorage.removeItem(dismissedKey);
    setDismissed(false);
  };

  const canInstall = Boolean(installEvent);
  const canDownloadApk = isAndroid && apkAvailable;
  const showInstallEntry =
    !installed && (canInstall || isIos || canDownloadApk);

  return {
    apkDownloadUrl: getApkDownloadUrl(),
    canDownloadApk,
    canInstall,
    reopenPrompt,
    showInstallEntry,
    dismiss,
    downloadApk,
    installed,
    isAndroid,
    isIos,
    visible: showInstallEntry && !dismissed,
    install,
  };
}
