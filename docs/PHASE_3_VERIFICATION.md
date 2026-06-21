# Phase 3 Verification

Phase 3 implements the Profile, Stats, and Activity requirements against
PostgreSQL. Stats and histories are calculated from real match, tournament,
user, and transaction records.

## Implemented

- Profile overview with balances, immutable/copyable Game ID, social links,
  admin claim, and logout
- Editable name and optional email
- Eight selectable forest avatars plus custom PNG/JPEG/WebP upload
- Authenticated direct phone-number changes with uniqueness checks
- Player support center with ticket status and admin replies
- Admin profile editing except Game ID, with atomic audit logging
- Private Socket.io `profile:update` delivery
- Total games, wins, losses, circular win rate, prize earnings, real-user rank,
  highest win streak, and best tournament finish
- Tournament history with mode, fee, result, prize, finish, and date
- Deposit history with amount, bonus, method, status, and date
- Withdrawal history with amount, method, status, and date
- Referral history with referred player, deposits, commission, date, and totals
- Transfer history with direction, amount, commission, counterpart, ID, status,
  and date
- Three-item client pagination for compact no-scroll mobile activity views

## Evidence

- `npm.cmd run typecheck`: API and web passed
- `npm.cmd test`: 8 active unit/UI tests passed; DB suites skipped by default
- `npm.cmd run build`: Express API and Vite PWA production builds passed
- `npm.cmd run db:generate`: no schema drift after migration `0005`
- `npm.cmd audit --omit=dev`: zero production dependency vulnerabilities
- `profile.integration.test.ts`: PostgreSQL-backed profile edit, immutable Game
  ID, stats, all five history groups, direct phone change, realtime emit, admin
  edit, and audit verification passed
- Existing Home, Socket.io private-room, and first-admin PostgreSQL integration
  suites passed after the Phase 3 migration
- `npm.cmd run qa:visual`: Home plus Profile, Edit, Stats, and Activity passed at
  `390x844` and `360x640`

The visual checker verifies body, dashboard, panel, and edit-form zero overflow,
all eight avatars, three paginated history rows, and writes screenshots under
`artifacts/visual/`. Temporary QA users, sessions, tournaments, matches, and
transactions are deleted after each run.
