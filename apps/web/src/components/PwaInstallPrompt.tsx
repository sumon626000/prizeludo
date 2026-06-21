import { useEffect } from "react";
import { Download, Share, Smartphone, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePwaInstall } from "../hooks/usePwaInstall";

interface PwaInstallPromptProps {
  logoUrl?: string;
  siteName?: string;
}

function absoluteAssetUrl(value: string): string {
  if (/^(data:|https?:)/i.test(value)) return value;
  return new URL(value, window.location.origin).href;
}

export function PwaInstallPrompt({
  logoUrl = "/prizejito-logo.png",
  siteName = "PrizeJito.com",
}: PwaInstallPromptProps) {
  const { t } = useTranslation();
  const { canInstall, dismiss, install, isIos, visible } = usePwaInstall();

  useEffect(() => {
    const icon = absoluteAssetUrl(logoUrl || "/prizejito-logo.png");
    const manifest = {
      name: siteName,
      short_name: siteName,
      description: "Real-time Ludo tournament platform",
      theme_color: "#06160f",
      background_color: "#020a06",
      display: "standalone",
      orientation: "portrait",
      start_url: "/",
      lang: "bn",
      icons: [
        {
          src: icon,
          sizes: "any",
          purpose: "any maskable",
        },
      ],
    };
    const blobUrl = URL.createObjectURL(
      new Blob([JSON.stringify(manifest)], {
        type: "application/manifest+json",
      }),
    );
    let manifestLink = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    );
    if (!manifestLink) {
      manifestLink = document.createElement("link");
      manifestLink.rel = "manifest";
      document.head.append(manifestLink);
    }
    manifestLink.href = blobUrl;

    let appleIcon = document.querySelector<HTMLLinkElement>(
      'link[rel="apple-touch-icon"]',
    );
    if (!appleIcon) {
      appleIcon = document.createElement("link");
      appleIcon.rel = "apple-touch-icon";
      document.head.append(appleIcon);
    }
    appleIcon.href = icon;

    return () => URL.revokeObjectURL(blobUrl);
  }, [logoUrl, siteName]);

  if (!visible) return null;

  return (
    <aside className="pwa-install-prompt glass" aria-label={t("installApp")}>
      <button
        className="pwa-install-prompt__close"
        onClick={dismiss}
        aria-label={t("close")}
      >
        <X size={16} />
      </button>
      <img src={logoUrl || "/prizejito-logo.png"} alt="" />
      <div>
        <strong>{t("installKhanLudo")}</strong>
        <p>
          {isIos && !canInstall
            ? t("iosInstallHelp")
            : t("installAppDescription")}
        </p>
        {isIos && !canInstall ? (
          <span className="pwa-ios-steps">
            <Share size={15} /> {t("iosShareThenAdd")}
          </span>
        ) : (
          <button className="primary-button" onClick={() => void install()}>
            <Download size={16} /> {t("installApp")}
          </button>
        )}
      </div>
      <Smartphone className="pwa-install-prompt__phone" size={24} />
    </aside>
  );
}
