import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { initRuntimeConfig } from "./lib/api";
import { reconfigureSocket } from "./lib/socket";
import "./i18n";
import "./styles.css";
import "./styles.design-system.css";
import "./styles.phase3.css";
import "./styles.phase4.css";
import "./styles.phase5.css";
import "./styles.mobile-fixes.css";
import "./styles.motion-lite.css";
import "./styles.game-scene.css";
import "./styles.glass.css";
import "./styles.game-performance.css";
import "./styles.layout-full.css";
import "./styles.site-theme.css";
import "./styles.ui-polish.css";
import "./styles.ambient.css";

const preventBrowserZoom = (event: WheelEvent | KeyboardEvent) => {
  const keyboardZoom =
    event instanceof KeyboardEvent &&
    (event.ctrlKey || event.metaKey) &&
    ["+", "-", "=", "0"].includes(event.key);
  if ((event instanceof WheelEvent && event.ctrlKey) || keyboardZoom) {
    event.preventDefault();
  }
};

document.addEventListener("wheel", preventBrowserZoom, { passive: false });
document.addEventListener("keydown", preventBrowserZoom);
document.addEventListener("gesturestart", (event) => event.preventDefault());

if (import.meta.env.DEV && "serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister();
    }
  });
}

const root = createRoot(document.getElementById("root")!);

void initRuntimeConfig().then((apiUrl) => {
  reconfigureSocket(apiUrl);
  root.render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
});
