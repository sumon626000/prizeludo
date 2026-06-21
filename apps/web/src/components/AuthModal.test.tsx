import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { AuthModal } from "./AuthModal";

const auth = vi.hoisted(() => ({
  continueAsGuest: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
}));
const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("../context/AuthContext", () => ({
  useAuth: () => auth,
}));
vi.mock("../lib/api", () => ({
  apiRequest,
  getGoogleLoginUrl: () => "/api/auth/google",
  googleLoginUrl: "/api/auth/google",
}));

describe("AuthModal", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    history.replaceState({}, "", "/");
    await i18n.changeLanguage("en");
  });

  it("creates an account directly without a registration OTP step", async () => {
    const onClose = vi.fn();
    render(<AuthModal open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    fireEvent.change(screen.getByPlaceholderText("Name"), {
      target: { value: "Direct Player" },
    });
    fireEvent.change(screen.getByPlaceholderText("Phone number"), {
      target: { value: "01700000000" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "DirectPass10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          phone: "01700000000",
          name: "Direct Player",
          password: "DirectPass10",
        }),
      }),
    );
    expect(auth.refresh).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByPlaceholderText("6-digit OTP")).not.toBeInTheDocument();
  });

  it("creates an authenticated guest player explicitly", async () => {
    const onClose = vi.fn();
    render(<AuthModal open onClose={onClose} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Continue as guest" }),
    );

    await waitFor(() => expect(auth.continueAsGuest).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
