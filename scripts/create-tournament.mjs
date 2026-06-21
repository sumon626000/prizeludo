import { writeFileSync } from "node:fs";

const API = "http://localhost:4000";
const ADMIN_PHONE = "+8801774566209";
const ADMIN_PASSWORD = "Visual1234";

async function request(path, options = {}) {
  const url = `${API}${path}`;
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  const body = options.body ? JSON.stringify(options.body) : undefined;
  if (body && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: "manual",
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data, cookies: response.headers.getSetCookie?.() || [] };
}

function extractCookie(setCookieHeaders, name) {
  for (const header of setCookieHeaders) {
    const match = header.match(new RegExp(`^${name}=([^;]+)`));
    if (match) return match[1];
  }
  return null;
}

async function main() {
  console.log("=== Step 1: Login as admin ===");
  const login = await request("/api/admin/login", {
    method: "POST",
    body: { identifier: ADMIN_PHONE, password: ADMIN_PASSWORD },
  });
  const sessionCookie = extractCookie(login.cookies, "khan_ludo_session");
  console.log(`Login status: ${login.status}`);
  if (login.status !== 200) {
    console.error("Login failed:", login.data);
    process.exit(1);
  }
  console.log("Logged in as:", login.data.user?.name, `(gameId: ${login.data.user?.gameId})`);

  const authHeaders = { Cookie: `khan_ludo_session=${sessionCookie}` };

  console.log("\n=== Step 2: Create real-to-real 2-player tournament ===");
  const now = new Date();
  const startsIn = new Date(now.getTime() + 5 * 60_000); // 5 minutes from now
  const tournamentInput = {
    title: "Real 2-Player Classic Battle",
    playerCount: 2,
    boardType: "2p",
    gameMode: "classic",
    type: "paid",
    joinFee: 50,
    prizePool: 90,
    adminCommission: 10,
    prizeFirst: 70,
    prizeSecond: 30,
    playerType: "real",
    countdownDuration: 120,
    betweenRoundSeconds: 60,
    status: "waiting",
  };

  const create = await request("/api/tournaments/admin", {
    method: "POST",
    headers: authHeaders,
    body: tournamentInput,
  });
  console.log(`Create status: ${create.status}`);
  console.log("Response:", JSON.stringify(create.data, null, 2));

  if (create.status === 201 && create.data.tournament) {
    const t = create.data.tournament;
    console.log("\n=== Tournament Created Successfully ===");
    console.log(`ID:          ${t.id}`);
    console.log(`Title:       ${t.title}`);
    console.log(`Players:     ${t.playerCount}`);
    console.log(`Board:       ${t.boardType}`);
    console.log(`Mode:        ${t.gameMode}`);
    console.log(`Type:        ${t.type}`);
    console.log(`Join Fee:    ৳${t.joinFee}`);
    console.log(`Prize Pool:  ৳${t.prizePool}`);
    console.log(`Player Type: ${t.playerType}`);
    console.log(`Status:      ${t.status}`);

    // Verify it appears in the list
    console.log("\n=== Step 3: Verify in tournament list ===");
    const list = await request("/api/tournaments?boardType=2p&type=paid&status=waiting");
    console.log(`Tournaments found: ${list.data.tournaments?.length || 0}`);
    const found = list.data.tournaments?.find((item) => item.id === t.id);
    if (found) {
      console.log("✓ Tournament confirmed in listing");
    } else {
      console.log("⚠ Tournament not yet visible in listing");
    }
  } else {
    console.error("Tournament creation failed.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});