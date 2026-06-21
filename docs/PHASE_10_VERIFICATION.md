# Phase 10 Verification

Phase 10 completes the installable client, notification center, referral
experience, tournament discovery polish, and release checks.

## Delivered

- Direct phone/password registration with immediate secure session creation
- Authenticated database-backed guest entry; registration OTP endpoints removed
- Android install prompt and iOS Safari Add to Home Screen guidance
- Standalone/install persistence, dynamic admin logo manifest identity, splash
  shell, precached app shell, and offline fallback screen
- Realtime notification drawer with timestamps, unread count, mark-one, and
  mark-all controls
- Referral code/link copy and share, referred-player list, deposits, per-player
  commission, and all-time commission
- Referral code shortcuts in Profile and Wallet
- Combined tournament type, board, mode, and status filters without reload
- Separate available and upcoming tournament sections with pre-registration
- Existing bans, maintenance, legal content, stats, and game-speed controls
- No-OTP password recovery request with ownership-verified admin reset

## Product Decisions

- KYC is not collected or required anywhere.
- No feature uses OTP.
- Password recovery uses support verification and an audited admin reset that
  revokes all active sessions.
- Bot and promotional identities remain visibly disclosed.

## Automated Evidence

- Workspace TypeScript typecheck
- Production API and PWA build
- Default API and web unit suites
- Phase 10 database integration: direct registration, referral linkage,
  removed OTP routes, duplicate prevention, notification list/read/read-all
- Existing database integration suites
- Responsive Playwright visual and console-error sweep
