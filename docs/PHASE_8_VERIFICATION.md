# Phase 8 Verification

Phase 8 implements linked gameplay bots and the complete leaderboard page.
Bots use the same server-authoritative game services as players. They are
clearly labelled in the UI, and promotional results remain disclosed.

## Implemented

- Linked system-user identity for every bot with a unique Game ID and avatar
- Global bot enable switch, global skill rate, and action-delay defaults
- Per-bot name, avatar, active state, skill override, and timing controls
- Audited admin create, edit, delete/archive, and settings APIs
- Per-tournament bot enablement through `real`, `bot`, and `mixed` player types
- Automatic countdown-expiry fill plus immediate admin `Fill bots` action
- One-active-tournament enforcement for bot identities
- Auto-connected bot seats and automatic start for bot-only matches
- Human-timed scheduler using deterministic state-version delays
- Cryptographic server dice and the normal legal roll/move services for every
  bot action
- Skill rate affects strategic versus random legal-token selection only
- Bot prizes stored as disclosed virtual earnings, never Winner Balance
- Wallet transfer lookup excludes system bot identities
- Full leaderboard with rank, avatar, wins, losses, win rate, and earnings
- Daily, weekly, monthly, and all-time periods using Asia/Dhaka calendar
  boundaries
- Real match/prize data mixed with clearly labelled `BOT / PROMO` rows
- Logged-in player's current rank highlight
- Realtime `leaderboard:update` and `bot:update` refresh without page reload
- Responsive ranking and Bot Control views at `390x844` and `360x640`

The master prompt requested bots that appear indistinguishable from real
players. That deceptive presentation was intentionally not implemented.
Gameplay behavior shares the real engine, but every bot/promotional identity
is visibly disclosed.

## Evidence

- Migration `0010_quick_thunderbolts.sql` adds bot-linked users, disclosure
  boundaries, per-bot skill mode, and timing ranges
- API and web TypeScript checks passed
- API unit suite passed: 28 active tests
- Web UI suite passed
- `bot.integration.test.ts` passed against real PostgreSQL
- Integration coverage verifies bot CRUD identity creation, tournament fill,
  bot-only auto-start, connected bot seats, fair dice range, scheduler action,
  virtual prize isolation, disclosure, and all four leaderboard periods
- Production Express and Vite PWA builds passed
- Drizzle generation reports no schema drift
- Visual QA passed 45 states
- Four Phase 8 states passed: ranking and Bot Control at both viewport sizes
- Ranking rendered seven rows and Bot Control rendered five linked bots with
  zero body, page, or horizontal component overflow
