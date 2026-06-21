# PrizeJito.com Master Checklist

Source of truth: `KHAN_LUDO_MASTER_PROMPT.txt` supplied by the project owner.

Status legend: `[ ]` pending, `[~]` in progress, `[x]` implemented and verified.

## Global Invariants

- [x] React + Vite mobile-first PWA foundation
- [x] Node.js + Express API foundation
- [x] PostgreSQL + Drizzle ORM foundation
- [x] Socket.io real-time transport foundation
- [x] Bengali default with English toggle foundation
- [x] Shared nature forest premium design system
- [x] Zero-reload real-time updates throughout
- [x] Server-authoritative game logic and anti-cheat validation
- [x] No fake persistence or mocked production integrations
- [x] Admin settings take effect without redeployment

## Phase 1: Setup, Database, Auth

- [x] Monorepo, environment validation, Docker PostgreSQL
- [x] All master database tables
- [x] Supporting session, support, ban, and audit tables
- [x] Direct phone/name/password registration without OTP
- [x] No-OTP recovery request plus verified admin password reset
- [x] Google OAuth 2.0
- [x] Authenticated database-backed guest player and protected-action login prompt
- [x] JWT in secure HTTP-only cookie with revocable server session
- [x] Login IP and device fingerprint capture
- [x] One-time transaction-safe first admin claim
- [x] IP and device ban enforcement
- [x] Global and auth-specific rate limits
- [x] Parameterized Drizzle queries and input sanitization
- [x] Production HTTPS enforcement and security headers
- [x] Admin audit logging foundation
- [x] Cryptographic fair dice utility
- [x] Token move validation and reconnect-abuse foundations
- [x] Auth/profile UI with logout and admin claim
- [x] Automated tests and build verification

External acceptance still requires owner-supplied Google OAuth and payment
provider credentials. Google login remains disabled until configured.

## Phase 2: Home

- [x] Full-screen home, top bar, language, unread notifications
- [x] Real/promotional configurable winner marquee
- [x] Hero, live leaderboard, live/upcoming tournaments
- [x] Admin-configured social links and database legal content
- [x] PWA install prompt behavior
- [x] Socket.io live updates and authenticated private rooms

Promotional winners are persisted and visibly labelled `Promo`; they are never
presented as verified real-player wins. Phase 2 verification evidence is in
[`PHASE_2_VERIFICATION.md`](PHASE_2_VERIFICATION.md).

## Phase 3: Profile and Stats

- [x] Editable name/email, eight-avatar selection, and custom image upload
- [x] Authenticated direct phone changes and immutable Game ID
- [x] Admin profile editing with audit log and Game ID protection
- [x] Profile balances, social links, admin claim, logout
- [x] Player stats, real-user rank, win rate, streak, earnings, best finish
- [x] Tournament/deposit/withdraw/refer/transfer history
- [x] Private realtime profile updates
- [x] Database integration, responsive visual QA, and production build

Phase 3 verification evidence is in
[`PHASE_3_VERIFICATION.md`](PHASE_3_VERIFICATION.md).

## Phase 4: Wallet

- [x] Separate Main and Winner balance rules
- [x] Uddokta Pay checkout, verification, webhook idempotency
- [x] Manual deposit proof upload and audited admin approval
- [x] Six default offers plus admin CRUD, activation, limits, and bonus credit
- [x] KYC and NID collection intentionally omitted
- [x] Winner-only withdrawal reserve, approve, reject/refund, and paid states
- [x] Main-only atomic transfer with commission and receiver confirmation
- [x] Referral commission on successful auto/manual deposits
- [x] Realtime balance, transaction, and notification updates
- [x] Unified type/date-filtered transaction timeline
- [x] No-scroll user and admin Wallet UI with private document preview
- [x] Database concurrency tests, provider contract tests, visual QA, and build

Phase 4 verification evidence is in
[`PHASE_4_VERIFICATION.md`](PHASE_4_VERIFICATION.md).

## Phase 5: Tournaments

- [x] Tournament creation, filters, join/pre-register
- [x] Paid join choice from Main or Winner balance with same-source refunds
- [x] Continuous 3-5 bot-only showcase tournaments with size rotation
- [x] Countdown/reset/start rules
- [x] 2/4/8/16/32/64-player bracket engine
- [x] Between-round waiting and spectator flow
- [x] Prize distribution and commission accounting

Phase 5 verification evidence is in
[`PHASE_5_VERIFICATION.md`](PHASE_5_VERIFICATION.md).

## Phase 6: Ludo Game

- [x] Pixel-accurate 2-player and 4-player boards
- [x] Classic, Quick, and Master server-side rules
- [x] Dice, movement, kill, safe-cell, home, misses
- [x] Sound, 24-emoji picker, persisted chat, and Jitsi voice integration
- [x] Spectating, reconnect, anti-abuse, leave penalty

Phase 6 verification evidence is in
[`PHASE_6_VERIFICATION.md`](PHASE_6_VERIFICATION.md).

## Phase 7: Real-Time Engine

- [x] All tournament event groups
- [x] All game event groups
- [x] Lobby/waiting event groups
- [x] Global admin, balance, notification events
- [x] Graceful reconnect and state recovery

Phase 7 verification evidence is in
[`PHASE_7_VERIFICATION.md`](PHASE_7_VERIFICATION.md).

## Phase 8: Bots and Leaderboard

- [x] Human-timed configurable bot engine
- [x] Bot CRUD, tournament fill, global/per-bot rates
- [x] Real and promotional leaderboard feeds
- [x] Daily/weekly/monthly/all-time leaderboard

Phase 8 verification evidence is in
[`PHASE_8_VERIFICATION.md`](PHASE_8_VERIFICATION.md).

## Phase 9: Admin

- [x] Dashboard, reports, charts, CSV exports
- [x] User, balance, ban, force-logout controls
- [x] Tournament and live-match controls
- [x] Deposit/withdraw management
- [x] Bot, notice, branding, social, game/API settings
- [x] Maintenance and legal content
- [x] Sub-admin role permissions
- [x] Support ticket workflow
- [x] Player support center plus admin filter, assignment, reply, and status

KYC status and review controls are intentionally omitted. Phase 9 verification
evidence is in [`PHASE_9_VERIFICATION.md`](PHASE_9_VERIFICATION.md).

## Phase 10: PWA and Final QA

- [x] Installable Android/iOS PWA and offline page
- [x] Complete real-time notification center
- [x] Referral commission workflow
- [x] Final filters/upcoming tournaments
- [x] Security and edge-case test matrix
- [x] Performance, accessibility, responsive, and release QA

All OTP and KYC workflows are intentionally omitted. Password recovery uses a
support request and audited admin reset. Phase 10 verification evidence is in
[`PHASE_10_VERIFICATION.md`](PHASE_10_VERIFICATION.md).

## Remaining External Integration

- [ ] Additional keyed voice provider beyond the current keyless Jitsi rooms
