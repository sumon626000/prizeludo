import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { chromium } from "playwright-core";
import pg from "pg";

const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://khan_ludo:khan_ludo@localhost:5432/khan_ludo";
const edgePath =
  process.env.BROWSER_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const webUrl = "http://localhost:5174";
const apiPort = "4010";
const apiUrl = `http://localhost:${apiPort}`;
const outputDirectory = path.join(root, "artifacts", "visual");
const children = [];
const fixtureIds = [];
const fixtureUserIds = [];

function start(command, args, environment = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  return child;
}

async function waitFor(url, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function seedVisualFixtures(pool) {
  const now = Date.now();
  const result = await pool.query(
    `insert into tournaments (
      title, player_count, board_type, game_mode, type, join_fee, prize_pool,
      status, countdown_ends_at, starts_at
    ) values
      ($1, 4, '4p', 'classic', 'paid', 50, 180, 'waiting', $2, null),
      ($3, 16, '2p', 'quick', 'paid', 100, 1400, 'waiting', $4, null),
      ($5, 8, '2p', 'master', 'free', 0, 500, 'waiting', $6, null),
      ($7, 32, '4p', 'classic', 'paid', 200, 5600, 'waiting', $8, null),
      ($9, 8, '2p', 'master', 'free', 0, 500, 'upcoming', null, $10)
    returning id`,
    [
      "QA Classic Green Cup",
      new Date(now + 8 * 60_000),
      "QA Quick Forest Cup",
      new Date(now + 14 * 60_000),
      "QA Master Leaf Cup",
      new Date(now + 18 * 60_000),
      "QA Grand Forest Cup",
      new Date(now + 22 * 60_000),
      "QA Upcoming Master Cup",
      new Date(now + 60 * 60_000),
    ],
  );
  fixtureIds.push(...result.rows.map((row) => row.id));

  const unique = randomInt(10_000_000, 99_999_999).toString();
  const gameIdBase = randomInt(10_000, 89_000);
  const phone = `+88017${unique}`;
  const password = "Visual1234";
  const passwordHash = await bcrypt.hash(password, 10);
  const usersResult = await pool.query(
    `insert into users (
      game_id, name, phone, email, password_hash, avatar, main_balance,
      winner_balance, refer_code, is_admin
    ) values
      ($1, 'Visual QA Player', $2, $3, $4, '/avatars/forest-03.svg', 1250, 780, $5, true),
      ($6, 'Visual Opponent', $7, null, null, '/avatars/forest-05.svg', 0, 0, $8, false)
    returning id, game_id`,
    [
      String(gameIdBase),
      phone,
      `visual-${unique}@example.com`,
      passwordHash,
      `VQ${unique}`.slice(0, 12),
      String(gameIdBase + 1),
      `+88018${unique}`,
      `VO${unique}`.slice(0, 12),
    ],
  );
  const player = usersResult.rows[0];
  const opponent = usersResult.rows[1];
  fixtureUserIds.push(player.id, opponent.id);
  const cornerPlayersResult = await pool.query(
    `insert into users (
      game_id, name, phone, avatar, refer_code
    ) values
      ($1, 'Visual Corner Three', $2, '/avatars/forest-06.svg', $3),
      ($4, 'Visual Corner Four', $5, '/avatars/forest-08.svg', $6)
    returning id, game_id`,
    [
      String(gameIdBase + 10),
      `+88016${unique}`,
      `VC3${unique}`.slice(0, 12),
      String(gameIdBase + 11),
      `+88015${unique}`,
      `VC4${unique}`.slice(0, 12),
    ],
  );
  const cornerThree = cornerPlayersResult.rows[0];
  const cornerFour = cornerPlayersResult.rows[1];
  fixtureUserIds.push(cornerThree.id, cornerFour.id);

  const referredResult = await pool.query(
    `insert into users (
      game_id, name, phone, avatar, refer_code, referred_by
    ) values ($1, 'Visual Referral', $2, '/avatars/forest-07.svg', $3, $4)
    returning id`,
    [
      String(gameIdBase + 2),
      `+88019${unique}`,
      `VR${unique}`.slice(0, 12),
      player.id,
    ],
  );
  const referred = referredResult.rows[0];
  fixtureUserIds.push(referred.id);

  const activeTournamentResult = await pool.query(
    `insert into tournaments (
      title, player_count, board_type, game_mode, type, join_fee, prize_pool,
      status, current_round, total_rounds, between_round_seconds, starts_at
    ) values (
      $1, 2, '2p', 'classic', 'paid', 75, 1200,
      'active', 1, 1, 60, $2
    ) returning id`,
    ["QA Current Championship", new Date(now - 60_000)],
  );
  const activeTournamentId = activeTournamentResult.rows[0].id;
  fixtureIds.push(activeTournamentId);
  await pool.query(
    `insert into tournament_entries (
      tournament_id, user_id, status, paid_amount, joined_at
    ) values
      ($1, $2, 'joined', 75, $4),
      ($1, $3, 'joined', 75, $4)`,
    [activeTournamentId, player.id, opponent.id, new Date(now - 120_000)],
  );
  const activeMatchResult = await pool.query(
    `insert into matches (
      tournament_id, round, player_1_id, player_2_id, status, started_at
    ) values ($1, 1, $2, $3, 'active', $4)
    returning id`,
    [activeTournamentId, player.id, opponent.id, new Date(now - 30_000)],
  );
  const activeMatchId = activeMatchResult.rows[0].id;
  await pool.query(
    `insert into match_players (
      match_id, user_id, seat, connected_at
    ) values
      ($1, $2, 1, $4),
      ($1, $3, 2, $4)`,
    [activeMatchId, player.id, opponent.id, new Date(now - 30_000)],
  );
  await pool.query(
    `insert into brackets (
      tournament_id, round, match_id, position, player_id, result
    ) values
      ($1, 1, $2, 1, $3, 'waiting'),
      ($1, 1, $2, 2, $4, 'waiting')`,
    [activeTournamentId, activeMatchId, player.id, opponent.id],
  );
  await pool.query(
    `insert into game_states (
      match_id, current_turn, board_state, token_positions
    ) values ($1, $3, $2::jsonb, $4::jsonb)`,
    [
      activeMatchId,
      JSON.stringify({
        schemaVersion: 1,
        phase: "active",
        boardType: "2p",
        gameMode: "classic",
        playerOrder: [player.id, opponent.id],
        turnStartedAt: new Date(now).toISOString(),
        turnDeadline: new Date(now + 10 * 60_000).toISOString(),
        turnSeconds: 20,
        roll: null,
        consecutiveSixes: 0,
        finishOrder: [],
        eliminatedOrder: [],
        eliminationReasons: {},
        captures: {
          [player.id]: 0,
          [opponent.id]: 0,
        },
        lastAction: {
          type: "start",
          userId: player.id,
          at: new Date(now).toISOString(),
        },
        placements: [],
      }),
      player.id,
      JSON.stringify({
        [player.id]: [-1, -1, -1, -1],
        [opponent.id]: [-1, -1, -1, -1],
      }),
    ],
  );

  const fourPlayerTournamentResult = await pool.query(
    `insert into tournaments (
      title, player_count, board_type, game_mode, type, join_fee, prize_pool,
      status, current_round, total_rounds, between_round_seconds, starts_at
    ) values (
      $1, 4, '4p', 'quick', 'free', 0, 800,
      'active', 1, 1, 60, $2
    ) returning id`,
    ["QA Four Corner Arena", new Date(now - 60_000)],
  );
  const fourPlayerTournamentId = fourPlayerTournamentResult.rows[0].id;
  fixtureIds.push(fourPlayerTournamentId);
  await pool.query(
    `insert into tournament_entries (
      tournament_id, user_id, status, paid_amount, joined_at
    ) values
      ($1, $2, 'joined', 0, $6),
      ($1, $3, 'joined', 0, $6),
      ($1, $4, 'joined', 0, $6),
      ($1, $5, 'joined', 0, $6)`,
    [
      fourPlayerTournamentId,
      player.id,
      opponent.id,
      cornerThree.id,
      cornerFour.id,
      new Date(now - 120_000),
    ],
  );
  const fourPlayerMatchResult = await pool.query(
    `insert into matches (
      tournament_id, round, player_1_id, player_2_id, player_3_id,
      player_4_id, status, started_at
    ) values ($1, 1, $2, $3, $4, $5, 'active', $6)
    returning id`,
    [
      fourPlayerTournamentId,
      player.id,
      opponent.id,
      cornerThree.id,
      cornerFour.id,
      new Date(now - 30_000),
    ],
  );
  const activeFourPlayerMatchId = fourPlayerMatchResult.rows[0].id;
  await pool.query(
    `insert into match_players (
      match_id, user_id, seat, connected_at
    ) values
      ($1, $2, 1, $6),
      ($1, $3, 2, $6),
      ($1, $4, 3, $6),
      ($1, $5, 4, $6)`,
    [
      activeFourPlayerMatchId,
      player.id,
      opponent.id,
      cornerThree.id,
      cornerFour.id,
      new Date(now - 30_000),
    ],
  );
  const fourPlayerOrder = [
    player.id,
    opponent.id,
    cornerThree.id,
    cornerFour.id,
  ];
  await pool.query(
    `insert into game_states (
      match_id, current_turn, board_state, token_positions
    ) values ($1, $3, $2::jsonb, $4::jsonb)`,
    [
      activeFourPlayerMatchId,
      JSON.stringify({
        schemaVersion: 1,
        phase: "active",
        boardType: "4p",
        gameMode: "quick",
        playerOrder: fourPlayerOrder,
        turnStartedAt: new Date(now).toISOString(),
        turnDeadline: new Date(now + 10 * 60_000).toISOString(),
        turnSeconds: 15,
        roll: null,
        consecutiveSixes: 0,
        finishOrder: [],
        eliminatedOrder: [],
        eliminationReasons: {},
        captures: Object.fromEntries(fourPlayerOrder.map((id) => [id, 0])),
        lastAction: {
          type: "start",
          userId: player.id,
          at: new Date(now).toISOString(),
        },
        placements: [],
      }),
      player.id,
      JSON.stringify(
        Object.fromEntries(
          fourPlayerOrder.map((id) => [id, [-1, -1, -1, -1]]),
        ),
      ),
    ],
  );

  const profileTournaments = await pool.query(
    `insert into tournaments (
      title, player_count, board_type, game_mode, type, join_fee, prize_pool,
      status, starts_at
    ) values
      ('Visual Masters Final', 4, '4p', 'master', 'paid', 50, 800, 'completed', $1),
      ('Visual Quick Cup', 2, '2p', 'quick', 'paid', 25, 200, 'completed', $2),
      ('Visual Classic Cup', 4, '4p', 'classic', 'free', 0, 300, 'completed', $3),
      ('Visual Forest Cup', 4, '4p', 'classic', 'paid', 75, 1000, 'completed', $4)
    returning id`,
    [
      new Date(now - 4 * 86_400_000),
      new Date(now - 3 * 86_400_000),
      new Date(now - 2 * 86_400_000),
      new Date(now - 86_400_000),
    ],
  );
  const profileTournamentIds = profileTournaments.rows.map((row) => row.id);
  fixtureIds.push(...profileTournamentIds);

  await pool.query(
    `insert into tournament_entries (
      tournament_id, user_id, status, finish_position, prize_earned
    ) values
      ($1, $5, 'eliminated', 2, 300),
      ($2, $5, 'eliminated', 1, 150),
      ($3, $5, 'eliminated', 3, 0),
      ($4, $5, 'eliminated', 1, 600)`,
    [...profileTournamentIds, player.id],
  );

  const matchesResult = await pool.query(
    `insert into matches (
      tournament_id, round, player_1_id, player_2_id, winner_id, status, ended_at
    ) values
      ($1, 1, $2, $3, $2, 'completed', $4),
      ($1, 2, $2, $3, $2, 'completed', $5),
      ($1, 3, $2, $3, $3, 'completed', $6),
      ($1, 4, $2, $3, $2, 'completed', $7)
    returning id`,
    [
      profileTournamentIds[0],
      player.id,
      opponent.id,
      new Date(now - 40_000),
      new Date(now - 30_000),
      new Date(now - 20_000),
      new Date(now - 10_000),
    ],
  );
  for (const match of matchesResult.rows) {
    await pool.query(
      `insert into match_players (match_id, user_id, seat)
       values ($1, $2, 1), ($1, $3, 2)`,
      [match.id, player.id, opponent.id],
    );
  }

  await pool.query(
    `insert into transactions (
      user_id, type, amount, status, reference, method, direction,
      related_user_id, related_tournament_id, bonus_amount, commission_amount
    ) values
      ($1, 'prize', 1050, 'success', $5, null, 'none', null, $4, 0, 0),
      ($1, 'deposit', 500, 'success', $6, 'bKash', 'none', null, null, 50, 0),
      ($1, 'withdraw', 120, 'approved', $7, 'Nagad', 'none', null, null, 0, 0),
      ($1, 'refer', 25, 'success', $8, null, 'incoming', $3, null, 0, 0),
      ($1, 'transfer', 100, 'success', $9, null, 'outgoing', $2, null, 0, 5),
      ($3, 'deposit', 200, 'paid', $10, 'Rocket', 'none', null, null, 0, 0)`,
    [
      player.id,
      opponent.id,
      referred.id,
      profileTournamentIds[0],
      `visual-prize-${unique}`,
      `visual-deposit-${unique}`,
      `visual-withdraw-${unique}`,
      `visual-refer-${unique}`,
      `visual-transfer-${unique}`,
      `visual-ref-deposit-${unique}`,
    ],
  );
  await pool.query(
    `insert into notifications (user_id, title, message) values
      ($1, 'Tournament ready', 'Your QA match is ready to play.'),
      ($1, 'Deposit approved', 'Your visual deposit was approved.'),
      ($1, 'Referral commission', 'You earned a referral commission.')`,
    [player.id],
  );

  return {
    phone,
    password,
    receiverGameId: opponent.game_id,
    activeMatchId,
    activeFourPlayerMatchId,
  };
}

async function inspectGuestAuth(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".identity--button").click();
  await page.locator(".auth-modal").waitFor();
  const loginLayout = await page.evaluate(() => {
    const modal = document.querySelector(".auth-modal");
    const google = document.querySelector(".google-button");
    const guest = document.querySelector(".guest-button");
    const rect = (element) => element?.getBoundingClientRect().toJSON() ?? null;
    return {
      brand: document.querySelector(".auth-modal__brand strong")?.textContent,
      modal: rect(modal),
      google: rect(google),
      guest: rect(guest),
    };
  });
  if (
    loginLayout.brand !== "PrizeJito.com" ||
    !loginLayout.modal ||
    !loginLayout.google ||
    !loginLayout.guest ||
    Math.abs(loginLayout.google.width - loginLayout.guest.width) > 1 ||
    Math.abs(loginLayout.google.height - loginLayout.guest.height) > 1 ||
    loginLayout.google.height < 44 ||
    loginLayout.guest.top - loginLayout.google.bottom < 6
  ) {
    throw new Error(
      `Auth provider button layout failed: ${JSON.stringify(loginLayout)}`,
    );
  }
  const guestScreenshotPath = path.join(
    outputDirectory,
    `auth-guest-login-${width}x${height}.png`,
  );
  await page.screenshot({ path: guestScreenshotPath, fullPage: false });
  await page.locator(".guest-button").click();
  await page.locator(".identity:not(.identity--button)").waitFor();
  const guestState = await page.evaluate(async (targetApiUrl) => {
    const response = await fetch(`${targetApiUrl}/api/auth/me`, {
      credentials: "include",
    });
    return response.json();
  }, apiUrl);
  if (
    !guestState.authenticated ||
    !guestState.guest ||
    !guestState.user?.isGuest
  ) {
    throw new Error(
      `Guest did not receive a real authenticated account: ${JSON.stringify(guestState)}`,
    );
  }
  fixtureUserIds.push(guestState.user.id);
  await page.evaluate(async (targetApiUrl) => {
    await fetch(`${targetApiUrl}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  }, apiUrl);
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".identity--button").click();
  await page.locator(".auth-modal").waitFor();
  await page.getByRole("button", { name: /রেজিস্টার|Register/i }).click();
  const layout = await page.evaluate(() => {
    const modal = document.querySelector(".auth-modal");
    return {
      body: {
        scrollWidth: document.body.scrollWidth,
        clientWidth: document.body.clientWidth,
      },
      modal: modal
        ? {
            scrollWidth: modal.scrollWidth,
            clientWidth: modal.clientWidth,
            scrollHeight: modal.scrollHeight,
            clientHeight: modal.clientHeight,
          }
        : null,
    };
  });
  if (
    !layout.modal ||
    layout.body.scrollWidth > layout.body.clientWidth ||
    layout.modal.scrollWidth > layout.modal.clientWidth
  ) {
    throw new Error(`Guest/register visual check failed: ${JSON.stringify(layout)}`);
  }
  const screenshotPath = path.join(
    outputDirectory,
    `auth-direct-register-${width}x${height}.png`,
  );
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await page.locator(".modal-close").click();
  return [
    {
      view: "auth-guest-login",
      screenshotPath: guestScreenshotPath,
      layout: loginLayout,
    },
    { view: "auth-direct-register", screenshotPath, layout },
  ];
}

async function inspectPhase10Viewport(page, width, height) {
  await page.setViewportSize({ width, height });
  const results = [];

  await page.goto(`${webUrl}/refer`, { waitUntil: "domcontentloaded" });
  await page.locator(".refer-page").waitFor();
  await page.locator(".refer-player").first().waitFor();
  const referLayout = await page.evaluate(() => {
    const pageElement = document.querySelector(".refer-page");
    return {
      body: {
        scrollWidth: document.body.scrollWidth,
        clientWidth: document.body.clientWidth,
        scrollHeight: document.body.scrollHeight,
        clientHeight: document.body.clientHeight,
      },
      page: pageElement
        ? {
            scrollWidth: pageElement.scrollWidth,
            clientWidth: pageElement.clientWidth,
            scrollHeight: pageElement.scrollHeight,
            clientHeight: pageElement.clientHeight,
          }
        : null,
      referredPlayers: document.querySelectorAll(".refer-player").length,
    };
  });
  if (
    !referLayout.page ||
    referLayout.body.scrollWidth > referLayout.body.clientWidth ||
    referLayout.body.scrollHeight > referLayout.body.clientHeight ||
    referLayout.page.scrollWidth > referLayout.page.clientWidth ||
    referLayout.page.scrollHeight > referLayout.page.clientHeight ||
    referLayout.referredPlayers < 1
  ) {
    throw new Error(
      `Refer overflow/content failure at ${width}x${height}: ${JSON.stringify(referLayout)}`,
    );
  }
  const referScreenshotPath = path.join(
    outputDirectory,
    `refer-${width}x${height}.png`,
  );
  await page.screenshot({ path: referScreenshotPath, fullPage: false });
  results.push({
    view: "refer",
    screenshotPath: referScreenshotPath,
    layout: referLayout,
  });

  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator('button[aria-label="Notifications"]').click();
  await page.locator(".notification-center").waitFor();
  await page.locator(".notification-item").nth(2).waitFor();
  const notificationLayout = await page.evaluate(() => {
    const panel = document.querySelector(".notification-center");
    return {
      panel: panel
        ? {
            scrollWidth: panel.scrollWidth,
            clientWidth: panel.clientWidth,
            scrollHeight: panel.scrollHeight,
            clientHeight: panel.clientHeight,
          }
        : null,
      notifications: document.querySelectorAll(".notification-item").length,
      unread: document.querySelectorAll(".notification-item.is-unread").length,
    };
  });
  if (
    !notificationLayout.panel ||
    notificationLayout.panel.scrollWidth >
      notificationLayout.panel.clientWidth ||
    notificationLayout.panel.scrollHeight >
      notificationLayout.panel.clientHeight ||
    notificationLayout.notifications < 3
  ) {
    throw new Error(
      `Notification center failure at ${width}x${height}: ${JSON.stringify(notificationLayout)}`,
    );
  }
  const notificationScreenshotPath = path.join(
    outputDirectory,
    `notifications-${width}x${height}.png`,
  );
  await page.screenshot({
    path: notificationScreenshotPath,
    fullPage: false,
  });
  results.push({
    view: "notifications",
    screenshotPath: notificationScreenshotPath,
    layout: notificationLayout,
  });
  await page.locator('button[aria-label="Close notifications"]').click();

  return results;
}

async function inspectViewport(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".home-dashboard").waitFor();
  await page.waitForTimeout(800);

  const layout = await page.evaluate(() => {
    const dashboard = document.querySelector(".home-dashboard");
    const surface = document.querySelector(".app-surface");
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      body: {
        scrollWidth: document.body.scrollWidth,
        scrollHeight: document.body.scrollHeight,
        clientWidth: document.body.clientWidth,
        clientHeight: document.body.clientHeight,
      },
      dashboard: dashboard
        ? {
            scrollWidth: dashboard.scrollWidth,
            scrollHeight: dashboard.scrollHeight,
            clientWidth: dashboard.clientWidth,
            clientHeight: dashboard.clientHeight,
          }
        : null,
      surfaceRect: surface?.getBoundingClientRect().toJSON() ?? null,
      tournamentCards: document.querySelectorAll(".tournament-card").length,
      leaderboardCards: document.querySelectorAll(".mini-player").length,
    };
  });

  if (
    layout.body.scrollWidth > layout.body.clientWidth ||
    layout.body.scrollHeight > layout.body.clientHeight ||
    !layout.dashboard ||
    layout.dashboard.scrollWidth > layout.dashboard.clientWidth ||
    layout.dashboard.scrollHeight > layout.dashboard.clientHeight
  ) {
    throw new Error(`Viewport overflow at ${width}x${height}: ${JSON.stringify(layout)}`);
  }
  if (layout.tournamentCards < 4 || layout.leaderboardCards < 5) {
    throw new Error(`Required Home cards did not render: ${JSON.stringify(layout)}`);
  }

  const screenshotPath = path.join(outputDirectory, `home-${width}x${height}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return { screenshotPath, layout };
}

async function loginVisualUser(page, credentials) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".identity--button").click();
  await page.locator('input[name="phone"]').fill(credentials.phone);
  await page.locator('input[name="password"]').fill(credentials.password);
  await page.locator(".auth-form .primary-button").click();
  await page.locator(".identity:not(.identity--button)").waitFor();
  await page.locator(".identity__profile").click();
  await page.locator(".profile-dashboard").waitFor();
}

async function inspectAdminViewport(page, width, height, credentials) {
  await page.setViewportSize({ width, height });
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  const login = await page.evaluate(
    async ({ apiUrl: targetApiUrl, phone, password }) => {
      const response = await fetch(`${targetApiUrl}/api/admin/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: phone, password }),
      });
      return { status: response.status, text: await response.text() };
    },
    { apiUrl, phone: credentials.phone, password: credentials.password },
  );
  if (login.status !== 200) {
    throw new Error(`Admin visual login failed: ${JSON.stringify(login)}`);
  }
  await page.goto(`${webUrl}/admin`, { waitUntil: "domcontentloaded" });
  await page.locator(".admin-page").waitFor();
  await page.locator(".admin-stat-grid").waitFor();
  await page.waitForTimeout(500);

  const results = [];
  const capture = async (view) => {
    const layout = await page.evaluate(() => {
      const adminPage = document.querySelector(".admin-page");
      const workspace = document.querySelector(".admin-workspace");
      const content = document.querySelector(".admin-content");
      return {
        body: {
          scrollWidth: document.body.scrollWidth,
          clientWidth: document.body.clientWidth,
          scrollHeight: document.body.scrollHeight,
          clientHeight: document.body.clientHeight,
        },
        adminPage: adminPage
          ? {
              scrollWidth: adminPage.scrollWidth,
              clientWidth: adminPage.clientWidth,
              scrollHeight: adminPage.scrollHeight,
              clientHeight: adminPage.clientHeight,
            }
          : null,
        workspace: workspace
          ? {
              scrollWidth: workspace.scrollWidth,
              clientWidth: workspace.clientWidth,
            }
          : null,
        content: content
          ? {
              scrollWidth: content.scrollWidth,
              clientWidth: content.clientWidth,
            }
          : null,
      };
    });
    if (
      layout.body.scrollWidth > layout.body.clientWidth ||
      !layout.adminPage ||
      layout.adminPage.scrollWidth > layout.adminPage.clientWidth ||
      !layout.workspace ||
      layout.workspace.scrollWidth > layout.workspace.clientWidth ||
      !layout.content ||
      layout.content.scrollWidth > layout.content.clientWidth
    ) {
      throw new Error(
        `Admin overflow in ${view} at ${width}x${height}: ${JSON.stringify(layout)}`,
      );
    }
    const screenshotPath = path.join(
      outputDirectory,
      `admin-${view}-${width}x${height}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    results.push({ view: `admin-${view}`, screenshotPath, layout });
  };

  const openNavigation = async () => {
    if (width <= 720) {
      await page.locator(".admin-menu-button").click();
      await page.locator(".admin-sidebar.is-open").waitFor();
    }
  };

  await capture("overview");
  await openNavigation();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.locator(".admin-table-card").waitFor();
  await page.waitForTimeout(250);
  await capture("users");
  await openNavigation();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".admin-settings-grid").waitFor();
  await page.waitForTimeout(250);
  await capture("settings");
  return results;
}

async function inspectProfileViewport(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(`${webUrl}/profile`, { waitUntil: "domcontentloaded" });
  await page.locator(".profile-dashboard").waitFor();
  await page.locator(".profile-view-tabs button").first().click();
  await page.waitForTimeout(500);

  const views = ["profile", "stats", "activity", "support"];
  const results = [];
  for (let index = 0; index < views.length; index += 1) {
    if (index > 0) {
      await page.locator(".profile-view-tabs button").nth(index).click();
      await page.waitForTimeout(350);
    }

    const layout = await page.evaluate(() => {
      const dashboard = document.querySelector(".profile-dashboard");
      const activePanel = dashboard?.querySelector("section");
      return {
        body: {
          scrollWidth: document.body.scrollWidth,
          scrollHeight: document.body.scrollHeight,
          clientWidth: document.body.clientWidth,
          clientHeight: document.body.clientHeight,
        },
        dashboard: dashboard
          ? {
              scrollWidth: dashboard.scrollWidth,
              scrollHeight: dashboard.scrollHeight,
              clientWidth: dashboard.clientWidth,
              clientHeight: dashboard.clientHeight,
            }
          : null,
        activePanel: activePanel
          ? {
              scrollWidth: activePanel.scrollWidth,
              scrollHeight: activePanel.scrollHeight,
              clientWidth: activePanel.clientWidth,
              clientHeight: activePanel.clientHeight,
            }
          : null,
        historyItems: document.querySelectorAll(".history-item").length,
      };
    });

    if (
      layout.body.scrollWidth > layout.body.clientWidth ||
      layout.body.scrollHeight > layout.body.clientHeight ||
      !layout.dashboard ||
      layout.dashboard.scrollWidth > layout.dashboard.clientWidth ||
      layout.dashboard.scrollHeight > layout.dashboard.clientHeight ||
      !layout.activePanel ||
      layout.activePanel.scrollWidth > layout.activePanel.clientWidth ||
      layout.activePanel.scrollHeight > layout.activePanel.clientHeight
    ) {
      throw new Error(
        `Profile overflow in ${views[index]} at ${width}x${height}: ${JSON.stringify(layout)}`,
      );
    }
    if (views[index] === "activity" && layout.historyItems !== 3) {
      throw new Error(
        `Profile history pagination did not render three rows: ${JSON.stringify(layout)}`,
      );
    }

    const screenshotPath = path.join(
      outputDirectory,
      `profile-${views[index]}-${width}x${height}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    results.push({ view: views[index], screenshotPath, layout });

    if (views[index] === "profile") {
      await page.locator(".profile-edit-button").click();
      await page.locator(".profile-edit-form").waitFor();
      const editLayout = await page.evaluate(() => {
        const form = document.querySelector(".profile-edit-form");
        return form
          ? {
              scrollWidth: form.scrollWidth,
              scrollHeight: form.scrollHeight,
              clientWidth: form.clientWidth,
              clientHeight: form.clientHeight,
              avatarCount: form.querySelectorAll(".avatar-picker button").length,
            }
          : null;
      });
      if (
        !editLayout ||
        editLayout.scrollWidth > editLayout.clientWidth ||
        editLayout.scrollHeight > editLayout.clientHeight ||
        editLayout.avatarCount !== 8
      ) {
        throw new Error(
          `Profile edit overflow at ${width}x${height}: ${JSON.stringify(editLayout)}`,
        );
      }
      const editScreenshotPath = path.join(
        outputDirectory,
        `profile-edit-${width}x${height}.png`,
      );
      await page.screenshot({ path: editScreenshotPath, fullPage: false });
      results.push({
        view: "profile-edit",
        screenshotPath: editScreenshotPath,
        layout: editLayout,
      });
      await page.locator(".profile-edit-title button").click();
    }
  }
  return results;
}

async function inspectWalletViewport(page, width, height, credentials) {
  await page.setViewportSize({ width, height });
  if (!(await page.locator(".wallet-page").count())) {
    await page.locator('.bottom-nav a[href="/wallet"]').click();
  }
  await page.locator(".wallet-page").waitFor();
  await page.locator(".wallet-tabs button").first().click();
  await page.waitForTimeout(400);

  const views = [
    "overview",
    "deposit",
    "withdraw",
    "transfer",
    "history",
    "admin",
  ];
  const results = [];
  for (let index = 0; index < views.length; index += 1) {
    if (index > 0) {
      await page.locator(".wallet-tabs button").nth(index).click();
      if (views[index] === "transfer") {
        await page
          .locator(".wallet-search-input input")
          .fill(credentials.receiverGameId);
        await page.locator(".wallet-receiver.found").waitFor();
      }
      if (views[index] === "history") {
        await page.locator(".wallet-history-item").first().waitFor();
      }
      await page.waitForTimeout(300);
    }

    const layout = await page.evaluate(() => {
      const dashboard = document.querySelector(".wallet-page");
      const activePanel = dashboard?.querySelector(".wallet-panel");
      return {
        body: {
          scrollWidth: document.body.scrollWidth,
          scrollHeight: document.body.scrollHeight,
          clientWidth: document.body.clientWidth,
          clientHeight: document.body.clientHeight,
        },
        dashboard: dashboard
          ? {
              scrollWidth: dashboard.scrollWidth,
              scrollHeight: dashboard.scrollHeight,
              clientWidth: dashboard.clientWidth,
              clientHeight: dashboard.clientHeight,
            }
          : null,
        activePanel: activePanel
          ? {
              scrollWidth: activePanel.scrollWidth,
              scrollHeight: activePanel.scrollHeight,
              clientWidth: activePanel.clientWidth,
              clientHeight: activePanel.clientHeight,
            }
          : null,
        offers: document.querySelectorAll(".deposit-offer-grid button").length,
        historyItems: document.querySelectorAll(".wallet-history-item").length,
      };
    });
    if (
      layout.body.scrollWidth > layout.body.clientWidth ||
      layout.body.scrollHeight > layout.body.clientHeight ||
      !layout.dashboard ||
      layout.dashboard.scrollWidth > layout.dashboard.clientWidth ||
      layout.dashboard.scrollHeight > layout.dashboard.clientHeight ||
      !layout.activePanel ||
      layout.activePanel.scrollWidth > layout.activePanel.clientWidth ||
      layout.activePanel.scrollHeight > layout.activePanel.clientHeight
    ) {
      throw new Error(
        `Wallet overflow in ${views[index]} at ${width}x${height}: ${JSON.stringify(layout)}`,
      );
    }
    if (views[index] === "deposit" && layout.offers !== 6) {
      throw new Error(`Wallet offers missing: ${JSON.stringify(layout)}`);
    }
    if (views[index] === "history" && layout.historyItems !== 3) {
      throw new Error(`Wallet history rows missing: ${JSON.stringify(layout)}`);
    }
    const screenshotPath = path.join(
      outputDirectory,
      `wallet-${views[index]}-${width}x${height}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    results.push({ view: `wallet-${views[index]}`, screenshotPath, layout });

    if (views[index] === "withdraw") {
      const amountInput = page.locator(".withdraw-form input").first();
      await amountInput.fill("999999999");
      const warning = page.locator(".wallet-balance-warning");
      await warning.waitFor();
      const warningScreenshotPath = path.join(
        outputDirectory,
        `wallet-withdraw-insufficient-${width}x${height}.png`,
      );
      const warningText = (await warning.textContent())?.trim();
      const submitDisabled = await page
        .locator(".withdraw-form .wallet-primary-button")
        .isDisabled();
      if (!warningText || !submitDisabled) {
        throw new Error("Winner Balance withdrawal warning is incomplete");
      }
      await page.screenshot({
        path: warningScreenshotPath,
        fullPage: false,
      });
      results.push({
        view: "wallet-withdraw-insufficient",
        screenshotPath: warningScreenshotPath,
        layout: {
          warning: warningText,
          submitDisabled,
        },
      });
      await amountInput.fill("");
    }

    if (views[index] === "admin") {
      for (const [subIndex, subView] of [
        [1, "settings"],
        [2, "offers"],
      ]) {
        await page.locator(".wallet-admin-tabs button").nth(subIndex).click();
        await page.waitForTimeout(350);
        const subLayout = await page.evaluate(() => {
          const panel = document.querySelector(".wallet-admin-panel");
          return panel
            ? {
                scrollWidth: panel.scrollWidth,
                scrollHeight: panel.scrollHeight,
                clientWidth: panel.clientWidth,
                clientHeight: panel.clientHeight,
                offerButtons: panel.querySelectorAll(
                  ".wallet-admin-offer-list button",
                ).length,
              }
            : null;
        });
        if (
          !subLayout ||
          subLayout.scrollWidth > subLayout.clientWidth ||
          subLayout.scrollHeight > subLayout.clientHeight ||
          (subView === "offers" && subLayout.offerButtons !== 7)
        ) {
          throw new Error(
            `Wallet admin ${subView} overflow at ${width}x${height}: ${JSON.stringify(subLayout)}`,
          );
        }
        const subScreenshotPath = path.join(
          outputDirectory,
          `wallet-admin-${subView}-${width}x${height}.png`,
        );
        await page.screenshot({ path: subScreenshotPath, fullPage: false });
        results.push({
          view: `wallet-admin-${subView}`,
          screenshotPath: subScreenshotPath,
          layout: subLayout,
        });
      }
    }
  }
  return results;
}

async function inspectTournamentViewport(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(`${webUrl}/tournaments`, { waitUntil: "domcontentloaded" });
  await page.locator(".tournament-page").waitFor();
  await page.locator(".tournament-tabs button").first().waitFor();
  await page.evaluate(() => {
    const target = document.querySelector(".tournament-tabs button");
    if (target instanceof HTMLElement) target.click();
  });
  await page.locator(".tournament-browse").waitFor();
  await page.locator(".tournament-list-card").first().waitFor();
  await page.waitForTimeout(350);

  const results = [];
  const inspect = async (view, selector) => {
    const layout = await page.evaluate((activeSelector) => {
      const pageElement = document.querySelector(".tournament-page");
      const active = document.querySelector(activeSelector);
      return {
        body: {
          scrollWidth: document.body.scrollWidth,
          scrollHeight: document.body.scrollHeight,
          clientWidth: document.body.clientWidth,
          clientHeight: document.body.clientHeight,
        },
        page: pageElement
          ? {
              scrollWidth: pageElement.scrollWidth,
              scrollHeight: pageElement.scrollHeight,
              clientWidth: pageElement.clientWidth,
              clientHeight: pageElement.clientHeight,
            }
          : null,
        active: active
          ? {
              scrollWidth: active.scrollWidth,
              clientWidth: active.clientWidth,
            }
          : null,
        cards: document.querySelectorAll(".tournament-list-card").length,
        matches: document.querySelectorAll(".bracket-match").length,
      };
    }, selector);
    if (
      layout.body.scrollWidth > layout.body.clientWidth ||
      layout.body.scrollHeight > layout.body.clientHeight ||
      !layout.page ||
      layout.page.scrollWidth > layout.page.clientWidth ||
      layout.page.scrollHeight > layout.page.clientHeight ||
      !layout.active ||
      layout.active.scrollWidth > layout.active.clientWidth
    ) {
      throw new Error(
        `Tournament overflow in ${view} at ${width}x${height}: ${JSON.stringify(layout)}`,
      );
    }
    const screenshotPath = path.join(
      outputDirectory,
      `tournament-${view}-${width}x${height}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    results.push({ view: `tournament-${view}`, screenshotPath, layout });
  };

  await inspect("browse", ".tournament-browse");
  if (await page.locator(".tournament-balance-modal").count()) {
    throw new Error("Tournament balance selector must not be rendered");
  }
  const openedTournament = await page.evaluate(() => {
    const target =
      document.querySelector(".tournament-list-card.current .tournament-list-card__head") ??
      document.querySelector(".tournament-list-card.current .tournament-card-actions button") ??
      document.querySelector(".tournament-list-card__head") ??
      document.querySelector(".tournament-list-card .tournament-card-actions button");
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  });
  if (!openedTournament) {
    const tournamentDiagnostic = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".tournament-list-card"));
      return {
        cardCount: cards.length,
        firstClass: cards[0]?.className ?? "",
        firstHtml: cards[0]?.innerHTML.slice(0, 500) ?? "",
        pageText: document.querySelector(".tournament-page")?.textContent?.slice(0, 500) ?? "",
      };
    });
    throw new Error(
      `Tournament card head was not available for bracket check: ${JSON.stringify(tournamentDiagnostic)}`,
    );
  }
  await page.locator(".bracket-match").first().waitFor();
  await inspect("bracket", ".tournament-detail");
  await page.locator(".tournament-tabs button").nth(2).click();
  await page.locator(".tournament-admin-form").waitFor();
  await inspect("admin", ".tournament-admin");
  return results;
}

async function inspectGameViewport(
  page,
  width,
  height,
  credentials,
  inspectRolling = false,
  options = {},
) {
  const matchId = options.matchId ?? credentials.activeMatchId;
  const expectedPlayers = options.expectedPlayers ?? 2;
  const label = options.label ? `${options.label}-` : "";
  await page.setViewportSize({ width, height });
  await page.goto(`${webUrl}/game/${matchId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator(".game-page:not(.game-loading)").waitFor();
  await page.locator(".ludo-board").waitFor();
  await page.waitForTimeout(500);

  const results = [];
  const inspect = async (view, selector) => {
    const layout = await page.evaluate((activeSelector) => {
      const game = document.querySelector(".game-page");
      const board = document.querySelector(".ludo-board");
      const active = document.querySelector(activeSelector);
      return {
        body: {
          scrollWidth: document.body.scrollWidth,
          scrollHeight: document.body.scrollHeight,
          clientWidth: document.body.clientWidth,
          clientHeight: document.body.clientHeight,
        },
        game: game
          ? {
              scrollWidth: game.scrollWidth,
              scrollHeight: game.scrollHeight,
              clientWidth: game.clientWidth,
              clientHeight: game.clientHeight,
            }
          : null,
        board: board
          ? {
              width: board.clientWidth,
              height: board.clientHeight,
            }
          : null,
        active: Boolean(active),
        cells: document.querySelectorAll(".board-cell").length,
        tokens: document.querySelectorAll(".ludo-token").length,
        players: document.querySelectorAll(".game-player-pod").length,
        yardTokenAlignment: Array.from(
          document.querySelectorAll(".ludo-token.in-yard"),
        ).map((token) => {
          const color = ["green", "yellow", "blue", "red"].find((name) =>
            token.classList.contains(name),
          );
          const tokenIndex = Number(token.dataset.tokenIndex);
          const slot = color
            ? document.querySelectorAll(
                `.board-yard-shell.${color} .board-yard-well i`,
              )[tokenIndex]
            : null;
          const tokenRect = token.getBoundingClientRect();
          const slotRect = slot?.getBoundingClientRect();
          const tokenCenter = {
            x: tokenRect.x + tokenRect.width / 2,
            y: tokenRect.y + tokenRect.height / 2,
          };
          const slotCenter = slotRect
            ? {
                x: slotRect.x + slotRect.width / 2,
                y: slotRect.y + slotRect.height / 2,
              }
            : null;
          return {
            color,
            tokenIndex,
            offset: slotCenter
              ? Math.hypot(
                  tokenCenter.x - slotCenter.x,
                  tokenCenter.y - slotCenter.y,
                )
              : null,
          };
        }),
        podSeats: Array.from(document.querySelectorAll(".game-player-pod")).map(
          (pod) => {
            const seat = Array.from(pod.classList)
              .find((name) => name.startsWith("seat-"))
              ?.replace("seat-", "");
            const rect = pod.getBoundingClientRect();
            return {
              seat: Number(seat),
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
            };
          },
        ),
        boardRect: board?.getBoundingClientRect().toJSON() ?? null,
      };
    }, selector);
    const boardCenterX = layout.boardRect
      ? layout.boardRect.x + layout.boardRect.width / 2
      : 0;
    const expectedSeats =
      expectedPlayers === 2 ? [0, 2] : [0, 1, 2, 3];
    const cornersValid =
      layout.boardRect &&
      layout.podSeats.length === expectedSeats.length &&
      layout.podSeats.every((pod) => {
        if (!expectedSeats.includes(pod.seat)) return false;
        if (pod.seat === 0) {
          return pod.x < boardCenterX && pod.y < layout.boardRect.y;
        }
        if (pod.seat === 1) {
          return pod.x > boardCenterX && pod.y < layout.boardRect.y;
        }
        if (pod.seat === 2) {
          return pod.x > boardCenterX && pod.y > layout.boardRect.bottom;
        }
        return pod.x < boardCenterX && pod.y > layout.boardRect.bottom;
      });
    if (
      layout.body.scrollWidth > layout.body.clientWidth ||
      layout.body.scrollHeight > layout.body.clientHeight ||
      !layout.game ||
      layout.game.scrollWidth > layout.game.clientWidth ||
      layout.game.scrollHeight > layout.game.clientHeight ||
      !layout.board ||
      layout.board.width !== layout.board.height ||
      !layout.active ||
      layout.cells !== 225 ||
      layout.tokens !== expectedPlayers * 4 ||
      layout.players !== expectedPlayers ||
      layout.yardTokenAlignment.length !== expectedPlayers * 4 ||
      layout.yardTokenAlignment.some(
        ({ offset }) => offset === null || offset > 2,
      ) ||
      !cornersValid
    ) {
      throw new Error(
        `Game layout failure in ${view} at ${width}x${height}: ${JSON.stringify(layout)}`,
      );
    }
    const screenshotPath = path.join(
      outputDirectory,
      `game-${label}${view}-${width}x${height}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    results.push({ view: `game-${label}${view}`, screenshotPath, layout });
  };

  await inspect("board", ".ludo-board");
  if (inspectRolling) {
    const diceButton = page.locator(".player-dice.can-roll");
    if (await diceButton.isEnabled()) {
      await diceButton.click();
      await page.locator(".player-dice.rolling").waitFor();
      await inspect("dice-rolling", ".player-dice.rolling");
      await page.locator(".player-dice.rolling").waitFor({ state: "detached" });
    }
  }
  await page.locator(".game-communication button").nth(1).click();
  await page.locator(".emoji-picker").waitFor();
  await inspect("emoji", ".emoji-picker");
  await page.locator(".game-communication button").nth(2).click();
  await page.locator(".chat-panel").waitFor();
  await inspect("chat", ".chat-panel");
  return results;
}

async function inspectRealtimeViewport(page, width, height) {
  await page.setViewportSize({ width, height });
  const socketConnection = page.waitForEvent("websocket", {
    timeout: 15_000,
    predicate: (candidate) => candidate.url().includes("/socket.io/"),
  });
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".home-dashboard").waitFor();
  const webSocket = await socketConnection;
  if (!webSocket.url().includes(`:${apiPort}/socket.io/`)) {
    throw new Error(
      `Realtime socket connected to the wrong API: ${webSocket.url()}`,
    );
  }
  await page.waitForTimeout(500);
  const callAdmin = async (pathName, method, body) =>
    page.evaluate(
      async ({ apiUrl: targetApiUrl, pathName: targetPath, method: verb, body: payload }) => {
        const response = await fetch(`${targetApiUrl}${targetPath}`, {
          method: verb,
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        return { status: response.status, text: await response.text() };
      },
      { apiUrl, pathName, method, body },
    );
  const results = [];
  const inspect = async (view, selector) => {
    const layout = await page.evaluate((activeSelector) => {
      const active = document.querySelector(activeSelector);
      return {
        body: {
          scrollWidth: document.body.scrollWidth,
          scrollHeight: document.body.scrollHeight,
          clientWidth: document.body.clientWidth,
          clientHeight: document.body.clientHeight,
        },
        active: active
          ? {
              scrollWidth: active.scrollWidth,
              clientWidth: active.clientWidth,
            }
          : null,
      };
    }, selector);
    if (
      layout.body.scrollWidth > layout.body.clientWidth ||
      layout.body.scrollHeight > layout.body.clientHeight ||
      !layout.active ||
      layout.active.scrollWidth > layout.active.clientWidth
    ) {
      throw new Error(
        `Realtime overlay failure in ${view} at ${width}x${height}: ${JSON.stringify(layout)}`,
      );
    }
    const screenshotPath = path.join(
      outputDirectory,
      `realtime-${view}-${width}x${height}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    results.push({ view: `realtime-${view}`, screenshotPath, layout });
  };

  const notice = await callAdmin("/api/realtime/admin/notice", "POST", {
    title: "Live tournament update",
    message: "Phase 7 notice delivered instantly through Socket.io.",
  });
  if (notice.status !== 201) {
    throw new Error(`Realtime notice API failed: ${JSON.stringify(notice)}`);
  }
  await page.locator(".realtime-notice").waitFor();
  await inspect("notice", ".realtime-notice");

  try {
    const maintenance = await callAdmin(
      "/api/realtime/admin/maintenance",
      "PUT",
      {
        enabled: true,
        message: "Scheduled realtime maintenance preview.",
      },
    );
    if (maintenance.status !== 200) {
      throw new Error(
        `Realtime maintenance API failed: ${JSON.stringify(maintenance)}`,
      );
    }
    await page.locator(".maintenance-overlay").waitFor();
    await inspect("maintenance", ".maintenance-overlay");
  } finally {
    await callAdmin("/api/realtime/admin/maintenance", "PUT", {
      enabled: false,
      message: "PrizeJito.com is available.",
    });
  }
  return results;
}

async function inspectLeaderboardViewport(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(`${webUrl}/leaders`, { waitUntil: "domcontentloaded" });
  await page.locator(".leaderboard-page").waitFor();
  await page.locator(".leaderboard-list article").first().waitFor();
  const results = [];
  const inspect = async (view, selector) => {
    const layout = await page.evaluate((activeSelector) => {
      const pageElement = document.querySelector(".leaderboard-page");
      const active = document.querySelector(activeSelector);
      return {
        body: {
          scrollWidth: document.body.scrollWidth,
          scrollHeight: document.body.scrollHeight,
          clientWidth: document.body.clientWidth,
          clientHeight: document.body.clientHeight,
        },
        page: pageElement
          ? {
              scrollWidth: pageElement.scrollWidth,
              scrollHeight: pageElement.scrollHeight,
              clientWidth: pageElement.clientWidth,
              clientHeight: pageElement.clientHeight,
            }
          : null,
        active: active
          ? {
              scrollWidth: active.scrollWidth,
              clientWidth: active.clientWidth,
            }
          : null,
        rankingRows: document.querySelectorAll(
          ".leaderboard-list article",
        ).length,
        botRows: document.querySelectorAll(".bot-list article").length,
      };
    }, selector);
    if (
      layout.body.scrollWidth > layout.body.clientWidth ||
      layout.body.scrollHeight > layout.body.clientHeight ||
      !layout.page ||
      layout.page.scrollWidth > layout.page.clientWidth ||
      layout.page.scrollHeight > layout.page.clientHeight ||
      !layout.active ||
      layout.active.scrollWidth > layout.active.clientWidth
    ) {
      throw new Error(
        `Leaderboard overflow in ${view} at ${width}x${height}: ${JSON.stringify(layout)}`,
      );
    }
    const screenshotPath = path.join(
      outputDirectory,
      `leaderboard-${view}-${width}x${height}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    results.push({
      view: `leaderboard-${view}`,
      screenshotPath,
      layout,
    });
  };

  await inspect("ranking", ".leaderboard-list");
  await page.locator(".leaderboard-header button").click();
  await page.locator(".bot-list article").first().waitFor();
  await inspect("bots", ".bot-admin");
  return results;
}

const pool = new Pool({ connectionString: databaseUrl });
let browser;

try {
  await mkdir(outputDirectory, { recursive: true });
  const credentials = await seedVisualFixtures(pool);

  if (!(await isReachable(`${apiUrl}/api/health`))) {
    start(
      process.execPath,
      [path.join(root, "apps", "api", "dist", "index.js")],
      {
        WEB_ORIGIN: webUrl,
        API_PUBLIC_URL: apiUrl,
        PORT: apiPort,
        NODE_ENV: "test",
      },
    );
  }
  if (!(await isReachable(webUrl))) {
    start(process.execPath, [
      path.join(root, "apps", "web", "node_modules", "vite", "bin", "vite.js"),
      path.join(root, "apps", "web"),
      "--host",
      "127.0.0.1",
      "--port",
      "5174",
      "--strictPort",
      "--mode",
      "visual",
    ]);
  }
  await Promise.all([
    waitFor(`${apiUrl}/api/health`),
    waitFor(webUrl),
  ]);

  browser = await chromium.launch({
    executablePath: edgePath,
    headless: true,
  });
  const page = await browser.newPage({
    locale: "bn-BD",
    colorScheme: "dark",
    isMobile: true,
    hasTouch: true,
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`[browser console] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    console.error(`[browser pageerror] ${error.message}`);
  });
  const results = [];
  results.push(await inspectViewport(page, 390, 844));
  results.push(await inspectViewport(page, 360, 640));
  results.push(...(await inspectGuestAuth(page, 390, 844)));
  await loginVisualUser(page, credentials);
  results.push(...(await inspectPhase10Viewport(page, 390, 844)));
  results.push(...(await inspectPhase10Viewport(page, 360, 640)));
  results.push(...(await inspectProfileViewport(page, 390, 844)));
  results.push(...(await inspectProfileViewport(page, 360, 640)));
  results.push(...(await inspectWalletViewport(page, 390, 844, credentials)));
  results.push(...(await inspectWalletViewport(page, 360, 640, credentials)));
  results.push(...(await inspectTournamentViewport(page, 390, 844)));
  results.push(...(await inspectTournamentViewport(page, 360, 640)));
  results.push(...(await inspectLeaderboardViewport(page, 390, 844)));
  results.push(...(await inspectLeaderboardViewport(page, 360, 640)));
  results.push(...(await inspectGameViewport(page, 390, 844, credentials, true)));
  results.push(...(await inspectGameViewport(page, 360, 640, credentials)));
  results.push(
    ...(await inspectGameViewport(page, 390, 844, credentials, false, {
      matchId: credentials.activeFourPlayerMatchId,
      expectedPlayers: 4,
      label: "4p",
    })),
  );
  results.push(...(await inspectRealtimeViewport(page, 390, 844)));
  results.push(...(await inspectAdminViewport(page, 1280, 800, credentials)));
  results.push(...(await inspectAdminViewport(page, 390, 844, credentials)));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  for (const child of children) {
    child.kill();
  }
  if (fixtureIds.length > 0) {
    if (fixtureUserIds.length > 0) {
      await pool.query(
        "delete from transactions where user_id = any($1::uuid[])",
        [fixtureUserIds],
      );
      await pool.query(
        "delete from admin_audit_logs where actor_id = any($1::uuid[])",
        [fixtureUserIds],
      );
    }
    await pool.query("delete from tournaments where id = any($1::uuid[])", [
      fixtureIds,
    ]);
  }
  if (fixtureUserIds.length > 0) {
    await pool.query("delete from users where id = any($1::uuid[])", [
      fixtureUserIds,
    ]);
  }
  await pool.end();
}
