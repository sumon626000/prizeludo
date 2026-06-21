# Phase 6 Verification

Phase 6 implements the real-time Ludo match room with PostgreSQL and the API
as the authority for dice, turns, legal moves, eliminations, placements, and
tournament completion. Playing a match has no KYC or OTP requirement.

## Implemented

- Responsive 15x15 low-3D board with green, yellow, red, and blue quadrants,
  central cross, safe stars, home lanes, and four tokens per player
- Diagonal two-player seats and all-seat four-player rendering
- Server-side Classic, Quick, and Master rules, including release values,
  safe cells, captures, home paths, and mode-specific timers
- Cryptographic server dice, at most two consecutive sixes, persisted rolls,
  server-calculated legal tokens, and server-validated movement
- Current-player glow, animated dice/tokens, captures, home/finish handling,
  three miss indicators, and automatic loss after three missed turns
- Two-player immediate winner resolution and four-player continuation with
  top-two placement support
- Sound effects for dice, movement, capture, home, and win with a persistent
  player sound toggle
- Persisted player-only chat and emoji messages with Socket.io live refresh
- Optional free Jitsi voice room controlled by an audited admin setting
- Read-only spectators, heartbeat state, 60-second reconnect recovery, and
  automatic no-prize loss after the fifth disconnect
- Leave penalties: immediate opponent win in two-player games and continued
  play for remaining four-player participants
- Audited admin controls for dice speed, token speed, and voice availability
- Background scheduler for turn deadlines and reconnect expiration

## Evidence

- Migration `0009_nice_micromax.sql` adds persisted game messages, misses,
  heartbeat timestamps, and reconnect deadlines
- API and web TypeScript checks passed
- API unit suite passed: 28 active tests, including five pure game-engine tests
- Web UI suite passed
- `game.integration.test.ts` passed against real PostgreSQL: room
  initialization, persisted chat, reconnect counting, fifth-disconnect loss,
  winner payout, and zero payout for the penalized player
- Production Express and Vite PWA builds passed
- Visual QA passed 38 states at `390x844` and `360x640`
- Six game states passed: board, emoji panel, and chat panel at both viewport
  sizes, with 225 cells, eight tokens, two diagonal players, square board
  geometry, and zero body/game overflow

Temporary visual fixtures, messages, and tournament records are deleted after
each QA run.
