import { Download, Share, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePwaInstall } from "../hooks/usePwaInstall";

export function AppInstallButton({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const {
    canDownloadApk,
    canInstall,
    downloadApk,
    install,
    isIos,
    reopenPrompt,
    showInstallEntry,
  } = usePwaInstall();

  if (!showInstallEntry) return null;

  const label = canDownloadApk && !canInstall ? t("downloadApk") : t("installApp");
  const Icon = isIos && !canInstall ? Share : canDownloadApk && !canInstall ? Smartphone : Download;

  const handleClick = () => {
    if (canInstall) {
      void install();
      return;
    }
    if (canDownloadApk) {
      downloadApk();
      return;
    }
    if (isIos && !canInstall) {
      reopenPrompt();
      return;
    }
  };

  return (
    <button
      type="button"
      className={`app-install-button ${compact ? "app-install-button--compact" : ""} ${className}`.trim()}
      onClick={handleClick}
    >
      <Icon size={compact ? 16 : 18} />
      <span>{label}</span>
    </button>
  );
}
