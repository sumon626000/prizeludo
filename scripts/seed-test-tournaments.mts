import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../apps/api/src/db/client.js";
import { tournaments, users } from "../apps/api/src/db/schema.js";
import {
  deleteTournament,
  ensureTestRecurringTournaments,
} from "../apps/api/src/services/tournament.service.js";
import { ensureShowcaseBotPool } from "../apps/api/src/services/bot.service.js";
import { updateSettings } from "../apps/api/src/services/settings.service.js";

async function findAdminId() {
  const [admin] = await db
    .select({ id: users.id, name: users.name, gameId: users.gameId })
    .from(users)
    .where(eq(users.isAdmin, true))
    .limit(1);
  if (!admin) {
    throw new Error("No admin user found. Create an admin account first.");
  }
  return admin;
}

async function clearTournaments(actorId: string) {
  const rows = await db
    .select({ id: tournaments.id, status: tournaments.status, title: tournaments.title })
    .from(tournaments);

  console.log(`Found ${rows.length} tournament(s) to remove.`);

  for (const row of rows) {
    if (row.status === "waiting" || row.status === "upcoming") {
      await deleteTournament({
        tournamentId: row.id,
        actorId,
        ipAddress: "127.0.0.1",
      });
      console.log(`Deleted: ${row.title}`);
      continue;
    }

    await db.delete(tournaments).where(eq(tournaments.id, row.id));
    console.log(`Force deleted (${row.status}): ${row.title}`);
  }
}

async function main() {
  const admin = await findAdminId();
  console.log(`Using admin: ${admin.name} (#${admin.gameId})`);

  console.log("\n=== Disabling auto tournament generators ===");
  await updateSettings({
    "tournament.showcase_enabled": "false",
    "tournament.mixed_auto_enabled": "false",
    "tournament.recurring_real_enabled": "false",
    "tournament.test_recurring_enabled": "true",
    "bots.enabled": "true",
  });

  console.log("\n=== Clearing all tournaments ===");
  await clearTournaments(admin.id);

  console.log("\n=== Ensuring bot pool ===");
  await ensureShowcaseBotPool(12);

  console.log("\n=== Creating recurring test tournaments ===");
  const { created } = await ensureTestRecurringTournaments();
  for (const tournament of created) {
    console.log(`✓ ${tournament.title}\n  id: ${tournament.id}`);
  }

  const remaining = await db
    .select({
      id: tournaments.id,
      title: tournaments.title,
      status: tournaments.status,
      recurringTemplateKey: tournaments.recurringTemplateKey,
    })
    .from(tournaments);
  console.log(`\nDone. ${remaining.length} tournament(s) in database:`);
  for (const row of remaining) {
    console.log(
      `  - ${row.title} (${row.status}, template: ${row.recurringTemplateKey ?? "none"})`,
    );
  }
  console.log(
    "\nEach lobby auto-replenishes after a match starts — join, play, join again.",
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
