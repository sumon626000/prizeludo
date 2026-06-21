import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { db, pool } from "../db/client.js";
import {
  adminAuditLogs,
  depositOffers,
  transactions,
  users,
  walletDocuments,
} from "../db/schema.js";
import { issueSession } from "./auth.service.js";
import { ensureHomeDefaults } from "./settings.service.js";
import {
  ensureWalletDefaults,
  transferMainBalance,
} from "./wallet.service.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDatabaseTests)("Phase 4 wallet integration", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("keeps deposits, withdrawals, and transfers server-authoritative", async () => {
    await ensureHomeDefaults();
    await ensureWalletDefaults();
    const suffix = randomInt(1000, 9999).toString();
    const createdUsers = await db
      .insert(users)
      .values([
        {
          gameId: `1${suffix}`,
          name: "Wallet Referrer",
          phone: `+880151000${suffix}`,
          referCode: `WR${suffix}`,
        },
        {
          gameId: `2${suffix}`,
          name: "Wallet Player",
          phone: `+880171000${suffix}`,
          referCode: `WP${suffix}`,
          mainBalance: "500",
          winnerBalance: "300",
        },
        {
          gameId: `3${suffix}`,
          name: "Wallet Receiver",
          phone: `+880181000${suffix}`,
          referCode: `WX${suffix}`,
        },
        {
          gameId: `4${suffix}`,
          name: "Wallet Admin",
          phone: `+880191000${suffix}`,
          referCode: `WA${suffix}`,
          isAdmin: true,
        },
      ])
      .returning();
    const [referrer, playerSeed, receiver, admin] = createdUsers;
    expect(referrer && playerSeed && receiver && admin).toBeTruthy();
    const [player] = await db
      .update(users)
      .set({ referredBy: referrer!.id })
      .where(eq(users.id, playerSeed!.id))
      .returning();
    const userIds = createdUsers.map((user) => user.id);

    const playerSession = await issueSession({
      user: player!,
      ipAddress: "127.0.0.1",
      deviceId: "wallet-player-device",
    });
    const receiverSession = await issueSession({
      user: receiver!,
      ipAddress: "127.0.0.1",
      deviceId: "wallet-receiver-device",
    });
    const adminSession = await issueSession({
      user: admin!,
      ipAddress: "127.0.0.1",
      deviceId: "wallet-admin-device",
    });
    const playerHeaders = {
      Cookie: `${config.COOKIE_NAME}=${playerSession.token}`,
      "x-device-id": "wallet-player-device",
    };
    const receiverHeaders = {
      Cookie: `${config.COOKIE_NAME}=${receiverSession.token}`,
      "x-device-id": "wallet-receiver-device",
    };
    const adminHeaders = {
      Cookie: `${config.COOKIE_NAME}=${adminSession.token}`,
      "x-device-id": "wallet-admin-device",
    };
    const app = createApp();
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);

    try {
      const overview = await request(app).get("/api/wallet").set(playerHeaders);
      expect(overview.status).toBe(200);
      expect(overview.body.offers).toHaveLength(6);
      expect(overview.body.user).toEqual(
        expect.objectContaining({
          mainBalance: "500.00",
          winnerBalance: "300.00",
        }),
      );
      const offer = await db.query.depositOffers.findFirst({
        where: eq(depositOffers.amount, "100.00"),
      });
      expect(offer).toBeDefined();

      const proofUpload = await request(app)
        .post("/api/wallet/documents/manual_deposit_proof")
        .set(playerHeaders)
        .set("content-type", "image/png")
        .send(png);
      expect(proofUpload.status).toBe(201);
      const proofId = proofUpload.body.document.id as string;

      const privateProof = await request(app)
        .get(`/api/wallet/documents/${proofId}`)
        .set(receiverHeaders);
      expect(privateProof.status).toBe(404);

      const manualDeposit = await request(app)
        .post("/api/wallet/deposit/manual")
        .set(playerHeaders)
        .send({
          amount: 100,
          offerId: offer!.id,
          method: "bKash",
          documentId: proofId,
        });
      expect(manualDeposit.status).toBe(201);
      expect(manualDeposit.body.transaction).toEqual(
        expect.objectContaining({
          status: "pending",
          amount: "100.00",
          bonusAmount: "5.00",
        }),
      );
      const depositId = manualDeposit.body.transaction.id as string;

      const depositApproval = await request(app)
        .post(`/api/wallet/admin/deposits/${depositId}/review`)
        .set(adminHeaders)
        .send({ approve: true });
      expect(depositApproval.status).toBe(200);
      expect(depositApproval.body.deposit.status).toBe("paid");

      const duplicateApproval = await request(app)
        .post(`/api/wallet/admin/deposits/${depositId}/review`)
        .set(adminHeaders)
        .send({ approve: true });
      expect(duplicateApproval.status).toBe(200);
      expect(duplicateApproval.body.alreadyApplied).toBe(true);

      const balancesAfterDeposit = await db.query.users.findMany({
        where: inArray(users.id, [player!.id, referrer!.id]),
        columns: { id: true, mainBalance: true },
      });
      expect(
        balancesAfterDeposit.find((user) => user.id === player!.id)
          ?.mainBalance,
      ).toBe("605.00");
      expect(
        balancesAfterDeposit.find((user) => user.id === referrer!.id)
          ?.mainBalance,
      ).toBe("5.00");

      const rejectedWithdrawal = await request(app)
        .post("/api/wallet/withdraw")
        .set(playerHeaders)
        .send({
          amount: 100,
          method: "Nagad",
          accountNumber: "01810001234",
        });
      expect(rejectedWithdrawal.status).toBe(201);
      const rejectedWithdrawalId =
        rejectedWithdrawal.body.transaction.id as string;
      expect(rejectedWithdrawal.body.user.winnerBalance).toBe("200.00");

      const rejection = await request(app)
        .post(
          `/api/wallet/admin/withdrawals/${rejectedWithdrawalId}/review`,
        )
        .set(adminHeaders)
        .send({ status: "rejected", reason: "Account mismatch" });
      expect(rejection.status).toBe(200);
      expect(rejection.body.user.winnerBalance).toBe("300.00");

      const paidWithdrawal = await request(app)
        .post("/api/wallet/withdraw")
        .set(playerHeaders)
        .send({
          amount: 100,
          method: "bKash",
          accountNumber: "01710001234",
        });
      const paidWithdrawalId = paidWithdrawal.body.transaction.id as string;
      const withdrawalDetails = await request(app)
        .get(`/api/wallet/admin/withdrawals/${paidWithdrawalId}`)
        .set(adminHeaders);
      expect(withdrawalDetails.status).toBe(200);
      expect(withdrawalDetails.body.withdrawal.metadata).toEqual(
        expect.objectContaining({
          accountNumber: "01710001234",
        }),
      );
      expect(
        withdrawalDetails.body.withdrawal.metadata.accountEncrypted,
      ).toBeUndefined();
      const approval = await request(app)
        .post(`/api/wallet/admin/withdrawals/${paidWithdrawalId}/review`)
        .set(adminHeaders)
        .send({ status: "paid" });
      expect(approval.status).toBe(200);

      const resolveReceiver = await request(app)
        .get(`/api/wallet/transfer/receiver/${receiver!.gameId}`)
        .set(playerHeaders);
      expect(resolveReceiver.status).toBe(200);
      expect(resolveReceiver.body.receiver.name).toBe("Wallet Receiver");

      const transfer = await request(app)
        .post("/api/wallet/transfer")
        .set(playerHeaders)
        .send({ gameId: receiver!.gameId, amount: 100 });
      expect(transfer.status).toBe(201);
      expect(transfer.body).toEqual(
        expect.objectContaining({
          commission: "10.00",
          totalDebit: "110.00",
        }),
      );

      const balances = await db.query.users.findMany({
        where: inArray(users.id, [player!.id, receiver!.id]),
        columns: {
          id: true,
          mainBalance: true,
          winnerBalance: true,
        },
      });
      expect(balances.find((user) => user.id === player!.id)).toEqual(
        expect.objectContaining({
          mainBalance: "495.00",
          winnerBalance: "200.00",
        }),
      );
      expect(
        balances.find((user) => user.id === receiver!.id)?.mainBalance,
      ).toBe("100.00");

      const history = await request(app)
        .get("/api/wallet/history?pageSize=20")
        .set(playerHeaders);
      expect(history.status).toBe(200);
      expect(JSON.stringify(history.body)).not.toContain("accountEncrypted");
      expect(JSON.stringify(history.body)).not.toContain(
        "providerVerification",
      );
      expect(history.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "deposit", status: "paid" }),
          expect.objectContaining({
            type: "transfer",
            direction: "outgoing",
          }),
          expect.objectContaining({ type: "withdraw", status: "paid" }),
          expect.objectContaining({ type: "withdraw", status: "rejected" }),
        ]),
      );

      await db
        .update(users)
        .set({ mainBalance: "150" })
        .where(eq(users.id, player!.id));
      const concurrent = await Promise.allSettled([
        transferMainBalance({
          senderId: player!.id,
          receiverGameId: receiver!.gameId,
          amount: 100,
        }),
        transferMainBalance({
          senderId: player!.id,
          receiverGameId: receiver!.gameId,
          amount: 100,
        }),
      ]);
      expect(
        concurrent.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        concurrent.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const finalPlayer = await db.query.users.findFirst({
        where: eq(users.id, player!.id),
        columns: { mainBalance: true },
      });
      expect(finalPlayer?.mainBalance).toBe("40.00");
    } finally {
      await db
        .delete(adminAuditLogs)
        .where(inArray(adminAuditLogs.actorId, userIds));
      await db
        .delete(transactions)
        .where(inArray(transactions.userId, userIds));
      await db
        .delete(walletDocuments)
        .where(inArray(walletDocuments.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });
});
