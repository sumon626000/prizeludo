# Phase 4 Verification

Phase 4 implements the Wallet System against PostgreSQL with server-authoritative
balance mutations. No client response, payment redirect, screenshot, or webhook
can directly change a balance.

## Implemented

- Separate Main Balance and Winner Balance enforcement
- Uddokta Pay `checkout-v2` and `verify-payment` adapter using the official
  `RT-UDDOKTAPAY-API-KEY` header
- Verified webhook and return flows with unique provider invoices,
  amount/metadata validation, and double-credit protection
- Manual deposits with private PNG/JPEG/WebP proof storage and admin review
- Six initial bonus offers, exact server-side bonus calculation, admin CRUD,
  activation, ordering, and persistent one-time seeding
- Instant admin settings for provider URL/key, manual accounts, limits,
  transfer commission, and referral commission
- AES-256-GCM encryption for Uddokta API keys and withdrawal
  account numbers
- Private document access restricted to the owner or an admin
- Direct withdrawal requests without KYC or OTP gating
- Winner Balance reservation when a withdrawal is requested; rejection refunds
  exactly once, while approved-to-paid does not double-deduct
- Main Balance transfers with 5-digit receiver lookup, deterministic row locks,
  commission calculation, paired sender/receiver transactions, and notifications
- Automatic referral commission on every successful auto or manual deposit
- Unified deposit/withdraw/transfer/prize/refer/bonus history with type and date
  filters
- Socket.io `wallet:update`, `profile:update`, settings, and notification events
- Bengali/English no-scroll Wallet and admin controls

The adapter follows Uddokta Pay's official
[PHP library](https://github.com/uddoktapay/PHPLibrary) and
[merchant checkout permissions](https://uddoktapay.com/). A real merchant API
base URL and API key must be entered by an admin before auto deposits activate.
There is no fake gateway or successful-payment bypass.

## Evidence

- Migration `0007_steep_tyger_tiger.sql` removes KYC/NID storage
- `npm.cmd run db:generate`: no schema drift after migration `0007`
- `npm.cmd run typecheck`: API and web passed
- `npm.cmd test`: 11 active unit/UI tests passed; DB suites skipped by default
- `npm.cmd run build`: Express API and Vite PWA production builds passed
- `npm.cmd audit --omit=dev`: zero production dependency vulnerabilities
- `uddoktapay.service.test.ts`: official endpoint, API-key header, checkout
  metadata, verification normalization, and status handling passed
- `wallet.integration.test.ts`: real PostgreSQL manual deposit, offer bonus,
  referral credit, private proof, withdrawal reserve/refund,
  paid withdrawal, transfer commission, history secrecy, and concurrent
  double-spend prevention passed
- Existing Profile, Home, Socket.io private-room, and first-admin PostgreSQL
  suites passed after migration `0007`
- `npm.cmd run qa:visual`: 26 Home/Profile/Wallet/user/admin states passed at
  `390x844` and `360x640`

The visual checker validates body, dashboard, and active-panel zero overflow,
six deposit offers, receiver confirmation, three transaction rows, five admin
tabs, settings, and seven offer-editor buttons. Temporary QA financial data is
deleted after each run.
