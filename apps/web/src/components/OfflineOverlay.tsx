import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

export function OfflineOverlay({ logoUrl = "/prizejito-logo.png" }: { logoUrl?: string }) {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="offline-overlay" role="alert">
      <div className="offline-card glass">
        <img src={logoUrl || "/prizejito-logo.png"} alt="" />
        <CloudOff size={34} />
        <h1>{t("youAreOffline")}</h1>
        <p>{t("offlineDescription")}</p>
        <button className="primary-button" onClick={() => window.location.reload()}>
          <RefreshCw size={16} /> {t("tryAgain")}
        </button>
      </div>
    </div>
  );
}
