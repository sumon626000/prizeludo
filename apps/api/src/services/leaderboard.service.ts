import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

export type LeaderboardPeriod = "daily" | "weekly" | "monthly" | "all";

export const LEADERBOARD_ENTRY_LIMIT = 50;

interface LeaderboardQueryRow extends Record<string, unknown> {
  id: string;
  name: string;
  avatar: string;
  wins: number;
  games: number;
  earnings: string;
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  avatar: string;
  wins: number;
  losses: number;
  games: number;
  winRate: number;
  earnings: string;
  source: "real" | "bot";
  isPromotional: boolean;
  isCurrentPlayer: boolean;
}

function periodStart(period: LeaderboardPeriod) {
  if (period === "daily") {
    return sql`date_trunc('day', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka'`;
  }
  if (period === "weekly") {
    return sql`date_trunc('week', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka'`;
  }
  if (period === "monthly") {
    return sql`date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka'`;
  }
  return null;
}

export async function getLeaderboard(
  period: LeaderboardPeriod,
  currentUserId?: string,
) {
  const start = periodStart(period);
  const matchWindow = start
    ? sql`and m.ended_at >= ${start}`
    : sql``;
  const transactionWindow = start
    ? sql`and tr.created_at >= ${start}`
    : sql``;
  const promoWindow = start
    ? sql`and pw.created_at >= ${start}`
    : sql``;

  const realResult = await db.execute<LeaderboardQueryRow>(sql`
    select
      u.id,
      u.name,
      u.avatar,
      (
        select count(*)::int
        from matches m
        where m.winner_id = u.id
          and m.status = 'completed'
          ${matchWindow}
      ) as wins,
      (
        select count(*)::int
        from match_players mp
        join matches m on m.id = mp.match_id
        where mp.user_id = u.id
          and m.status = 'completed'
          ${matchWindow}
      ) as games,
      (
        select coalesce(sum(tr.amount), 0)::text
        from transactions tr
        where tr.user_id = u.id
          and tr.type = 'prize'
          and tr.status = 'success'
          ${transactionWindow}
      ) as earnings
    from users u
    where u.is_bot = false
  `);

  const botResult = await db.execute<LeaderboardQueryRow>(sql`
    select
      bp.id,
      bp.name,
      bp.avatar,
      (
        (
          select count(*)::int
          from matches m
          where m.winner_id = bp.user_id
            and m.status = 'completed'
            ${matchWindow}
        ) +
        (
          select count(*)::int
          from promotional_wins pw
          where pw.bot_player_id = bp.id
            and pw.is_disclosed = true
            ${promoWindow}
        )
      )::int as wins,
      (
        select count(*)::int
        from match_players mp
        join matches m on m.id = mp.match_id
        where mp.user_id = bp.user_id
          and m.status = 'completed'
          ${matchWindow}
      ) as games,
      (
        select coalesce(sum(pw.amount), 0)::text
        from promotional_wins pw
        where pw.bot_player_id = bp.id
          and pw.is_disclosed = true
          ${promoWindow}
      ) as earnings
    from bot_players bp
    where bp.is_active = true
  `);

  const rows = [
    ...realResult.rows.map((row) => ({
      ...row,
      source: "real" as const,
      isPromotional: false,
    })),
    ...botResult.rows.map((row) => ({
      ...row,
      source: "bot" as const,
      isPromotional: true,
    })),
  ]
    .filter(
      (row) =>
        Number(row.earnings) > 0 ||
        Number(row.wins) > 0 ||
        Number(row.games) > 0,
    )
    .sort(
      (left, right) =>
        Number(right.earnings) - Number(left.earnings) ||
        Number(right.wins) - Number(left.wins) ||
        left.name.localeCompare(right.name),
    );

  const entries: LeaderboardEntry[] = rows.map((row, index) => {
    const games = Number(row.games);
    const wins = Number(row.wins);
    return {
      rank: index + 1,
      id: row.id,
      name: row.name,
      avatar: row.avatar,
      wins,
      games,
      losses: Math.max(0, games - wins),
      winRate: games > 0 ? Math.round((wins / games) * 100) : 0,
      earnings: String(row.earnings),
      source: row.source,
      isPromotional: row.isPromotional,
      isCurrentPlayer:
        row.source === "real" && row.id === currentUserId,
    };
  });

  return {
    period,
    entries: entries.slice(0, LEADERBOARD_ENTRY_LIMIT),
    currentPlayerRank:
      entries.find((entry) => entry.isCurrentPlayer)?.rank ?? null,
    counts: {
      real: entries.filter((entry) => entry.source === "real").length,
      promotional: entries.filter((entry) => entry.source === "bot").length,
    },
    generatedAt: new Date(),
  };
}
