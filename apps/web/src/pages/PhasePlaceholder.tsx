import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export function PhasePlaceholder({
  titleKey,
  icon: Icon,
}: {
  titleKey: string;
  icon: LucideIcon;
}) {
  const { t } = useTranslation();
  return (
    <main className="page placeholder-page">
      <section className="placeholder-card glass">
        <span><Icon size={28} /></span>
        <h1>{t(titleKey)}</h1>
        <p>{t("upcomingPhase")}</p>
      </section>
    </main>
  );
}
