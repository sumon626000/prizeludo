import { useState, type FormEvent } from "react";
import { ArrowLeft, Globe2, Leaf, UserRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { apiRequest, getGoogleLoginUrl } from "../lib/api";

type Mode = "login" | "register" | "forgot";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

export function AuthModal({ open, onClose }: AuthModalProps) {
  const { i18n, t } = useTranslation();
  const recoveryHelp =
    i18n.language === "bn"
      ? "OTP লাগবে না। আপনার ফোন নম্বর দিয়ে recovery request পাঠান। Support team মালিকানা যাচাই করে নতুন password সেট করবে।"
      : "No OTP is required. Send a recovery request with your phone number. Support will verify ownership and set a new password.";
  const { continueAsGuest, login, refresh } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [registration, setRegistration] = useState({
    phone: "",
    name: "",
    email: "",
    password: "",
    referCode: new URLSearchParams(window.location.search).get("ref") ?? "",
  });
  const [forgot, setForgot] = useState({
    phone: "",
    message: "",
  });

  if (!open) return null;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(async () => {
      await login(String(data.get("phone")), String(data.get("password")));
      onClose();
    });
  };

  const submitRegistration = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      await apiRequest("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          phone: registration.phone,
          name: registration.name,
          password: registration.password,
          ...(registration.email ? { email: registration.email } : {}),
          ...(registration.referCode
            ? { referCode: registration.referCode }
            : {}),
        }),
      });
      await refresh();
      onClose();
    });
  };

  const enterAsGuest = () => {
    void run(async () => {
      await continueAsGuest();
      onClose();
    });
  };

  const submitForgot = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      await apiRequest("/api/auth/password/request-help", {
        method: "POST",
        body: JSON.stringify(forgot),
      });
      setMessage(
        i18n.language === "bn"
          ? "Recovery request পাঠানো হয়েছে। Support team আপনার সঙ্গে যোগাযোগ করবে।"
          : "Recovery request sent. Support will contact you after verification.",
      );
    });
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setMessage("");
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="auth-modal auth-modal--premium glass" role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} aria-label={t("close")}>
          <X size={19} />
        </button>
        <div className="auth-modal__brand">
          <span><Leaf size={22} /></span>
          <div>
            <strong>{t("appName")}</strong>
            <small>{t("guestNotice")}</small>
          </div>
        </div>

        {mode === "login" && (
          <>
            <div className="auth-tabs">
              <button className="active">{t("login")}</button>
              <button onClick={() => switchMode("register")}>{t("register")}</button>
            </div>
            <form onSubmit={submitLogin} className="auth-form">
              <input name="phone" inputMode="tel" placeholder={t("phone")} required />
              <input
                name="password"
                type="password"
                placeholder={t("password")}
                required
              />
              <button className="primary-button" disabled={busy}>
                {busy ? t("working") : t("login")}
              </button>
            </form>
            <button className="text-button" onClick={() => switchMode("forgot")}>
              {t("forgotPassword")}
            </button>
            <div className="auth-alternatives">
              <a className="google-button" href={getGoogleLoginUrl()}>
                <Globe2 size={18} />
                <span>{t("googleLogin")}</span>
              </a>
              <button
                type="button"
                className="guest-button"
                disabled={busy}
                onClick={enterAsGuest}
              >
                <UserRound size={18} />
                <span>{busy ? t("working") : t("continueAsGuest")}</span>
              </button>
            </div>
          </>
        )}

        {mode === "register" && (
          <>
            <div className="auth-tabs">
              <button onClick={() => switchMode("login")}>{t("login")}</button>
              <button className="active">{t("register")}</button>
            </div>
            <form onSubmit={submitRegistration} className="auth-form">
              <input
                placeholder={t("name")}
                value={registration.name}
                onChange={(event) =>
                  setRegistration({ ...registration, name: event.target.value })
                }
                required
              />
              <input
                inputMode="tel"
                placeholder={t("phone")}
                value={registration.phone}
                onChange={(event) =>
                  setRegistration({ ...registration, phone: event.target.value })
                }
                required
              />
              <input
                type="email"
                placeholder={t("email")}
                value={registration.email}
                onChange={(event) =>
                  setRegistration({ ...registration, email: event.target.value })
                }
              />
              <input
                type="password"
                placeholder={t("password")}
                value={registration.password}
                onChange={(event) =>
                  setRegistration({
                    ...registration,
                    password: event.target.value,
                  })
                }
                minLength={8}
                required
              />
              <input
                placeholder={t("referCode")}
                value={registration.referCode}
                onChange={(event) =>
                  setRegistration({
                    ...registration,
                    referCode: event.target.value,
                  })
                }
              />
              <button className="primary-button" disabled={busy}>
                {busy ? t("working") : t("createAccount")}
              </button>
            </form>
          </>
        )}

        {mode === "forgot" && (
          <>
            <button className="back-button" onClick={() => switchMode("login")}>
              <ArrowLeft size={16} /> {t("backToLogin")}
            </button>
            <h2>{t("resetPassword")}</h2>
            <p className="auth-recovery-help">{recoveryHelp}</p>
            <form onSubmit={submitForgot} className="auth-form">
              <input
                inputMode="tel"
                placeholder={t("phone")}
                value={forgot.phone}
                onChange={(event) =>
                  setForgot({ ...forgot, phone: event.target.value })
                }
                required
              />
              <textarea
                placeholder={
                  i18n.language === "bn"
                    ? "অ্যাকাউন্ট সম্পর্কে অতিরিক্ত তথ্য (ঐচ্ছিক)"
                    : "Extra account details (optional)"
                }
                value={forgot.message}
                onChange={(event) =>
                  setForgot({ ...forgot, message: event.target.value })
                }
                maxLength={1000}
              />
              <button className="primary-button" disabled={busy}>
                {busy
                  ? t("working")
                  : i18n.language === "bn"
                    ? "Recovery request পাঠান"
                    : "Send recovery request"}
              </button>
            </form>
          </>
        )}

        {message && <p className="form-message">{message}</p>}
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  );
}
