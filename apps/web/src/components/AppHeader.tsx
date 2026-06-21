import {
  Check,
  Copy,
  Globe2,
  LogIn,
  Plus,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { resolvedAvatar } from "../lib/avatar";
import { GamingIcon } from "./icons";

export function AppHeader({
  onLogin,
  onNotifications,
  unreadCount,
}: {
  onLogin: () => void;
  onNotifications: () => void;
  unreadCount: number;
}) {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const totalBalance = Number(user?.mainBalance ?? 0) + Number(user?.winnerBalance ?? 0);
  const formattedBalance = new Intl.NumberFormat("en-BD", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(totalBalance);
  const balanceSize =
    formattedBalance.length > 11
      ? "long"
      : formattedBalance.length > 8
        ? "medium"
        : "short";

  const changeLanguage = (language: "bn" | "en") => {
    void i18n.changeLanguage(language);
    localStorage.setItem("khan-ludo-language", language);
  };

  const copyGameId = async () => {
    if (!user) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(user.gameId);
    } else {
      const input = document.createElement("textarea");
      input.value = user.gameId;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };

  return (
    <header className={`app-header glass ${user ? "has-balance" : ""}`}>
      {user ? (
        <div
          className="identity identity--user"
          role="button"
          tabIndex={0}
          onPointerUpCapture={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest(".identity__copy")
            ) {
              return;
            }
            navigate("/profile");
          }}
          onClick={() => navigate("/profile")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              navigate("/profile");
            }
          }}
        >
          <Link className="identity__profile" to="/profile">
            <span className="identity__avatar-shell">
              <img src={resolvedAvatar(user.avatar, user.gameId)} alt="" />
              <span className="identity__verified" aria-hidden="true">
                <ShieldCheck size={11} />
              </span>
            </span>
            <span className="identity__details">
              <strong className="identity__name">{user.name}</strong>
              <span className="identity__game-id">
                <strong>#{user.gameId}</strong>
                <button
                  type="button"
                  className={`identity__copy ${copied ? "copied" : ""}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void copyGameId();
                  }}
                  aria-label="Copy Game ID"
                  title={copied ? "Copied" : "Copy Game ID"}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </span>
            </span>
          </Link>
        </div>
      ) : (
        <button className="identity identity--button" onClick={onLogin}>
          <span className="identity__avatar">
            <UserRound size={19} />
          </span>
          <span>
            <small>{t("guest")}</small>
            <strong>{t("login")}</strong>
          </span>
          <LogIn size={16} />
        </button>
      )}

      {user && (
        <div className="header-balance">
          <Link className="header-balance__summary" to="/wallet">
            <span className="header-balance__wallet" aria-hidden="true">
              <GamingIcon name="wallet" size={20} />
            </span>
            <span className="header-balance__copy">
              <strong className={`header-balance__amount balance-${balanceSize}`}>
                ৳{formattedBalance}
              </strong>
            </span>
          </Link>
          <Link
            className="header-balance__add"
            to="/wallet?tab=deposit"
            aria-label={i18n.language === "bn" ? "ব্যালেন্স যোগ করুন" : "Add balance"}
          >
            <Plus size={18} strokeWidth={2.6} />
            <small>{i18n.language === "bn" ? "যোগ করুন" : "Add"}</small>
          </Link>
        </div>
      )}

      <div className="header-actions">
        <div className="language-switch" aria-label="Language">
          <Globe2 className="language-switch__globe" aria-hidden="true" />
          <button
            type="button"
            className={i18n.language === "bn" ? "active" : ""}
            onClick={() => changeLanguage("bn")}
          >
            BN
          </button>
          <button
            type="button"
            className={i18n.language === "en" ? "active" : ""}
            onClick={() => changeLanguage("en")}
          >
            EN
          </button>
        </div>

        <button
          className="icon-button"
          aria-label="Notifications"
          onClick={onNotifications}
        >
          <GamingIcon name="notification" size={18} />
          {unreadCount > 0 && (
            <span className="notification-count">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
