# Phase 2 Verification

Phase 2 implements the master prompt Home Page against PostgreSQL and
Socket.io. No tournament, winner, slot, notification, or setting is hardcoded
as a real production record.

## Implemented

- Single-screen mobile Home dashboard with animated forest background
- Guest/user header, Bengali/English toggle, unread notification count
- Real prize transactions plus disclosed promotional winner marquee
- Admin-configurable marquee content, speed, generation interval, logo,
  site name, maximum win amount, social links, and legal content
- Mixed real/promotional top-five leaderboard
- Live tournament cards with mode, type, fee, prize, slots, server-based timer
- Upcoming tournament pre-registration with idempotent notification delivery
- Terms and Privacy routes sourced from the settings table
- Native `beforeinstallprompt` PWA install flow and permanent device dismissal
- Socket updates for winners, settings, tournament slots, and notifications
- Authenticated Socket.io user rooms for private events
- Transactional settings update plus admin audit log

Promotional records are database-persisted and carry a visible `Promo` label.
The database enforces that promotional-win records remain disclosed.

## Evidence

- `npm.cmd run typecheck`: passed
- `npm.cmd test`: 8 active unit/UI tests passed; DB suites skipped by default
- `npm.cmd run build`: API and installable PWA production builds passed
- `npm.cmd run db:generate`: no schema drift after migrations
- `home.integration.test.ts`: real PostgreSQL Home feed, slot count,
  pre-registration idempotency, notifications, settings, audit, and URL
  validation passed
- `socket.integration.test.ts`: authenticated private-room delivery and guest
  isolation passed
- `npm.cmd audit --omit=dev`: zero production vulnerabilities
- `npm.cmd run qa:visual`: passed at `390x844` and `360x640`

The visual checker proves body/dashboard zero overflow and verifies that four
tournament cards and five leaderboard cards render in each viewport. It writes
local screenshots under `artifacts/visual/`.
