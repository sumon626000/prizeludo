import {
  Activity,
  Banknote,
  BarChart3,
  Bell,
  CheckCircle2,
  Download,
  Gauge,
  LifeBuoy,
  LogIn,
  LogOut,
  Menu,
  Pencil,
  Search,
  Settings,
  Shield,
  Trophy,
  UserCog,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
} from "react";
import { useAuth } from "../context/AuthContext";
import { PaymentGatewayAdminSection } from "../components/PaymentGatewayAdminSection";
import { TradeJitoAdminSection } from "../components/TradeJitoAdminSection";
import { apiBlob, apiRequest, apiUpload } from "../lib/api";
import { resolvedAvatar } from "../lib/avatar";
import {
  presetToSettingValues,
  THEME_PRESETS,
  type ThemePresetColors,
} from "../lib/theme-presets";
import type { TournamentSummary } from "../types";

type AdminTab =
  | "overview"
  | "users"
  | "finance"
  | "tournaments"
  | "support"
  | "settings"
  | "team";

interface Dashboard {
  stats: {
    todayDeposits: { count: number; amount: string };
    todayWithdrawals: { count: number; amount: string };
    monthDeposits: string;
    activePlayers: number;
    activeTournaments: number;
    totalUsers: number;
    allTimeRevenue: string;
  };
  revenue: Record<string, string>;
}

interface AdminUserRow {
  id: string;
  gameId: string;
  name: string;
  phone: string | null;
  email: string | null;
  avatar: string;
  mainBalance: string;
  winnerBalance: string;
  isBanned: boolean;
  ipAddress: string | null;
  deviceId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserDetail {
  user: AdminUserRow;
  security: {
    ipAddress: string | null;
    deviceId: string | null;
    sessions: Array<Record<string, string | null>>;
  };
  transactions: Array<{
    id: string;
    type: string;
    amount: string;
    status: string;
    createdAt: string;
  }>;
  tournaments: Array<{
    id: string;
    title: string;
    status: string;
    joinedAt: string;
  }>;
}

interface FinancialPoint {
  bucket: string;
  deposits: string;
  withdrawals: string;
  prizes: string;
  collected: string;
  revenue: string;
}

interface QueueItem {
  transaction: {
    id: string;
    type: "deposit" | "withdraw";
    amount: string;
    status: "pending" | "approved";
    method: string | null;
    createdAt: string;
    metadata?: { accountLastFour?: string | null };
  };
  user: {
    id: string;
    gameId: string;
    name: string;
    phone: string | null;
  };
}

interface AdminTransactionRow {
  id: string;
  type: "deposit" | "withdraw" | "transfer";
  amount: string;
  status: string;
  method?: string | null;
  reference?: string | null;
  createdAt: string;
  user: { id: string; gameId: string; name: string; phone: string | null };
}

interface TicketRow {
  ticket: {
    id: string;
    subject: string;
    message: string;
    status: "open" | "in_progress" | "resolved";
    adminReply: string | null;
    assignedTo: string | null;
    createdAt: string;
  };
  user: { id: string; gameId: string; name: string; phone: string | null };
}

interface TournamentRow extends TournamentSummary {}

interface SubAdminRow {
  id: string;
  username: string;
  name: string;
  permissions: string[];
  lastLoginAt: string | null;
}

interface NotificationHistoryRow {
  id: string;
  targetId: string | null;
  details: {
    title?: string;
    message?: string;
    delivered?: number;
  };
  createdAt: string;
  actor: {
    id: string;
    name: string;
    username: string | null;
  };
}

type AdminRun = (
  action: () => Promise<void>,
  successMessage?: string,
) => Promise<void>;

const navigation: Array<{
  id: AdminTab;
  label: string;
  icon: typeof Gauge;
  permission?: string;
  mainOnly?: boolean;
}> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "users", label: "Users", icon: Users, permission: "users" },
  { id: "finance", label: "Finance", icon: Banknote, permission: "financial" },
  {
    id: "tournaments",
    label: "Tournaments",
    icon: Trophy,
    permission: "tournaments",
  },
  { id: "support", label: "Support", icon: LifeBuoy, permission: "support" },
  { id: "settings", label: "Settings", icon: Settings, mainOnly: true },
  { id: "team", label: "Admin team", icon: UserCog, mainOnly: true },
];

function money(value: string | number) {
  return `৳${Number(value || 0).toLocaleString("en-BD", {
    maximumFractionDigits: 2,
  })}`;
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function fieldValue(
  event: FormEvent<HTMLFormElement>,
  name: string,
): string {
  return String(new FormData(event.currentTarget).get(name) ?? "");
}

export function AdminPage() {
  const { user, refresh, logout } = useAuth();
  const [tab, setTab] = useState<AdminTab>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [search, setSearch] = useState("");
  const [userStatus, setUserStatus] = useState("all");
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [reportPeriod, setReportPeriod] = useState("daily");
  const [report, setReport] = useState<FinancialPoint[]>([]);
  const [queueType, setQueueType] = useState<"deposit" | "withdraw">("deposit");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [txHistoryType, setTxHistoryType] = useState<
    "all" | "deposit" | "withdraw" | "transfer"
  >("all");
  const [txHistoryPage, setTxHistoryPage] = useState(0);
  const [txHistory, setTxHistory] = useState<AdminTransactionRow[]>([]);
  const [txHistoryTotal, setTxHistoryTotal] = useState(0);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [supportStatus, setSupportStatus] = useState<
    "all" | "open" | "in_progress" | "resolved"
  >("all");
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [editingTournament, setEditingTournament] = useState<TournamentRow | null>(
    null,
  );
  const [settingsValues, setSettingsValues] = useState<Record<string, string>>(
    {},
  );
  const [subAdmins, setSubAdmins] = useState<SubAdminRow[]>([]);

  const isAdmin = Boolean(user?.isAdmin || user?.isSubAdmin);
  const mainAdmin = Boolean(user?.isAdmin);
  const can = useCallback(
    (permission: string) =>
      mainAdmin || Boolean(user?.adminPermissions.includes(permission)),
    [mainAdmin, user?.adminPermissions],
  );
  const visibleNavigation = useMemo(
    () =>
      navigation.filter(
        (item) =>
          (!item.mainOnly || mainAdmin) &&
          (!item.permission || can(item.permission)),
      ),
    [can, mainAdmin],
  );

  const run = useCallback(async (
    action: () => Promise<void>,
    successMessage?: string,
  ) => {
    setBusy(true);
    setError("");
    try {
      await action();
      if (successMessage) setMessage(successMessage);
    } catch (caught) {
      setMessage("");
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!message && !error) return;
    const timer = window.setTimeout(
      () => {
        setMessage("");
        setError("");
      },
      error ? 6_000 : 3_500,
    );
    return () => window.clearTimeout(timer);
  }, [error, message]);

  const loadDashboard = useCallback(
    () =>
      run(async () => {
        setDashboard(
          await apiRequest<Dashboard>("/api/admin/dashboard"),
        );
      }),
    [run],
  );

  const loadUsers = useCallback(
    () =>
      run(async () => {
        const query = new URLSearchParams({
          status: userStatus,
          ...(search ? { search } : {}),
        });
        const result = await apiRequest<{ users: AdminUserRow[] }>(
          `/api/admin/users?${query}`,
        );
        setUsers(result.users);
      }),
    [run, search, userStatus],
  );

  const loadFinance = useCallback(
    () =>
      run(async () => {
        const txQuery = new URLSearchParams({
          page: String(txHistoryPage),
          pageSize: "30",
          ...(txHistoryType !== "all" ? { type: txHistoryType } : {}),
        });
        const [chart, pending, history] = await Promise.all([
          mainAdmin
            ? apiRequest<{ points: FinancialPoint[] }>(
                `/api/admin/reports/financial?period=${reportPeriod}`,
              )
            : Promise.resolve({ points: [] }),
          apiRequest<{ items: QueueItem[] }>(
            `/api/wallet/admin/queue/${queueType}`,
          ),
          apiRequest<{
            items: AdminTransactionRow[];
            total: number;
          }>(`/api/wallet/admin/transactions?${txQuery}`),
        ]);
        setReport(chart.points);
        setQueue(pending.items);
        setTxHistory(history.items);
        setTxHistoryTotal(history.total);
      }),
    [mainAdmin, queueType, reportPeriod, run, txHistoryPage, txHistoryType],
  );

  const loadTournaments = useCallback(
    () =>
      run(async () => {
        const result = await apiRequest<{ tournaments: TournamentRow[] }>(
          "/api/tournaments?includeCompleted=true",
        );
        setTournaments(result.tournaments);
      }),
    [run],
  );

  const loadSupport = useCallback(
    () =>
      run(async () => {
        const result = await apiRequest<{ tickets: TicketRow[] }>(
          `/api/admin/support?status=${supportStatus}`,
        );
        setTickets(result.tickets);
      }),
    [run, supportStatus],
  );

  const loadSettings = useCallback(
    () =>
      run(async () => {
        const result = await apiRequest<{
          values: Record<string, string>;
        }>("/api/admin/settings");
        setSettingsValues(result.values);
      }),
    [run],
  );

  const loadTeam = useCallback(
    () =>
      run(async () => {
        const result = await apiRequest<{ subAdmins: SubAdminRow[] }>(
          "/api/admin/subadmins",
        );
        setSubAdmins(result.subAdmins);
      }),
    [run],
  );

  useEffect(() => {
    if (!isAdmin) return;
    if (tab === "overview") void loadDashboard();
    if (tab === "users" && can("users")) void loadUsers();
    if (tab === "finance" && can("financial")) void loadFinance();
    if (tab === "tournaments" && can("tournaments")) void loadTournaments();
    if (tab === "support" && can("support")) {
      void loadSupport();
      if (mainAdmin) void loadTeam();
    }
    if (tab === "settings" && mainAdmin) void loadSettings();
    if (tab === "team" && mainAdmin) void loadTeam();
  }, [
    can,
    isAdmin,
    loadDashboard,
    loadFinance,
    loadSettings,
    loadSupport,
    loadTeam,
    loadTournaments,
    loadUsers,
    mainAdmin,
    tab,
    txHistoryPage,
    txHistoryType,
    queueType,
  ]);

  const reviewQueueItem = useCallback(
    async (item: QueueItem, action: "approve" | "reject" | "paid") => {
      const reason =
        action === "reject"
          ? window.prompt("Rejection reason?")?.trim()
          : undefined;
      if (action === "reject" && !reason) return;

      if (item.transaction.type === "deposit") {
        await apiRequest(
          `/api/wallet/admin/deposits/${item.transaction.id}/review`,
          {
            method: "POST",
            body: JSON.stringify({
              approve: action === "approve",
              ...(reason ? { reason } : {}),
            }),
          },
        );
      } else {
        await apiRequest(
          `/api/wallet/admin/withdrawals/${item.transaction.id}/review`,
          {
            method: "POST",
            body: JSON.stringify({
              status:
                action === "approve" || action === "paid"
                  ? "paid"
                  : "rejected",
              ...(reason ? { reason } : {}),
            }),
          },
        );
      }
      setMessage(
        action === "reject"
          ? "Request rejected."
          : item.transaction.type === "withdraw"
            ? "Withdrawal marked as paid."
            : "Request approved.",
      );
      await loadFinance();
    },
    [loadFinance],
  );

  const openUser = (userId: string) =>
    run(async () => {
      setSelectedUser(
        await apiRequest<UserDetail>(`/api/admin/users/${userId}`),
      );
    });

  const updateBalance = (
    event: FormEvent<HTMLFormElement>,
    balance: "main" | "winner",
  ) => {
    event.preventDefault();
    if (!selectedUser) return;
    const form = event.currentTarget;
    void run(async () => {
      await apiRequest(`/api/admin/users/${selectedUser.user.id}/balance`, {
        method: "POST",
        body: JSON.stringify({
          balance,
          operation: fieldValue(event, "operation"),
          amount: Number(fieldValue(event, "amount")),
          reason: fieldValue(event, "reason"),
        }),
      });
      setMessage("Balance updated and audited.");
      form.reset();
      await Promise.all([openUser(selectedUser.user.id), loadUsers()]);
    });
  };

  const toggleBan = (row: AdminUserRow) =>
    run(async () => {
      await apiRequest(`/api/admin/users/${row.id}/ban`, {
        method: "POST",
        body: JSON.stringify({
          banned: !row.isBanned,
          reason: row.isBanned ? "Admin restored access" : "Admin security ban",
        }),
      });
      setMessage(row.isBanned ? "User unbanned." : "User banned.");
      setSelectedUser(null);
      await loadUsers();
    });

  const downloadCsv = (name: "users" | "transactions" | "tournaments") =>
    run(async () => {
      const blob = await apiBlob(`/api/admin/reports/${name}.csv`);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `prizejito-${name}.csv`;
      link.click();
      URL.revokeObjectURL(href);
    }, `${name} report download started.`);

  if (!isAdmin) {
    return (
      <main className="admin-login-page">
        <section className="admin-login-card">
          <img src="/prizejito-logo.png" alt="PrizeJito.com" />
          <span className="admin-kicker">
            <Shield size={14} /> Secure administration
          </span>
          <h1>Admin control room</h1>
          <p>Sign in with the main admin phone or a sub-admin username.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              void run(async () => {
                await apiRequest("/api/admin/login", {
                  method: "POST",
                  body: JSON.stringify({
                    identifier: fieldValue(event, "identifier"),
                    password: fieldValue(event, "password"),
                  }),
                });
                await refresh();
                form.reset();
              });
            }}
          >
            <label>
              Username or phone
              <input name="identifier" required autoComplete="username" />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
            {error && <p className="admin-error">{error}</p>}
            <button className="admin-primary" disabled={busy}>
              <LogIn size={16} /> {busy ? "Signing in..." : "Open dashboard"}
            </button>
          </form>
          <a href="/">Return to PrizeJito.com</a>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <aside className={menuOpen ? "admin-sidebar is-open" : "admin-sidebar"}>
        <div className="admin-brand">
          <img src="/prizejito-logo.png" alt="" />
          <span>
            <strong>PrizeJito.com</strong>
            <small>Admin control room</small>
          </span>
          <button onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav>
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => {
                  setTab(item.id);
                  setMenuOpen(false);
                }}
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="admin-identity">
          <img src={user!.avatar} alt="" />
          <span>
            <strong>{user!.name}</strong>
            <small>{mainAdmin ? "Main admin" : user!.username}</small>
          </span>
          <button
            onClick={() => void logout()}
            title="Log out"
            aria-label="Log out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <section className="admin-workspace">
        <header className="admin-topbar">
          <button
            className="admin-menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <span>
            <small>Phase 9</small>
            <strong>
              {navigation.find((item) => item.id === tab)?.label}
            </strong>
          </span>
          <div>
            <Activity size={15} />
            Live system
          </div>
        </header>

        {(message || error) && (
          <button
            className={`admin-flash ${error ? "is-error" : ""}`}
            role="status"
            aria-live="polite"
            onClick={() => {
              setMessage("");
              setError("");
            }}
          >
            {!error && <CheckCircle2 size={18} />}
            <span>{error || message}</span>
          </button>
        )}

        <div className="admin-content">
          {tab === "overview" && dashboard && (
            <>
              <section className="admin-title-row">
                <span>
                  <p>Live platform snapshot</p>
                  <h1>Business overview</h1>
                </span>
                <button onClick={() => void loadDashboard()}>
                  <Activity size={15} /> Refresh
                </button>
              </section>
              <section className="admin-stat-grid">
                <StatCard
                  label="Today deposits"
                  value={money(dashboard.stats.todayDeposits.amount)}
                  note={`${dashboard.stats.todayDeposits.count} payments`}
                />
                <StatCard
                  label="Today withdrawals"
                  value={money(dashboard.stats.todayWithdrawals.amount)}
                  note={`${dashboard.stats.todayWithdrawals.count} payouts`}
                />
                <StatCard
                  label="Month deposits"
                  value={money(dashboard.stats.monthDeposits)}
                  note="Current Dhaka month"
                />
                <StatCard
                  label="All-time revenue"
                  value={money(dashboard.stats.allTimeRevenue)}
                  note="Fees + commissions"
                />
                <StatCard
                  label="Online sockets"
                  value={dashboard.stats.activePlayers}
                  note="Connected right now"
                />
                <StatCard
                  label="Active tournaments"
                  value={dashboard.stats.activeTournaments}
                  note="Waiting and running"
                />
                <StatCard
                  label="Registered users"
                  value={dashboard.stats.totalUsers}
                  note="Bots excluded"
                />
              </section>
              <section className="admin-grid-two">
                <article className="admin-panel">
                  <header>
                    <span>
                      <small>Revenue mix</small>
                      <h2>Platform earnings</h2>
                    </span>
                    <BarChart3 size={20} />
                  </header>
                  <RevenueBars values={dashboard.revenue} />
                </article>
                <article className="admin-panel admin-quick-panel">
                  <header>
                    <span>
                      <small>Operations</small>
                      <h2>Quick actions</h2>
                    </span>
                    <Bell size={20} />
                  </header>
                  <button onClick={() => setTab("users")}>
                    <Users size={17} /> Search a player
                  </button>
                  {mainAdmin && (
                    <button onClick={() => setTab("settings")}>
                      <Bell size={17} /> Send a notice
                    </button>
                  )}
                  {can("financial") && (
                    <button onClick={() => setTab("finance")}>
                      <Banknote size={17} /> Review pending payments
                    </button>
                  )}
                </article>
              </section>
            </>
          )}

          {tab === "users" && can("users") && (
            <>
              <section className="admin-title-row">
                <span>
                  <p>Search by name, phone or immutable Game ID</p>
                  <h1>User management</h1>
                </span>
              </section>
              <form
                className="admin-filter-bar"
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadUsers();
                }}
              >
                <label>
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search players..."
                  />
                </label>
                <select
                  value={userStatus}
                  onChange={(event) => setUserStatus(event.target.value)}
                >
                  <option value="all">All users</option>
                  <option value="active">Active</option>
                  <option value="banned">Banned</option>
                </select>
                <button disabled={busy}>Search</button>
              </form>
              <section className="admin-table-card">
                <div className="admin-table-head admin-user-row">
                  <span>Player</span>
                  <span>Balances</span>
                  <span>Last login</span>
                  <span>Status</span>
                </div>
                {users.map((row) => (
                  <button
                    className="admin-user-row"
                    key={row.id}
                    onClick={() => void openUser(row.id)}
                  >
                    <span className="admin-person">
                      <img src={resolvedAvatar(row.avatar, row.gameId)} alt="" />
                      <i>
                        <strong>{row.name}</strong>
                        <small>#{row.gameId} · {row.phone || "No phone"}</small>
                      </i>
                    </span>
                    <span>
                      <strong>{money(row.mainBalance)}</strong>
                      <small>Winner {money(row.winnerBalance)}</small>
                    </span>
                    <span>
                      <strong>{shortDate(row.lastLoginAt)}</strong>
                      <small>{row.ipAddress || "No IP recorded"}</small>
                    </span>
                    <span
                      className={`admin-status ${row.isBanned ? "danger" : ""}`}
                    >
                      {row.isBanned ? "Banned" : "Active"}
                    </span>
                  </button>
                ))}
              </section>
            </>
          )}

          {tab === "finance" && can("financial") && (
            <>
              <section className="admin-title-row">
                <span>
                  <p>Transactions, payout queue and business reports</p>
                  <h1>Financial control</h1>
                </span>
                {mainAdmin && (
                  <div className="admin-downloads">
                    {(["users", "transactions", "tournaments"] as const).map(
                      (name) => (
                        <button key={name} onClick={() => void downloadCsv(name)}>
                          <Download size={14} /> {name}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </section>
              {mainAdmin && (
                <article className="admin-panel">
                  <header>
                    <span>
                      <small>Dhaka timezone</small>
                      <h2>Cash flow report</h2>
                    </span>
                    <select
                      value={reportPeriod}
                      onChange={(event) => setReportPeriod(event.target.value)}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </header>
                  <FinancialChart points={report} />
                </article>
              )}
              {mainAdmin && <PaymentGatewayAdminSection />}
              <section className="admin-title-row compact">
                <span>
                  <p>All users</p>
                  <h2>Deposit, withdraw & transfer history</h2>
                </span>
                <div className="admin-inline-actions">
                  <select
                    value={txHistoryType}
                    onChange={(event) => {
                      setTxHistoryType(
                        event.target.value as typeof txHistoryType,
                      );
                      setTxHistoryPage(0);
                    }}
                  >
                    <option value="all">All types</option>
                    <option value="deposit">Deposits</option>
                    <option value="withdraw">Withdrawals</option>
                    <option value="transfer">Transfers</option>
                  </select>
                  {mainAdmin && (
                    <button
                      className="danger"
                      onClick={() => {
                        if (
                          !window.confirm(
                            "Delete all deposit, withdraw and transfer history? Balances will not change.",
                          )
                        ) {
                          return;
                        }
                        void run(async () => {
                          const result = await apiRequest<{ deletedCount: number }>(
                            "/api/wallet/admin/transactions/history",
                            { method: "DELETE" },
                          );
                          setMessage(
                            `Cleared ${result.deletedCount} transaction records.`,
                          );
                          setTxHistoryPage(0);
                          await loadFinance();
                        });
                      }}
                    >
                      Clear all history
                    </button>
                  )}
                </div>
              </section>
              <section className="admin-table-card">
                <div className="admin-table-head admin-tx-row">
                  <span>Player</span>
                  <span>Type</span>
                  <span>Amount</span>
                  <span>Status</span>
                  <span>Date</span>
                </div>
                {txHistory.length === 0 && (
                  <Empty text="No transaction history yet." />
                )}
                {txHistory.map((item) => (
                  <article className="admin-tx-row" key={item.id}>
                    <span className="admin-person compact">
                      <i>
                        <strong>{item.user.name}</strong>
                        <small>#{item.user.gameId}</small>
                      </i>
                    </span>
                    <span className="admin-status">{item.type}</span>
                    <strong>{money(item.amount)}</strong>
                    <span className="admin-status">{item.status}</span>
                    <small>{shortDate(item.createdAt)}</small>
                  </article>
                ))}
              </section>
              {txHistoryTotal > 30 && (
                <div className="admin-pagination">
                  <button
                    disabled={txHistoryPage <= 0 || busy}
                    onClick={() => setTxHistoryPage((page) => page - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {txHistoryPage + 1} /{" "}
                    {Math.max(1, Math.ceil(txHistoryTotal / 30))}
                  </span>
                  <button
                    disabled={
                      busy ||
                      (txHistoryPage + 1) * 30 >= txHistoryTotal
                    }
                    onClick={() => setTxHistoryPage((page) => page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
              <section className="admin-title-row compact">
                <span>
                  <p>Manual reviews</p>
                  <h2>Pending {queueType}s</h2>
                </span>
                <select
                  value={queueType}
                  onChange={(event) =>
                    setQueueType(event.target.value as "deposit" | "withdraw")
                  }
                >
                  <option value="deposit">Deposits</option>
                  <option value="withdraw">Withdrawals</option>
                </select>
              </section>
              <section className="admin-card-list admin-card-list--queue">
                {queue.length === 0 && <Empty text="No pending request." />}
                {queue.map((item) => (
                  <article key={item.transaction.id}>
                    <span>
                      <strong>{item.user.name}</strong>
                      <small>
                        #{item.user.gameId} · {item.transaction.status} ·{" "}
                        {item.transaction.method || queueType} ·{" "}
                        {shortDate(item.transaction.createdAt)}
                        {item.transaction.metadata?.accountLastFour
                          ? ` · ****${item.transaction.metadata.accountLastFour}`
                          : ""}
                      </small>
                    </span>
                    <strong className="admin-queue-amount">
                      {money(item.transaction.amount)}
                    </strong>
                    <div className="admin-card-list__actions">
                      {item.transaction.status === "pending" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              reviewQueueItem(item, "approve"),
                            )
                          }
                        >
                          {item.transaction.type === "withdraw"
                            ? "Mark paid"
                            : "Approve"}
                        </button>
                      )}
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() =>
                          void run(() => reviewQueueItem(item, "reject"))
                        }
                      >
                        Reject
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            </>
          )}

          {tab === "tournaments" && can("tournaments") && (
            <>
              <section className="admin-title-row">
                <span>
                  <p>Live, upcoming and completed brackets</p>
                  <h1>Tournament control</h1>
                </span>
              </section>
              <TournamentCreator onCreated={loadTournaments} run={run} />
              {editingTournament && (
                <TournamentEditor
                  tournament={editingTournament}
                  onClose={() => setEditingTournament(null)}
                  onSaved={async () => {
                    setEditingTournament(null);
                    await loadTournaments();
                  }}
                  run={run}
                />
              )}
              <section className="admin-card-list">
                {tournaments.map((item) => (
                  <article key={item.id}>
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.status}
                        {item.isRecurring ? " · recurring" : ""}
                        {item.isShowcase ? " · showcase" : ""} ·{" "}
                        {item.playerCount} players · {shortDate(item.startsAt)}
                      </small>
                    </span>
                    <strong>{money(item.prizePool)}</strong>
                    <div className="admin-card-list__actions">
                      {(item.status === "waiting" ||
                        item.status === "upcoming") && (
                        <button
                          onClick={() => setEditingTournament(item)}
                        >
                          <Pencil size={14} /> Edit
                        </button>
                      )}
                      <button
                        className="danger"
                        onClick={() =>
                          void run(async () => {
                            await apiRequest(
                              `/api/tournaments/admin/${item.id}`,
                              { method: "DELETE" },
                            );
                            setMessage(
                              "Tournament deleted and refunds processed.",
                            );
                            await loadTournaments();
                          })
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            </>
          )}

          {tab === "support" && can("support") && (
            <>
              <section className="admin-title-row">
                <span>
                  <p>Assign, reply and resolve player requests</p>
                  <h1>Support tickets</h1>
                </span>
                <select
                  value={supportStatus}
                  onChange={(event) =>
                    setSupportStatus(
                      event.target.value as typeof supportStatus,
                    )
                  }
                >
                  <option value="all">All tickets</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="resolved">Resolved</option>
                </select>
              </section>
              <section className="admin-ticket-grid">
                {tickets.length === 0 && <Empty text="No support tickets." />}
                {tickets.map((row) => (
                  <article className="admin-panel" key={row.ticket.id}>
                    <header>
                      <span>
                        <small>
                          #{row.user.gameId} · {row.ticket.status}
                        </small>
                        <h2>{row.ticket.subject}</h2>
                      </span>
                      <span className="admin-status">{row.user.name}</span>
                    </header>
                    <p>{row.ticket.message}</p>
                    {row.ticket.adminReply && (
                      <blockquote>{row.ticket.adminReply}</blockquote>
                    )}
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        void run(async () => {
                          const reply = fieldValue(event, "reply").trim();
                          const assignedTo = fieldValue(event, "assignedTo");
                          await apiRequest(
                            `/api/admin/support/${row.ticket.id}`,
                            {
                              method: "PATCH",
                              body: JSON.stringify({
                                status: fieldValue(event, "status"),
                                assignedTo: assignedTo || null,
                                ...(reply ? { reply } : {}),
                              }),
                            },
                          );
                          setMessage("Ticket updated.");
                          form.reset();
                          await loadSupport();
                        });
                      }}
                    >
                      <textarea
                        name="reply"
                        placeholder="Write a helpful reply..."
                      />
                      <select name="status" defaultValue="in_progress">
                        <option value="open">Open</option>
                        <option value="in_progress">In progress</option>
                        <option value="resolved">Resolved</option>
                      </select>
                      <select
                        name="assignedTo"
                        defaultValue={row.ticket.assignedTo || user!.id}
                      >
                        <option value="">Unassigned</option>
                        <option value={user!.id}>Assign to me</option>
                        {mainAdmin &&
                          subAdmins
                            .filter((member) =>
                              member.permissions.includes("support"),
                            )
                            .map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} (@{member.username})
                              </option>
                            ))}
                      </select>
                      <button>Reply and update</button>
                    </form>
                  </article>
                ))}
              </section>
            </>
          )}

          {tab === "settings" && mainAdmin && (
            <>
              <section className="admin-title-row">
                <span>
                  <p>Branding, game, security, providers and legal content</p>
                  <h1>Platform settings</h1>
                </span>
              </section>
              <PaymentGatewayAdminSection />
              <TradeJitoAdminSection />
              <SettingsEditor
                values={settingsValues}
                setValues={setSettingsValues}
                run={run}
                onSaved={loadSettings}
              />
            </>
          )}

          {tab === "team" && mainAdmin && (
            <>
              <section className="admin-title-row">
                <span>
                  <p>Scoped access without settings or report privileges</p>
                  <h1>Sub-admin team</h1>
                </span>
              </section>
              <SubAdminCreator onCreated={loadTeam} run={run} />
              <section className="admin-card-list">
                {subAdmins.map((member) => (
                  <article key={member.id}>
                    <span>
                      <strong>{member.name}</strong>
                      <small>
                        @{member.username} · {member.permissions.join(", ") || "No modules"}
                      </small>
                    </span>
                    <small>{shortDate(member.lastLoginAt)}</small>
                    <button
                      className="danger"
                      onClick={() =>
                        void run(async () => {
                          await apiRequest(
                            `/api/admin/subadmins/${member.id}`,
                            { method: "DELETE" },
                          );
                          setMessage("Sub-admin access archived.");
                          await loadTeam();
                        })
                      }
                    >
                      Revoke
                    </button>
                  </article>
                ))}
              </section>
            </>
          )}
        </div>
      </section>

      {selectedUser && (
        <UserControlDrawer
          detail={selectedUser}
          row={users.find((item) => item.id === selectedUser.user.id)}
          busy={busy}
          onClose={() => setSelectedUser(null)}
          onBalance={updateBalance}
          onBan={toggleBan}
          run={run}
          reload={() => openUser(selectedUser.user.id)}
        />
      )}
    </main>
  );
}

function StatCard(props: {
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <article>
      <small>{props.label}</small>
      <strong>{props.value}</strong>
      <span>{props.note}</span>
    </article>
  );
}

function RevenueBars({ values }: { values: Record<string, string> }) {
  const entries = [
    ["Tournament fees", values.tournamentFees ?? "0"],
    ["Transfer commission", values.transferCommissions ?? "0"],
    ["Prizes paid", values.prizePaid ?? "0"],
    ["Referral paid", values.referralPaid ?? "0"],
    ["Withdrawals paid", values.withdrawalsPaid ?? "0"],
  ] as const;
  const maximum = Math.max(...entries.map(([, value]) => Number(value)), 1);
  return (
    <div className="admin-bars">
      {entries.map(([label, value]) => (
        <div key={label}>
          <span>
            <small>{label}</small>
            <strong>{money(value)}</strong>
          </span>
          <i style={{ width: `${(Number(value) / maximum) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

function FinancialChart({ points }: { points: FinancialPoint[] }) {
  const visible = points.slice(-12);
  const maximum = Math.max(
    ...visible.flatMap((point) => [
      Number(point.deposits),
      Number(point.withdrawals),
    ]),
    1,
  );
  return (
    <div className="admin-chart">
      {visible.length === 0 && <Empty text="No financial activity yet." />}
      {visible.map((point) => (
        <div key={point.bucket}>
          <span>
            <i
              className="deposit"
              style={{ height: `${(Number(point.deposits) / maximum) * 100}%` }}
            />
            <i
              className="withdraw"
              style={{
                height: `${(Number(point.withdrawals) / maximum) * 100}%`,
              }}
            />
          </span>
          <small>
            {new Date(point.bucket).toLocaleDateString("en-BD", {
              month: "short",
              day: "numeric",
            })}
          </small>
        </div>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="admin-empty">{text}</p>;
}

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function TournamentEditor(props: {
  tournament: TournamentRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
  run: AdminRun;
}) {
  const [form, setForm] = useState({
    title: props.tournament.title,
    playerCount: String(props.tournament.playerCount),
    boardType: props.tournament.boardType,
    gameMode: props.tournament.gameMode,
    type: props.tournament.type,
    joinFee: props.tournament.joinFee,
    prizePool: props.tournament.prizePool,
    adminCommission: props.tournament.adminCommission,
    prizeFirst: props.tournament.prizeFirst,
    prizeSecond: props.tournament.prizeSecond,
    playerType: props.tournament.playerType,
    countdownDuration: String(props.tournament.countdownDuration),
    betweenRoundSeconds: String(props.tournament.betweenRoundSeconds),
    status:
      props.tournament.status === "upcoming" ? "upcoming" : ("waiting" as const),
    startsAt: toLocalInput(props.tournament.startsAt),
  });

  return (
    <form
      className="admin-inline-form admin-tournament-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void props.run(async () => {
          await apiRequest(`/api/tournaments/admin/${props.tournament.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              title: form.title,
              playerCount: Number(form.playerCount),
              boardType: form.boardType,
              gameMode: form.gameMode,
              type: form.type,
              joinFee: form.type === "free" ? 0 : Number(form.joinFee),
              prizePool: Number(form.prizePool),
              adminCommission: Number(form.adminCommission),
              prizeFirst: Number(form.prizeFirst),
              prizeSecond: Number(form.prizeSecond),
              playerType: form.playerType,
              countdownDuration: Number(form.countdownDuration),
              betweenRoundSeconds: Number(form.betweenRoundSeconds),
              status: form.status,
              startsAt:
                form.status === "upcoming" && form.startsAt
                  ? new Date(form.startsAt).toISOString()
                  : null,
            }),
          });
          await props.onSaved();
        }, "Tournament updated.");
      }}
    >
      <header className="admin-title-row compact">
        <span>
          <p>Edit tournament</p>
          <h2>{props.tournament.title}</h2>
        </span>
        <button type="button" onClick={props.onClose}>
          <X size={14} />
        </button>
      </header>
      <input
        value={form.title}
        onChange={(event) =>
          setForm((current) => ({ ...current, title: event.target.value }))
        }
        required
        minLength={3}
      />
      <select
        value={form.playerCount}
        onChange={(event) =>
          setForm((current) => ({ ...current, playerCount: event.target.value }))
        }
      >
        {[2, 4, 8, 16, 32, 64].map((count) => (
          <option key={count} value={count}>
            {count} players
          </option>
        ))}
      </select>
      <select
        value={form.boardType}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            boardType: event.target.value as TournamentRow["boardType"],
          }))
        }
      >
        <option value="2p">2 Player board</option>
        <option value="4p">4 Player board</option>
      </select>
      <select
        value={form.gameMode}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            gameMode: event.target.value as TournamentRow["gameMode"],
          }))
        }
      >
        <option value="classic">Classic</option>
        <option value="quick">Quick</option>
        <option value="master">Master</option>
      </select>
      <select
        value={form.type}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            type: event.target.value as TournamentRow["type"],
          }))
        }
      >
        <option value="paid">Paid</option>
        <option value="free">Free</option>
      </select>
      <input
        type="number"
        min="0"
        step="0.01"
        value={form.type === "free" ? "0" : form.joinFee}
        disabled={form.type === "free"}
        onChange={(event) =>
          setForm((current) => ({ ...current, joinFee: event.target.value }))
        }
      />
      <input
        type="number"
        min="0"
        step="0.01"
        value={form.prizePool}
        onChange={(event) =>
          setForm((current) => ({ ...current, prizePool: event.target.value }))
        }
        required
      />
      <input
        type="number"
        min="0"
        max="100"
        value={form.adminCommission}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            adminCommission: event.target.value,
          }))
        }
      />
      <input
        type="number"
        min="0"
        max="100"
        value={form.prizeFirst}
        onChange={(event) =>
          setForm((current) => ({ ...current, prizeFirst: event.target.value }))
        }
      />
      <input
        type="number"
        min="0"
        max="100"
        value={form.prizeSecond}
        onChange={(event) =>
          setForm((current) => ({ ...current, prizeSecond: event.target.value }))
        }
      />
      <select
        value={form.playerType}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            playerType: event.target.value as TournamentRow["playerType"],
          }))
        }
      >
        <option value="real">Real</option>
        <option value="mixed">Mixed</option>
        <option value="bot">Bot</option>
      </select>
      <input
        type="number"
        min="10"
        max="86400"
        value={form.countdownDuration}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            countdownDuration: event.target.value,
          }))
        }
      />
      <input
        type="number"
        min="30"
        max="60"
        value={form.betweenRoundSeconds}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            betweenRoundSeconds: event.target.value,
          }))
        }
      />
      <select
        value={form.status}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            status: event.target.value as "waiting" | "upcoming",
          }))
        }
      >
        <option value="waiting">Waiting</option>
        <option value="upcoming">Upcoming</option>
      </select>
      {form.status === "upcoming" && (
        <input
          type="datetime-local"
          value={form.startsAt}
          onChange={(event) =>
            setForm((current) => ({ ...current, startsAt: event.target.value }))
          }
          required
        />
      )}
      <button type="submit">Save changes</button>
    </form>
  );
}

function TournamentCreator(props: {
  onCreated: () => Promise<void>;
  run: AdminRun;
}) {
  return (
    <form
      className="admin-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        void props.run(async () => {
          const playerCount = Number(fieldValue(event, "playerCount"));
          const status = fieldValue(event, "status");
          const startsAt = fieldValue(event, "startsAt");
          await apiRequest("/api/tournaments/admin", {
            method: "POST",
            body: JSON.stringify({
              title: fieldValue(event, "title"),
              playerCount,
              boardType: fieldValue(event, "boardType"),
              gameMode: fieldValue(event, "gameMode"),
              type: Number(fieldValue(event, "joinFee")) > 0 ? "paid" : "free",
              joinFee: Number(fieldValue(event, "joinFee")),
              prizePool: Number(fieldValue(event, "prizePool")),
              adminCommission: 10,
              prizeFirst: 70,
              prizeSecond: 30,
              playerType: fieldValue(event, "playerType"),
              countdownDuration: Number(fieldValue(event, "countdownDuration")),
              betweenRoundSeconds: 60,
              status,
              startsAt:
                status === "upcoming" && startsAt
                  ? new Date(startsAt).toISOString()
                  : null,
            }),
          });
          form.reset();
          await props.onCreated();
        }, "Tournament created successfully.");
      }}
    >
      <input name="title" placeholder="Tournament title" required minLength={3} />
      <select name="playerCount" defaultValue="4">
        {[2, 4, 8, 16, 32, 64].map((count) => (
          <option key={count} value={count}>{count} players</option>
        ))}
      </select>
      <select name="boardType" defaultValue="4p">
        <option value="2p">2 players per board</option>
        <option value="4p">4 players per board</option>
      </select>
      <select name="gameMode" defaultValue="classic">
        <option value="classic">Classic</option>
        <option value="quick">Quick</option>
        <option value="master">Master</option>
      </select>
      <select name="playerType" defaultValue="real">
        <option value="real">Real players</option>
        <option value="mixed">Mixed</option>
        <option value="bot">Bots</option>
      </select>
      <select name="status" defaultValue="waiting">
        <option value="waiting">Start countdown now</option>
        <option value="upcoming">Schedule for later</option>
      </select>
      <select name="countdownDuration" defaultValue="60">
        <option value="15">15 second countdown</option>
        <option value="30">30 second countdown</option>
        <option value="60">1 minute countdown</option>
        <option value="120">2 minute countdown</option>
        <option value="300">5 minute countdown</option>
        <option value="600">10 minute countdown</option>
      </select>
      <input
        name="startsAt"
        type="datetime-local"
        aria-label="Scheduled start time"
      />
      <input name="joinFee" type="number" min="0" placeholder="Join fee" required />
      <input name="prizePool" type="number" min="0" placeholder="Prize pool" required />
      <button>Create tournament</button>
    </form>
  );
}

function ThemePresetCard({
  preset,
  active,
  onSelect,
}: {
  preset: ThemePresetColors;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`admin-theme-preset ${active ? "is-active" : ""}`}
      onClick={onSelect}
      aria-pressed={active}
      style={
        {
          "--preset-primary": preset.primaryColor,
          "--preset-secondary": preset.secondaryColor,
          "--preset-accent": preset.accentColor,
          "--preset-bg": preset.backgroundColor,
          "--preset-card": preset.cardColor,
        } as CSSProperties
      }
    >
      <span className="admin-theme-preset__swatch" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <strong>{preset.label}</strong>
      <small>{preset.labelBn}</small>
      {active && <em>Active</em>}
    </button>
  );
}

function AdminGameToggle(props: {
  label: string;
  hint: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="admin-game-toggle">
      <div className="admin-game-toggle__copy">
        <strong>{props.label}</strong>
        <small>{props.hint}</small>
      </div>
      <div className={`game-auto-switch ${props.enabled ? "is-on" : ""}`}>
        <button
          type="button"
          className={!props.enabled ? "active" : ""}
          onClick={() => props.onChange(false)}
        >
          Off
        </button>
        <button
          type="button"
          className={props.enabled ? "active" : ""}
          onClick={() => props.onChange(true)}
        >
          On
        </button>
      </div>
    </div>
  );
}

function SettingsEditor(props: {
  values: Record<string, string>;
  setValues: (values: Record<string, string>) => void;
  run: AdminRun;
  onSaved: () => Promise<void>;
}) {
  const [notificationHistory, setNotificationHistory] = useState<
    NotificationHistoryRow[]
  >([]);
  const loadNotificationHistory = useCallback(async () => {
    const result = await apiRequest<{ history: NotificationHistoryRow[] }>(
      "/api/admin/notifications/history?limit=25",
    );
    setNotificationHistory(result.history);
  }, []);
  useEffect(() => {
    void loadNotificationHistory().catch(() => undefined);
  }, [loadNotificationHistory]);

  const groups = [
    {
      title: "Brand and social",
      keys: [
        "site.name",
        "site.logo_url",
        "site.primary_color",
        "site.secondary_color",
        "site.button_color",
        "site.card_color",
        "site.background_color",
        "site.accent_color",
        "social.telegram_url",
        "social.whatsapp_url",
        "social.facebook_url",
      ],
    },
    {
      title: "Game and tournament",
      keys: [
        "game.dice_speed",
        "game.token_speed",
        "game.voice_enabled",
        "game.voice_provider",
        "game.voice_daily_domain",
        "game.voice_daily_api_key",
        "tournament.default_admin_commission",
        "tournament.recurring_full_countdown_seconds",
      ],
    },
    {
      title: "Security and API",
      keys: [
        "security.max_accounts_per_ip",
        "security.max_accounts_per_device",
        "security.auto_ban_threshold",
        "api.google_client_id",
        "api.google_client_secret",
        "api.google_callback_url",
        "api.other_keys",
      ],
    },
    {
      title: "Legal",
      keys: ["legal.terms_text", "legal.privacy_text"],
    },
  ];

  const comingSoonGames = [
    {
      key: "home.game_carrom_visible",
      label: "Carrom",
      hint: "Show Carrom card on home page",
    },
    {
      key: "home.game_hockey_visible",
      label: "Ice Hockey",
      hint: "Show Ice Hockey card on home page",
    },
    {
      key: "home.game_pool_visible",
      label: "Pool",
      hint: "Show Pool card on home page",
    },
  ] as const;

  const patchSetting = (patch: Record<string, string>, message: string) => {
    props.setValues({ ...props.values, ...patch });
    void props.run(async () => {
      await apiRequest("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ values: patch }),
      });
      await props.onSaved();
    }, message);
  };

  return (
    <>
      <section className="admin-settings-grid">
        <article className="admin-panel admin-coming-soon-games">
          <header>
            <h2>Coming soon games</h2>
            <p>Home page এ Carrom, Ice Hockey, Pool card দেখান বা লুকান</p>
          </header>
          <div className="admin-game-toggle-list">
            {comingSoonGames.map((game) => {
              const enabled = props.values[game.key] !== "false";
              return (
                <AdminGameToggle
                  key={game.key}
                  label={game.label}
                  hint={game.hint}
                  enabled={enabled}
                  onChange={(next) =>
                    patchSetting(
                      { [game.key]: next ? "true" : "false" },
                      `${game.label} ${next ? "shown" : "hidden"} on home page.`,
                    )
                  }
                />
              );
            })}
          </div>
        </article>
        <article className="admin-panel admin-theme-panel">
          <header>
            <h2>Site color theme</h2>
            <p>এক ক্লিকে পুরো সাইটের রঙ পরিবর্তন করুন — ৭টি প্রিসেট থিম</p>
          </header>
          <div className="admin-theme-presets">
            {THEME_PRESETS.map((preset) => (
              <ThemePresetCard
                key={preset.id}
                preset={preset}
                active={props.values["site.theme_preset"] === preset.id}
                onSelect={() => {
                  const themePatch = presetToSettingValues(preset);
                  const next = {
                    ...props.values,
                    ...themePatch,
                  };
                  props.setValues(next);
                  void props.run(async () => {
                    await apiRequest("/api/admin/settings", {
                      method: "PATCH",
                      body: JSON.stringify({ values: themePatch }),
                    });
                    await props.onSaved();
                  }, `${preset.label} theme applied site-wide.`);
                }}
              />
            ))}
          </div>
        </article>
        {groups.map((group) => (
          <article className="admin-panel" key={group.title}>
            <header><h2>{group.title}</h2></header>
            {group.keys.map((key) => {
              const label = key.replaceAll(".", " ").replaceAll("_", " ");
              if (key === "site.logo_url") {
                return (
                  <div className="admin-logo-setting" key={key}>
                    <span>{label}</span>
                    <img
                      src={props.values[key] || "/prizejito-logo.png"}
                      alt="Current site logo"
                    />
                    <label className="admin-logo-upload">
                      Upload new logo
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={(event) => {
                          const input = event.currentTarget;
                          const file = input.files?.[0];
                          if (!file) return;
                          void props.run(async () => {
                            const result = await apiUpload<{ logoUrl: string }>(
                              "/api/admin/settings/logo",
                              file,
                            );
                            props.setValues({
                              ...props.values,
                              [key]: result.logoUrl,
                            });
                            await props.onSaved();
                            input.value = "";
                          }, "Site logo uploaded successfully.");
                        }}
                      />
                    </label>
                  </div>
                );
              }
              return (
                <label key={key}>
                  {label}
                  {key.startsWith("legal.") ? (
                  <RichTextEditor
                    value={props.values[key] || ""}
                    onChange={(value) =>
                      props.setValues({
                        ...props.values,
                        [key]: value,
                      })
                    }
                  />
                ) : key === "api.other_keys" ? (
                  <textarea
                    value={props.values[key] || ""}
                    onChange={(event) =>
                      props.setValues({
                        ...props.values,
                        [key]: event.target.value,
                      })
                    }
                  />
                ) : key.endsWith("_color") ? (
                  <span className="admin-color-setting">
                    <input
                      type="color"
                      value={props.values[key] || "#22c55e"}
                      onChange={(event) =>
                        props.setValues({
                          ...props.values,
                          [key]: event.target.value,
                        })
                      }
                    />
                    <input
                      value={props.values[key] || "#22c55e"}
                      onChange={(event) =>
                        props.setValues({
                          ...props.values,
                          [key]: event.target.value,
                        })
                      }
                    />
                  </span>
                ) : key === "tournament.recurring_full_countdown_seconds" ? (
                  <input
                    type="number"
                    min="10"
                    max="86400"
                    step="1"
                    value={props.values[key] || "300"}
                    onChange={(event) =>
                      props.setValues({
                        ...props.values,
                        [key]: event.target.value,
                      })
                    }
                  />
                ) : (
                  <input
                    value={props.values[key] || ""}
                    onChange={(event) =>
                      props.setValues({
                        ...props.values,
                        [key]: event.target.value,
                      })
                    }
                  />
                )}
                </label>
              );
            })}
          </article>
        ))}
      </section>
      <section className="admin-grid-two">
        <form
          className="admin-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void props.run(async () => {
              await apiRequest("/api/admin/settings", {
                method: "PATCH",
                body: JSON.stringify({ values: props.values }),
              });
              await props.onSaved();
            }, "Platform settings saved successfully.");
          }}
        >
          <header><h2>Save platform settings</h2></header>
          <p>Secret values stay masked. Google OAuth credentials reload immediately after save.</p>
          <button className="admin-primary">Save audited settings</button>
        </form>
        <form
          className="admin-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void props.run(async () => {
              await apiRequest("/api/admin/notifications", {
                method: "POST",
                body: JSON.stringify({
                  title: fieldValue(event, "title"),
                  message: fieldValue(event, "message"),
                  ...(fieldValue(event, "userId")
                    ? { userId: fieldValue(event, "userId") }
                    : {}),
                }),
              });
              event.currentTarget.reset();
              await loadNotificationHistory();
            }, "Notification sent successfully.");
          }}
        >
          <header><h2>Send notification</h2></header>
          <input name="title" placeholder="Notice title" required />
          <textarea name="message" placeholder="Message" required />
          <input
            name="userId"
            placeholder="Optional Game ID or UUID; blank sends to all"
          />
          <button className="admin-primary">Send real-time notice</button>
        </form>
      </section>
      <section className="admin-panel notification-history">
        <header>
          <h2>Notification history</h2>
          <small>Audited sends from the admin panel</small>
        </header>
        {notificationHistory.length === 0 && (
          <Empty text="No admin notifications sent yet." />
        )}
        {notificationHistory.map((item) => (
          <article key={item.id}>
            <span>
              <strong>{item.details.title || "Notification"}</strong>
              <small>
                {item.actor.name} · {shortDate(item.createdAt)}
              </small>
            </span>
            <p>{item.details.message || "Legacy history entry"}</p>
            <b>
              {item.targetId
                ? "1 player"
                : `${item.details.delivered ?? 0} players`}
            </b>
          </article>
        ))}
      </section>
    </>
  );
}

function RichTextEditor(props: {
  value: string;
  onChange: (value: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== props.value) {
      editor.current.innerHTML = props.value;
    }
  }, [props.value]);

  const command = (name: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(name, false, value);
    props.onChange(editor.current?.innerHTML || "");
  };

  return (
    <div className="admin-rich-editor">
      <div className="admin-rich-toolbar">
        <button type="button" onClick={() => command("bold")}>B</button>
        <button type="button" onClick={() => command("italic")}><i>I</i></button>
        <button type="button" onClick={() => command("underline")}><u>U</u></button>
        <button type="button" onClick={() => command("formatBlock", "h2")}>H2</button>
        <button type="button" onClick={() => command("insertUnorderedList")}>List</button>
        <button type="button" onClick={() => command("formatBlock", "p")}>P</button>
      </div>
      <div
        ref={editor}
        className="admin-rich-content"
        contentEditable
        suppressContentEditableWarning
        onInput={(event) => props.onChange(event.currentTarget.innerHTML)}
      />
    </div>
  );
}

function SubAdminCreator(props: {
  onCreated: () => Promise<void>;
  run: AdminRun;
}) {
  return (
    <form
      className="admin-panel admin-team-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        void props.run(async () => {
          await apiRequest("/api/admin/subadmins", {
            method: "POST",
            body: JSON.stringify({
              name: String(data.get("name")),
              username: String(data.get("username")),
              password: String(data.get("password")),
              permissions: data.getAll("permissions"),
            }),
          });
          form.reset();
          await props.onCreated();
        }, "Sub-admin created successfully.");
      }}
    >
      <input name="name" placeholder="Full name" required />
      <input name="username" placeholder="Username" required />
      <input name="password" type="password" placeholder="Strong password" required />
      <fieldset>
        <legend>Module permissions</legend>
        {["users", "financial", "tournaments", "support"].map((permission) => (
          <label key={permission}>
            <input type="checkbox" name="permissions" value={permission} />
            {permission}
          </label>
        ))}
      </fieldset>
      <button className="admin-primary">Create sub-admin</button>
    </form>
  );
}

function UserControlDrawer(props: {
  detail: UserDetail;
  row?: AdminUserRow | undefined;
  busy: boolean;
  onClose: () => void;
  onBalance: (
    event: FormEvent<HTMLFormElement>,
    balance: "main" | "winner",
  ) => void;
  onBan: (row: AdminUserRow) => Promise<void>;
  run: AdminRun;
  reload: () => Promise<void>;
}) {
  const { detail, row } = props;
  return (
    <div className="admin-drawer-backdrop" onMouseDown={props.onClose}>
      <aside className="admin-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span className="admin-person">
            <img
              src={resolvedAvatar(detail.user.avatar, detail.user.gameId)}
              alt=""
            />
            <i>
              <strong>{detail.user.name}</strong>
              <small>Game ID #{detail.user.gameId}</small>
            </i>
          </span>
          <button onClick={props.onClose}><X size={18} /></button>
        </header>
        <section className="admin-drawer-balances">
          <StatCard label="Main balance" value={money(detail.user.mainBalance)} note="Spendable" />
          <StatCard label="Winner balance" value={money(detail.user.winnerBalance)} note="Withdrawable" />
        </section>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const phone = fieldValue(event, "phone");
            void props.run(async () => {
              await apiRequest(`/api/profile/admin/${detail.user.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  name: fieldValue(event, "name"),
                  email: fieldValue(event, "email"),
                  ...(phone ? { phone } : {}),
                }),
              });
              await props.reload();
            }, "Player profile updated successfully.");
          }}
        >
          <strong>Edit profile (Game ID stays immutable)</strong>
          <input name="name" defaultValue={detail.user.name} required />
          <input name="phone" defaultValue={detail.user.phone || ""} placeholder="Phone" />
          <input name="email" defaultValue={detail.user.email || ""} placeholder="Email" />
          <button>Save profile</button>
        </form>
        {(["main", "winner"] as const).map((balance) => (
          <form key={balance} onSubmit={(event) => props.onBalance(event, balance)}>
            <strong>Adjust {balance} balance</strong>
            <select name="operation">
              <option value="add">Add</option>
              <option value="subtract">Subtract</option>
            </select>
            <input name="amount" type="number" min="0.01" step="0.01" placeholder="Amount" required />
            <input name="reason" placeholder="Audit reason" required minLength={3} />
            <button disabled={props.busy}>Apply</button>
          </form>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void props.run(async () => {
              await apiRequest(
                `/api/admin/users/${detail.user.id}/password`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    password: fieldValue(event, "password"),
                  }),
                },
              );
              form.reset();
            }, "Password reset and active sessions revoked.");
          }}
        >
          <strong>Verified password recovery</strong>
          <small>
            Verify account ownership first. Resetting revokes every active
            session and writes an audit log.
          </small>
          <input
            name="password"
            type="password"
            minLength={8}
            maxLength={72}
            placeholder="New password"
            required
          />
          <button disabled={props.busy}>Reset password</button>
        </form>
        <section className="admin-security-box">
          <h3>Security controls</h3>
          <small>IP: {detail.security.ipAddress || "Not recorded"}</small>
          <small>Device: {detail.security.deviceId || "Not recorded"}</small>
          <div>
            {row && (
              <button className="danger" onClick={() => void props.onBan(row)}>
                {row.isBanned ? "Unban user" : "Ban user"}
              </button>
            )}
            <button
              onClick={() =>
                void props.run(async () => {
                  await apiRequest(
                    `/api/admin/users/${detail.user.id}/force-logout`,
                    { method: "POST" },
                  );
                }, "Player logged out from all active sessions.")
              }
            >
              Force logout
            </button>
            {detail.security.ipAddress && (
              <button
                className="danger"
                onClick={() =>
                  void props.run(async () => {
                    await apiRequest(
                      `/api/admin/users/${detail.user.id}/endpoint-ban`,
                      {
                        method: "POST",
                        body: JSON.stringify({
                          kind: "ip",
                          value: detail.security.ipAddress,
                          reason: "Admin IP ban",
                        }),
                      },
                    );
                    props.onClose();
                  }, "IP address banned successfully.")
                }
              >
                Ban IP
              </button>
            )}
            {detail.security.deviceId && (
              <button
                className="danger"
                onClick={() =>
                  void props.run(async () => {
                    await apiRequest(
                      `/api/admin/users/${detail.user.id}/endpoint-ban`,
                      {
                        method: "POST",
                        body: JSON.stringify({
                          kind: "device",
                          value: detail.security.deviceId,
                          reason: "Admin device ban",
                        }),
                      },
                    );
                    props.onClose();
                  }, "Device banned successfully.")
                }
              >
                Ban device
              </button>
            )}
          </div>
        </section>
        <section className="admin-history">
          <h3>Recent transactions</h3>
          {detail.transactions.slice(0, 15).map((item) => (
            <div key={item.id}>
              <span><strong>{item.type}</strong><small>{shortDate(item.createdAt)}</small></span>
              <span><strong>{money(item.amount)}</strong><small>{item.status}</small></span>
            </div>
          ))}
          {detail.transactions.length === 0 && <Empty text="No transactions." />}
        </section>
        <section className="admin-history">
          <h3>Recent tournaments</h3>
          {detail.tournaments.slice(0, 10).map((item) => (
            <div key={item.id}>
              <span>
                <strong>{item.title}</strong>
                <small>{shortDate(item.joinedAt)}</small>
              </span>
              <span>
                <strong>{item.status}</strong>
              </span>
            </div>
          ))}
          {detail.tournaments.length === 0 && <Empty text="No tournaments." />}
        </section>
      </aside>
    </div>
  );
}
