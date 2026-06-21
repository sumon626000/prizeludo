import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiRequest } from "../lib/api";
import { socket } from "../lib/socket";
import type { AuthState, User } from "../types";

interface AuthContextValue {
  loading: boolean;
  user: User | null;
  adminClaimAvailable: boolean;
  refresh: () => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  continueAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
  claimAdmin: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [adminClaimAvailable, setAdminClaimAvailable] = useState(false);

  const refresh = useCallback(async () => {
    const state = await apiRequest<AuthState>("/api/auth/me");
    setUser(state.user ?? null);
    setAdminClaimAvailable(state.adminClaimAvailable);
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => {
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    const onProfileUpdate = (updatedUser: User) => setUser(updatedUser);
    const onWalletUpdate = () => {
      void refresh();
    };
    socket.on("profile:update", onProfileUpdate);
    socket.on("wallet:update", onWalletUpdate);
    socket.on("balance:update", onWalletUpdate);
    return () => {
      socket.off("profile:update", onProfileUpdate);
      socket.off("wallet:update", onWalletUpdate);
      socket.off("balance:update", onWalletUpdate);
    };
  }, [refresh]);

  const login = useCallback(
    async (phone: string, password: string) => {
      const result = await apiRequest<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ phone, password }),
      });
      setUser(result.user);
      setAdminClaimAvailable(
        (await apiRequest<{ available: boolean }>("/api/auth/admin-claim/status"))
          .available,
      );
    },
    [],
  );

  const logout = useCallback(async () => {
    await apiRequest<void>("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const continueAsGuest = useCallback(async () => {
    const result = await apiRequest<{
      authenticated: true;
      guest: true;
      user: User;
    }>("/api/auth/guest", { method: "POST" });
    setUser(result.user);
    setAdminClaimAvailable(false);
  }, []);

  const claimAdmin = useCallback(async () => {
    const result = await apiRequest<{
      user: User;
      adminClaimAvailable: boolean;
    }>("/api/auth/admin-claim", { method: "POST" });
    setUser(result.user);
    setAdminClaimAvailable(result.adminClaimAvailable);
  }, []);

  const value = useMemo(
    () => ({
      loading,
      user,
      adminClaimAvailable,
      refresh,
      login,
      continueAsGuest,
      logout,
      claimAdmin,
    }),
    [
      adminClaimAvailable,
      claimAdmin,
      continueAsGuest,
      loading,
      login,
      logout,
      refresh,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
