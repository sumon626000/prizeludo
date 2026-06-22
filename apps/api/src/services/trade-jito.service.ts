import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Server } from "socket.io";
import { db } from "../db/client.js";
import { transactions, users } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { toPublicUser } from "../lib/public-user.js";
import { emitBalanceUpdate } from "./realtime.service.js";
import { centsToMoney, moneyToCents } from "./wallet.service.js";

const MIN_STAKE_CENTS = 1_000;
const MAX_STAKE_CENTS = 1_000_000;
const WIN_BIAS_TREND = 0.7;
const WIN_BIAS_COUNTER_TREND = 0.3;
const WIN_BIAS_NORMAL = 0.52;

type TradeDirection = "BUY" | "SELL";
type MarketTrend = "UPTREND" | "DOWNTREND";
type TradeOutcome = "WIN" | "LOSS";

type PendingTrade = {
  id: string;
  userId: string;
  stakeCents: number;
  mainDebitCents: number;
  winnerDebitCents: number;
  direction: TradeDirection;
  outcome: TradeOutcome;
  status: "open" | "settled";
  createdAt: Date;
};

const pendingTrades = new Map<string, PendingTrade>();

function totalBalanceCents(user: {
  mainBalance: string;
  winnerBalance: string;
}): number {
  return moneyToCents(user.mainBalance) + moneyToCents(user.winnerBalance);
}

export function resolveTradeOutcome(
  direction: TradeDirection,
  trend: MarketTrend,
): TradeOutcome {
  const isBuy = direction === "BUY";
  let winningProb = WIN_BIAS_NORMAL;
  if (trend === "UPTREND" && isBuy) winningProb = WIN_BIAS_TREND;
  if (trend === "DOWNTREND" && !isBuy) winningProb = WIN_BIAS_TREND;
  if (trend === "UPTREND" && !isBuy) winningProb = WIN_BIAS_COUNTER_TREND;
  if (trend === "DOWNTREND" && isBuy) winningProb = WIN_BIAS_COUNTER_TREND;
  return Math.random() < winningProb ? "WIN" : "LOSS";
}

export function getTradeJitoBalance(user: {
  mainBalance: string;
  winnerBalance: string;
}) {
  return centsToMoney(totalBalanceCents(user));
}

export async function openTradeJito(input: {
  userId: string;
  stake: string | number;
  direction: TradeDirection;
  trend: MarketTrend;
  io?: Server;
}) {
  const stakeCents = moneyToCents(input.stake);
  if (stakeCents < MIN_STAKE_CENTS || stakeCents > MAX_STAKE_CENTS) {
    throw new AppError(
      400,
      "INVALID_STAKE",
      "Stake must be between ৳10 and ৳10,000.",
    );
  }

  const result = await db.transaction(async (transaction) => {
    const [user] = await transaction
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (!user || user.isBot) {
      throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
    }

    const availableCents = totalBalanceCents(user);
    if (availableCents < stakeCents) {
      throw new AppError(
        409,
        "INSUFFICIENT_BALANCE",
        "আপনার ব্যালেন্সে পর্যাপ্ত টাকা নেই।",
      );
    }

    const mainBalanceCents = moneyToCents(user.mainBalance);
    const winnerBalanceCents = moneyToCents(user.winnerBalance);
    const mainDebitCents = Math.min(mainBalanceCents, stakeCents);
    const winnerDebitCents = stakeCents - mainDebitCents;
    const mainDebit = centsToMoney(mainDebitCents);
    const winnerDebit = centsToMoney(winnerDebitCents);
    const stake = centsToMoney(stakeCents);
    const tradeId = randomUUID();
    const outcome = resolveTradeOutcome(input.direction, input.trend);
    const now = new Date();

    const [updatedUser] = await transaction
      .update(users)
      .set({
        mainBalance: sql`${users.mainBalance} - cast(${mainDebit} as numeric)`,
        winnerBalance: sql`${users.winnerBalance} - cast(${winnerDebit} as numeric)`,
        updatedAt: now,
      })
      .where(eq(users.id, input.userId))
      .returning();

    const feeTransactions = [
      ...(mainDebitCents > 0
        ? [
            {
              userId: input.userId,
              type: "bonus" as const,
              amount: mainDebit,
              status: "success" as const,
              direction: "outgoing" as const,
              balanceSource: "main" as const,
              balanceAppliedAt: now,
              reference: `trade-jito-stake-main-${tradeId}`,
              metadata: {
                game: "trade_jito",
                tradeId,
                direction: input.direction,
                phase: "stake",
              },
            },
          ]
        : []),
      ...(winnerDebitCents > 0
        ? [
            {
              userId: input.userId,
              type: "bonus" as const,
              amount: winnerDebit,
              status: "success" as const,
              direction: "outgoing" as const,
              balanceSource: "winner" as const,
              balanceAppliedAt: now,
              reference: `trade-jito-stake-winner-${tradeId}`,
              metadata: {
                game: "trade_jito",
                tradeId,
                direction: input.direction,
                phase: "stake",
              },
            },
          ]
        : []),
    ];
    if (feeTransactions.length > 0) {
      await transaction.insert(transactions).values(feeTransactions);
    }

    pendingTrades.set(tradeId, {
      id: tradeId,
      userId: input.userId,
      stakeCents,
      mainDebitCents,
      winnerDebitCents,
      direction: input.direction,
      outcome,
      status: "open",
      createdAt: now,
    });

    return {
      tradeId,
      outcome,
      balance: getTradeJitoBalance(updatedUser!),
      user: updatedUser!,
    };
  });

  input.io?.to(`user:${input.userId}`).emit(
    "profile:update",
    toPublicUser(result.user),
  );
  emitBalanceUpdate(input.io, input.userId, { reason: "trade_jito_open" });

  return {
    tradeId: result.tradeId,
    outcome: result.outcome,
    balance: result.balance,
  };
}

export async function settleTradeJito(input: {
  userId: string;
  tradeId: string;
  io?: Server;
}) {
  const pending = pendingTrades.get(input.tradeId);
  if (!pending || pending.userId !== input.userId) {
    throw new AppError(404, "TRADE_NOT_FOUND", "Trade session was not found.");
  }
  if (pending.status !== "open") {
    throw new AppError(409, "TRADE_ALREADY_SETTLED", "Trade already settled.");
  }

  const result = await db.transaction(async (transaction) => {
    const [user] = await transaction
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
    }

    const now = new Date();
    let updatedUser = user;
    if (pending.outcome === "WIN") {
      const payoutCents = pending.stakeCents * 2;
      const payout = centsToMoney(payoutCents);
      const [credited] = await transaction
        .update(users)
        .set({
          winnerBalance: sql`${users.winnerBalance} + cast(${payout} as numeric)`,
          updatedAt: now,
        })
        .where(eq(users.id, input.userId))
        .returning();
      updatedUser = credited!;
      await transaction.insert(transactions).values({
        userId: input.userId,
        type: "prize",
        amount: payout,
        status: "success",
        direction: "incoming",
        balanceSource: "winner",
        balanceAppliedAt: now,
        reference: `trade-jito-win-${pending.id}`,
        metadata: {
          game: "trade_jito",
          tradeId: pending.id,
          direction: pending.direction,
          phase: "payout",
        },
      });
    }

    pending.status = "settled";
    pendingTrades.set(pending.id, pending);

    return {
      outcome: pending.outcome,
      payout:
        pending.outcome === "WIN"
          ? centsToMoney(pending.stakeCents * 2)
          : "0.00",
      balance: getTradeJitoBalance(updatedUser),
      user: updatedUser,
    };
  });

  input.io?.to(`user:${input.userId}`).emit(
    "profile:update",
    toPublicUser(result.user),
  );
  emitBalanceUpdate(input.io, input.userId, { reason: "trade_jito_settle" });

  return {
    outcome: result.outcome,
    payout: result.payout,
    balance: result.balance,
  };
}
