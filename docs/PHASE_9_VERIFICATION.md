# Phase 9 Verification

Phase 9 adds a separate responsive administration application at `/admin`.
KYC collection, KYC status, KYC review, and KYC approval controls are
intentionally omitted.

## Implemented

- Separate admin login using main-admin phone or sub-admin username
- Live dashboard for deposits, withdrawals, monthly deposits, connected
  sockets, active tournaments, users, revenue, prizes, and commissions
- Daily, weekly, and monthly finance charts
- User, transaction, and tournament CSV exports
- User search by name, phone, or immutable Game ID
- User profile, transaction, tournament, session, IP, and device history
- Audited Main/Winner balance add and subtract controls with row locking
- User ban/unban, IP/device ban, and immediate force logout
- Existing tournament CRUD, match results, deposit, withdrawal, and bot
  controls protected by scoped server permissions
- Support ticket creation, filtering, assignment, reply, status, and
  real-time user notification
- Targeted or all-user notifications
- Branding, social, game, tournament, security, provider, maintenance, and
  legal settings
- Encrypted secret settings with masked reads
- Google OAuth Passport strategy hot reload after settings changes
- Runtime account-creation limits per IP and device
- Main-admin-only settings, reports, audit logs, and sub-admin management
- Sub-admin permissions for users, finance, tournaments, and support
- Archived sub-admin access with immediate session revocation
- Responsive desktop sidebar and mobile drawer layouts

## Security Boundaries

- Main admins bypass module scopes.
- Sub-admins require an explicit module permission on every protected API.
- Sub-admins cannot access reports, site settings, API secrets, audit logs,
  notifications, or sub-admin management.
- Balance changes cannot create a negative balance and always create both a
  transaction record and an admin audit record.
- Bans and password/access changes revoke active database sessions.
- API secrets are AES-256-GCM encrypted at rest and never returned in clear
  text after saving.
- Rate limits remain enabled outside `NODE_ENV=test`.

## Evidence

- Migration `0011_messy_black_tarantula.sql` adds unique sub-admin usernames
  and JSON permission scopes
- API and web TypeScript checks passed
- Default API tests passed: 28 active tests
- Default web UI test passed
- `admin.integration.test.ts` passed against real PostgreSQL
- Integration coverage verifies scoped access, main-admin-only settings and
  reports, audited balance adjustment, support assignment/reply, and user
  notification
- Production Express and Vite PWA builds passed
- Visual QA passed all existing states plus six Phase 9 states
- Admin overview, users, and settings passed at `1280x800` and `390x844`
  with zero body, page, workspace, or content overflow
