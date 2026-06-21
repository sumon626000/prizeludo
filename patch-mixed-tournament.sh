#!/usr/bin/env bash
# Patch: Add Mixed 16P tournament (1 real + 15 bots, 4p boards)
set -euo pipefail

cd /home/nixbazar/prizeludo

echo "=== Step 1: Get latest code ==="
git fetch origin main
git reset --hard origin/main
git clean -fd -- apps/web apps/api packages 2>/dev/null || git clean -fd

echo "=== Step 2: Patch createRecurringReplacementInTransaction ==="
sed -i 's/playerType: "real",$/playerType: tournament.playerType,/' apps/api/src/services/tournament.service.ts

echo "=== Step 3: Add ensureMixedRealtimeTournaments function ==="
# Insert before publicTournamentUser
LINE=$(grep -n "^export function publicTournamentUser" apps/api/src/services/tournament.service.ts | cut -d: -f1)
if [[ -z "$LINE" ]]; then
  echo "ERROR: Could not find insertion point" >&2
  exit 1
fi

head -n $((LINE - 1)) apps/api/src/services/tournament.service.ts > /tmp/ts-part1.ts

cat >> /tmp/ts-part1.ts << 'FUNCTION_EOF'

export async function ensureMixedRealtimeTournaments(io?: Server) {
  const MIXED_KEY = "mixed-4p-16";
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('prizejito-mixed-realtime-tournaments'))`,
    );
    const existing = await transaction
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(
        and(
          eq(tournaments.isRecurring, true),
          eq(tournaments.recurringTemplateKey, MIXED_KEY),
          eq(tournaments.status, "waiting"),
        ),
      )
      .limit(1)
      .for("update");
    if (existing.length > 0) return;

    const [tournament] = await transaction
      .insert(tournaments)
      .values({
        title: "PrizeJito Mixed 16P",
        playerCount: 16,
        boardType: "4p",
        gameMode: "classic",
        type: "free",
        joinFee: "0",
        prizePool: "1600.00",
        adminCommission: "0",
        prizeFirst: "70",
        prizeSecond: "30",
        playerType: "mixed",
        isRecurring: true,
        recurringTemplateKey: MIXED_KEY,
        status: "waiting",
        countdownDuration: 15,
        countdownEndsAt: null,
        betweenRoundSeconds: 30,
        totalRounds: 0,
      })
      .returning();
    if (!tournament) return;

    await fillTournamentBotsInTransaction(transaction, tournament, new Date());

    // Remove 1 bot entry → leave 1 slot for real player
    const botEntry = await transaction
      .select({ id: tournamentEntries.id })
      .from(tournamentEntries)
      .where(
        and(
          eq(tournamentEntries.tournamentId, tournament.id),
          eq(tournamentEntries.status, "joined"),
        ),
      )
      .limit(1)
      .for("update");
    if (botEntry.length > 0) {
      await transaction
        .update(tournamentEntries)
        .set({ status: "left", leftAt: new Date(), updatedAt: new Date() })
        .where(eq(tournamentEntries.id, botEntry[0]!.id));
    }

    if (io) {
      emitTournamentMutation(io, tournament.id, [], "mixed_created");
    }
  });
}
FUNCTION_EOF

tail -n +$LINE apps/api/src/services/tournament.service.ts >> /tmp/ts-part1.ts
cp /tmp/ts-part1.ts apps/api/src/services/tournament.service.ts
rm -f /tmp/ts-part1.ts

echo "=== Step 4: Add scheduler call ==="
sed -i 's/await ensureRecurringRealTournaments(io);/await ensureRecurringRealTournaments(io);\n          await ensureMixedRealtimeTournaments(io);/' apps/api/src/services/tournament.service.ts

echo "=== Step 5: Build and deploy (--no-git) ==="
bash scripts/update-changed.sh --no-git

echo ""
echo "✅ DONE! Mixed 16P tournament system is now active."
echo "   - Every 15s: checks if a Mixed 16P waiting tournament exists"
echo "   - Creates: 15 bots + 1 free slot for real player"
echo "   - When real player joins: 15s countdown then start"
echo "   - After completion: auto-replacement with same settings"
