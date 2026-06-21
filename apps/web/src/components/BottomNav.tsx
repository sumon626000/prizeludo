import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { GamingIcon, type GamingIconName } from "./icons";

const items: Array<{
  to: string;
  label: "home" | "tournaments" | "leaders" | "wallet" | "refer";
  icon: GamingIconName;
}> = [
  { to: "/", label: "home", icon: "ludo-token" },
  { to: "/tournaments", label: "tournaments", icon: "start-play" },
  { to: "/leaders", label: "leaders", icon: "leaderboard" },
  { to: "/wallet", label: "wallet", icon: "wallet" },
  { to: "/refer", label: "refer", icon: "referral" },
];

export function BottomNav({
  authenticated,
  onProtected,
}: {
  authenticated: boolean;
  onProtected: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="bottom-nav glass" aria-label="Main navigation">
      {items.map(({ to, label, icon }) => (
        <NavLink
          end={to === "/"}
          key={to}
          to={to}
          onClick={(event) => {
            if (!authenticated && (to === "/wallet" || to === "/refer")) {
              event.preventDefault();
              onProtected();
            }
          }}
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          <GamingIcon name={icon} size={24} />
          <span>{t(label)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
