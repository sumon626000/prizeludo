# PrizeJito.com

Production-oriented, mobile-first real-time Ludo tournament platform for the
Bangladesh market. The implementation follows the supplied 10-phase master
prompt. Requirements and progress are tracked in
[`docs/MASTER_CHECKLIST.md`](docs/MASTER_CHECKLIST.md).

## Current Status

Phases 1 through 10 are implemented:

- React 19 + Vite PWA client with Bengali default and English toggle
- Express 5 + Socket.io API
- PostgreSQL 17 + Drizzle ORM schema and migrations
- Direct phone/password registration without OTP
- Database-backed guest accounts with authenticated player sessions
- No-OTP password recovery requests with verified, audited admin reset
- Google OAuth 2.0
- Revocable JWT sessions in secure HTTP-only cookies
- IP/device capture and ban enforcement
- Transaction-safe one-time first-admin claim with audit logging
- Rate limiting, security headers, production HTTPS, validation, sanitization
- Cryptographic server dice and anti-cheat/reconnect foundations
- Animated forest app shell and protected-action login modal
- Database-backed Home feed, disclosed winner marquee, and mixed leaderboard
- Live/upcoming tournament cards, slot counts, timers, and pre-registration
- Admin-configurable branding, marquee, social links, and legal content
- Android/iOS PWA install guidance, dynamic app branding, and offline screen
- Complete realtime notification center with unread and read controls
- Authenticated private Socket.io rooms for user notifications
- Editable profile with eight avatars, custom image upload, and direct
  authenticated phone changes
- Player-facing support center with ticket status and admin replies
- Database-derived player stats, real-user rank, streak, and best finish
- Tournament, deposit, withdraw, referral, and transfer activity histories
- Realtime profile updates and audited admin profile editing
- Dual-balance Wallet with atomic deposits, withdrawals, and transfers
- Uddokta Pay verification plus private manual payment-proof workflow
- Configurable bonus offers, commissions, and filtered history
- Realtime balance updates and compact admin Wallet controls
- Admin tournament CRUD with every pre-start setting editable
- Guest tournament browsing with type, board, mode, and status filters
- Paid/free join using the combined available Main + Winner balance, pre-registration,
  one-active-tournament enforcement, and same-wallet fee refunds
- Full-slot countdown clamping, incomplete-slot reset, and automatic starts
- Realtime 2/4/8/16/32/64-player bracket generation for 2-player and
  4-player boards
- Match connection deadlines, no-show resolution, between-round waiting,
  spectator rooms, and admin result controls
- Automatic 70/30 Winner Balance prizes, tournament commission accounting,
  notifications, and winner celebration
- Full-screen 15x15 Ludo room for diagonal 2-player and 4-player matches
- Authoritative Classic, Quick, and Master engines with cryptographic dice,
  legal-move validation, captures, safe cells, home paths, and missed turns
- Live sound, 24 gameplay emojis, persisted chat, optional Jitsi voice, and
  spectators
- 60-second reconnect recovery, disconnect abuse loss, leave penalties, and
  no-prize forfeits
- Admin-controlled dice speed, token speed, and voice availability
- No KYC or OTP requirement anywhere in the tournament join/play flow
- Typed Socket.io envelopes for system, tournament, lobby, wallet,
  notification, notice, maintenance, and theme events
- Private user rooms, tournament subscriptions, match spectator rooms, and
  acknowledgement-based socket commands
- Two-minute Socket.io connection-state recovery plus authoritative HTTP and
  socket resynchronization snapshots
- Zero-reload tournament brackets, game turns, balances, notifications,
  notices, themes, and maintenance state
- Linked system bot identities that use the same tournament brackets,
  server dice, legal-move validation, and match progression as players
- Human-timed bot roll/move scheduler with global skill, per-bot override,
  active state, avatar, and action-delay controls
- Automatic and manual bot filling for bot/mixed waiting tournaments
- Admin-controlled 3-5 continuous bot-only showcase tournaments with
  4/8/16/32/64-player rotation and natural player names
- Bot-only matches that auto-ready without bypassing real-player deadlines
- Daily, weekly, monthly, and all-time mixed leaderboard with current-player
  highlighting and real match/prize statistics
- Clearly disclosed `BOT / PROMO` labels; bot prizes remain virtual and never
  enter withdrawable player wallets
- Separate responsive `/admin` application with scoped server authorization
- Live business dashboard, finance charts, and CSV exports
- User search, history, audited balance adjustment, bans, and force logout
- Tournament, finance, bot, notice, maintenance, and platform controls
- Encrypted and masked provider secrets with Google OAuth hot reload
- Main-admin-only settings/reports plus scoped sub-admin accounts
- Player support tickets with assignment, reply, status, and notifications
- Configurable per-IP and per-device account-creation limits
- No KYC collection, status, review, or approval workflow
- Referral invite page with code/link sharing, player history, deposit totals,
  and all-time commission
- Separate upcoming tournament section with composable live filters

Promotional Home activity required by the master prompt is persisted separately
and visibly labelled `Promo`.

## Prerequisites

- Node.js 22 or newer
- Docker Desktop or PostgreSQL 17
- Google OAuth credentials for Google login

## Local Setup

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
npm.cmd install
npm.cmd run db:migrate
npm.cmd run dev
```

The web app runs at `http://localhost:5173`; the API runs at
`http://localhost:4000`.

## Optional Integration Configuration

Registration, profile updates, tournament play, and account recovery do not
use OTP. A recovery request creates a support ticket; after ownership
verification, an authorized admin can set a new password. Every active session
is revoked and the reset is written to the admin audit log.

For Google OAuth, configure the callback URI as:

```text
http://localhost:4000/api/auth/google/callback
```

Then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`GOOGLE_CALLBACK_URL`.

## Commands

```powershell
npm.cmd run dev
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run qa:visual
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:studio
```

Run the real database concurrency test only against an empty dedicated
database:

```powershell
$env:RUN_DB_TESTS='1'
npm.cmd exec -w @khan-ludo/api -- vitest run src/services/auth.integration.test.ts
```

Run Phase 2 database and realtime integration tests with PostgreSQL running:

```powershell
$env:RUN_DB_TESTS='1'
npm.cmd exec -w @khan-ludo/api -- vitest run src/services/home.integration.test.ts
npm.cmd exec -w @khan-ludo/api -- vitest run src/socket.integration.test.ts
```

Run the Phase 3 profile integration test with PostgreSQL running:

```powershell
$env:RUN_DB_TESTS='1'
npm.cmd exec -w @khan-ludo/api -- vitest run src/services/profile.integration.test.ts
```

Run the Phase 4 financial integration test with PostgreSQL running:

```powershell
$env:RUN_DB_TESTS='1'
npm.cmd exec -w @khan-ludo/api -- vitest run src/services/wallet.integration.test.ts
```

Run the Phase 5 tournament lifecycle test with PostgreSQL running:

```powershell
$env:RUN_DB_TESTS='1'
npm.cmd exec -w @khan-ludo/api -- vitest run src/services/tournament.integration.test.ts
```

Run the Phase 6 game lifecycle test with PostgreSQL running:

```powershell
$env:RUN_DB_TESTS='1'
npm.cmd exec -w @khan-ludo/api -- vitest run src/services/game.integration.test.ts
```

Run the Phase 7 real-time recovery and event-contract test with PostgreSQL
running:

```powershell
$env:RUN_DB_TESTS='1'
npm.cmd exec -w @khan-ludo/api -- vitest run src/realtime.integration.test.ts
```

Run the Phase 8 bot and leaderboard integration test with PostgreSQL running:

```powershell
$env:RUN_DB_TESTS='1'
npm.cmd exec -w @khan-ludo/api -- vitest run src/services/bot.integration.test.ts
```

Run the Phase 9 admin integration test with PostgreSQL running:

```powershell
$env:RUN_DB_TESTS='1'
npm.cmd exec -w @khan-ludo/api -- vitest run src/services/admin.integration.test.ts
```

## Security Notes

- Production startup fails when `JWT_SECRET` is left at its development value.
  Google OAuth remains optional and is disabled until configured.
- Passwords use bcrypt with cost 12.
- JWTs are bound to revocable database sessions and stored only in HTTP-only
  cookies.
- Every authenticated request rechecks user, IP, and device bans.
- Drizzle parameterizes database queries.
- Admin claim uses a PostgreSQL advisory transaction lock, so concurrent claims
  cannot produce two admins.
- Promotional winner records have a database disclosure constraint and appear
  with a `Promo` label in the client.
- Home setting changes and their audit record commit in one transaction.
- Phone changes require an authenticated session and unique number; Game IDs
  cannot be changed through user or admin profile APIs.
- Password recovery requires support ownership verification; admin resets
  revoke all sessions and create an audit record.
- Wallet balance changes run in PostgreSQL transactions with row locks.
- Payment callbacks are provider-verified and idempotent; provider invoices
  cannot credit more than one transaction.
- Payment API keys and withdrawal account numbers are encrypted at rest.
- Wallet screenshots are private database documents, not public
  static files.
- Tournament fees, refunds, starts, advancement, and prizes are committed in
  PostgreSQL transactions with row locks; clients cannot alter balances or
  bracket results directly.
- Dice, turns, legal token choices, movement, captures, misses, reconnect
  penalties, and match placements are validated and persisted by the server.
- Socket rooms are authorized on the server; private balances and
  notifications are never broadcast to public rooms.
- Reconnecting clients receive recovered packets when possible and request a
  fresh authoritative snapshot when recovery is unavailable.
- Bot accounts cannot authenticate or receive wallet transfers. Their
  tournament prizes are recorded only as disclosed virtual leaderboard data.
- Bot skill changes move selection only; cryptographic server dice are never
  weighted or replaced.
- The production dependency audit is clean. `drizzle-kit` currently reports a
  dev-only transitive esbuild advisory in its retired loader dependency; it is
  not shipped in either production build.

## Repository Layout

```text
apps/api/   Express, Socket.io, Drizzle schema, migrations, tests
apps/web/   React, Vite, PWA shell, i18n, forest UI
docs/       Master implementation checklist
```
