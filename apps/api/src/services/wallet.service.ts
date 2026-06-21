import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import { db } from "../db/client.js";
import { config } from "../config.js";
import {
  adminAuditLogs,
  depositOffers,
  notifications,
  transactions,
  users,
  walletDocuments,
  type User,
} from "../db/schema.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import { toPublicUser } from "../lib/public-user.js";
import {
  createUddoktaCheckout,
  isCompletedUddoktaStatus,
  verifyUddoktaPayment,
} from "./uddoktapay.service.js";
import {
  createZiniPayCheckout,
  isCompletedZiniPayStatus,
  verifyZiniPayPayment,
} from "./zinipay.service.js";
import {
  getSettings,
  updateSettings,
  updateSettingsWithAudit,
} from "./settings.service.js";

/** Manual deposit (bKash/Nagad proof upload) — disabled site-wide. */
const MANUAL_DEPOSIT_ENABLED = false;

const walletSettingKeys = [
  "wallet.deposit_min",
  "wallet.deposit_max",
  "wallet.withdraw_min",
  "wallet.transfer_min",
  "wallet.transfer_commission_percent",
  "wallet.referral_commission_percent",
  "wallet.uddoktapay_enabled",
  "wallet.uddoktapay_base_url",
  "wallet.uddoktapay_api_key",
  "wallet.zinipay_enabled",
  "wallet.zinipay_base_url",
  "wallet.zinipay_api_key",
  "wallet.manual_deposit_enabled",
  "wallet.manual_methods",
  "wallet.withdraw_methods",
] as const;

const defaultOffers = [
  { amount: "100", bonusPercent: "5", sortOrder: 1 },
  { amount: "300", bonusPercent: "8", sortOrder: 2 },
  { amount: "500", bonusPercent: "10", sortOrder: 3 },
  { amount: "1000", bonusPercent: "15", sortOrder: 4 },
  { amount: "2000", bonusPercent: "20", sortOrder: 5 },
  { amount: "5000", bonusPercent: "25", sortOrder: 6 },
] as const;

interface WalletConfig {
  depositMin: number;
  depositMax: number;
  withdrawMin: number;
  transferMin: number;
  transferCommissionPercent: number;
  referralCommissionPercent: number;
  uddoktaPayEnabled: boolean;
  uddoktaPayBaseUrl: string;
  uddoktaPayApiKey: string;
  ziniPayEnabled: boolean;
  ziniPayBaseUrl: string;
  ziniPayApiKey: string;
  manualDepositEnabled: boolean;
  manualMethods: Array<{
    name: string;
    account: string;
    instructions?: string;
  }>;
  withdrawMethods: string[];
}

interface DepositResolution {
  amountCents: number;
  amount: string;
  bonusCents: number;
  bonusAmount: string;
  totalAmount: string;
}

function sanitizeTransactionMetadata(metadataValue: unknown) {
  const metadata =
    metadataValue && typeof metadataValue === "object"
      ? (metadataValue as Record<string, unknown>)
      : {};
  const {
    accountEncrypted: _accountEncrypted,
    providerVerification: _providerVerification,
    ...safeMetadata
  } = metadata;
  return {
    ...safeMetadata,
    accountLastFour: metadata.accountLastFour ?? null,
  };
}

type DatabaseTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

function settingNumber(
  values: Record<string, string>,
  key: (typeof walletSettingKeys)[number],
): number {
  const parsed = Number(values[key]);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppError(
      500,
      "INVALID_WALLET_SETTING",
      "Wallet configuration সঠিক নয়।",
    );
  }
  return parsed;
}

function parseManualMethods(value: string): WalletConfig["manualMethods"] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (
          item,
        ): item is {
          name: string;
          account: string;
          instructions?: string;
        } =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as { name?: unknown }).name === "string" &&
              typeof (item as { account?: unknown }).account === "string",
          ),
      )
      .slice(0, 10);
  } catch {
    return [];
  }
}

function parseWithdrawMethods(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return ["bKash", "Nagad", "Rocket"];
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length >= 2)
      .map((item) => item.trim())
      .slice(0, 12);
  } catch {
    return ["bKash", "Nagad", "Rocket"];
  }
}

export async function getWalletConfig(): Promise<WalletConfig> {
  const values = await getSettings(walletSettingKeys);
  const encryptedKey = values["wallet.uddoktapay_api_key"];
  const encryptedZiniPayKey = values["wallet.zinipay_api_key"];
  return {
    depositMin: settingNumber(values, "wallet.deposit_min"),
    depositMax: settingNumber(values, "wallet.deposit_max"),
    withdrawMin: settingNumber(values, "wallet.withdraw_min"),
    transferMin: settingNumber(values, "wallet.transfer_min"),
    transferCommissionPercent: settingNumber(
      values,
      "wallet.transfer_commission_percent",
    ),
    referralCommissionPercent: settingNumber(
      values,
      "wallet.referral_commission_percent",
    ),
    uddoktaPayEnabled: values["wallet.uddoktapay_enabled"] === "true",
    uddoktaPayBaseUrl: values["wallet.uddoktapay_base_url"] ?? "",
    uddoktaPayApiKey: encryptedKey ? decryptSecret(encryptedKey) : "",
    ziniPayEnabled: values["wallet.zinipay_enabled"] === "true",
    ziniPayBaseUrl: values["wallet.zinipay_base_url"] ?? "",
    ziniPayApiKey: encryptedZiniPayKey
      ? decryptSecret(encryptedZiniPayKey)
      : "",
    manualDepositEnabled:
      MANUAL_DEPOSIT_ENABLED &&
      values["wallet.manual_deposit_enabled"] === "true",
    manualMethods: parseManualMethods(values["wallet.manual_methods"] ?? "[]"),
    withdrawMethods: parseWithdrawMethods(
      values["wallet.withdraw_methods"] ?? "[\"bKash\",\"Nagad\",\"Rocket\"]",
    ),
  };
}

export function normalizeMoneyInput(value: string | number): string {
  const banglaDigits = "০১২৩৪৫৬৭৮৯";
  let text = String(value).trim().replace(/\s/g, "").replace(/,/g, "");
  text = text.replace(/[০-৯]/g, (digit) => String(banglaDigits.indexOf(digit)));
  const match = text.match(/^(\d{1,12})(?:\.(\d{0,2}))?/);
  if (!match) return text;
  return match[2] !== undefined && match[2] !== ""
    ? `${match[1]}.${match[2]}`
    : match[1]!;
}

export function moneyToCents(value: string | number): number {
  const normalized = normalizeMoneyInput(value);
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(normalized)) {
    throw new AppError(400, "INVALID_AMOUNT", "সঠিক টাকার পরিমাণ দিন।");
  }
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new AppError(400, "INVALID_AMOUNT", "সঠিক টাকার পরিমাণ দিন।");
  }
  return cents;
}

export function centsToMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

function percentAmountCents(amountCents: number, percent: number): number {
  return Math.round((amountCents * percent) / 100);
}

function limitAmountToCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AppError(
      500,
      "INVALID_WALLET_SETTING",
      "Wallet configuration সঠিক নয়।",
    );
  }
  return Math.round(amount * 100);
}

function assertRange(
  amountCents: number,
  minimum: number,
  maximum?: number,
): void {
  if (minimum > 0) {
    const minimumCents = limitAmountToCents(minimum);
    if (amountCents < minimumCents) {
      throw new AppError(
        400,
        "AMOUNT_BELOW_MINIMUM",
        `সর্বনিম্ন পরিমাণ ৳${minimum}।`,
      );
    }
  }
  if (maximum !== undefined && maximum > 0) {
    const maximumCents = limitAmountToCents(maximum);
    if (amountCents > maximumCents) {
      throw new AppError(
        400,
        "AMOUNT_ABOVE_MAXIMUM",
        `সর্বোচ্চ পরিমাণ ৳${maximum}।`,
      );
    }
  }
}

async function resolveDeposit(
  amountInput: string | number,
  offerId?: string,
): Promise<DepositResolution> {
  const config = await getWalletConfig();
  const amountCents = moneyToCents(amountInput);
  assertRange(amountCents, config.depositMin, config.depositMax);

  let bonusPercent = 0;
  if (offerId) {
    const offer = await db.query.depositOffers.findFirst({
      where: and(
        eq(depositOffers.id, offerId),
        eq(depositOffers.isActive, true),
      ),
    });
    if (!offer || moneyToCents(offer.amount) !== amountCents) {
      throw new AppError(
        400,
        "INVALID_DEPOSIT_OFFER",
        "নির্বাচিত ডিপোজিট অফারটি প্রযোজ্য নয়।",
      );
    }
    bonusPercent = Number(offer.bonusPercent);
  }
  const bonusCents = percentAmountCents(amountCents, bonusPercent);
  return {
    amountCents,
    amount: centsToMoney(amountCents),
    bonusCents,
    bonusAmount: centsToMoney(bonusCents),
    totalAmount: centsToMoney(amountCents + bonusCents),
  };
}

export async function ensureWalletDefaults(): Promise<void> {
  const seeded = await getSettings(["wallet.offers_seeded"] as const);
  if (seeded["wallet.offers_seeded"] === "true") return;
  await db
    .insert(depositOffers)
    .values([...defaultOffers])
    .onConflictDoNothing({ target: depositOffers.amount });
  await updateSettings({ "wallet.offers_seeded": "true" });
}

export async function ensureZiniPayFromEnv(): Promise<void> {
  const apiKey = config.ZINI_PAY_API_KEY?.trim();
  if (!apiKey) return;
  await updateSettings({
    "wallet.zinipay_enabled": "true",
    "wallet.zinipay_base_url": "https://api.zinipay.com",
    "wallet.zinipay_api_key": encryptSecret(apiKey),
  });
}

export async function getWalletOverview(userId: string) {
  const [user, offers, config, recentTransactions] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, userId) }),
      db.query.depositOffers.findMany({
        where: eq(depositOffers.isActive, true),
        orderBy: [asc(depositOffers.sortOrder), asc(depositOffers.amount)],
      }),
      getWalletConfig(),
      db.query.transactions.findMany({
        where: eq(transactions.userId, userId),
        orderBy: [desc(transactions.createdAt)],
        limit: 5,
      }),
    ]);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User পাওয়া যায়নি।");
  }

  return {
    user: toPublicUser(user),
    offers: offers.map((offer) => ({
      ...offer,
      bonusAmount: centsToMoney(
        percentAmountCents(
          moneyToCents(offer.amount),
          Number(offer.bonusPercent),
        ),
      ),
      totalAmount: centsToMoney(
        moneyToCents(offer.amount) +
          percentAmountCents(
            moneyToCents(offer.amount),
            Number(offer.bonusPercent),
          ),
      ),
    })),
    limits: {
      depositMin: config.depositMin,
      depositMax: config.depositMax,
      withdrawMin: config.withdrawMin,
      transferMin: config.transferMin,
      transferCommissionPercent: config.transferCommissionPercent,
    },
    methods: {
      uddoktaPay:
        config.uddoktaPayEnabled && Boolean(config.uddoktaPayApiKey),
      ziniPay: config.ziniPayEnabled && Boolean(config.ziniPayApiKey),
      manual: config.manualDepositEnabled,
      manualMethods: config.manualMethods,
      withdrawMethods: config.withdrawMethods,
    },
    recentTransactions: recentTransactions.map((transaction) => ({
      ...transaction,
      metadata: sanitizeTransactionMetadata(transaction.metadata),
    })),
  };
}

function detectImageMime(content: Buffer): string | null {
  if (
    content.length >= 8 &&
    content.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (
    content.length >= 3 &&
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    content.length >= 12 &&
    content.subarray(0, 4).toString("ascii") === "RIFF" &&
    content.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function storeWalletDocument(input: {
  userId: string;
  kind: "manual_deposit_proof";
  content: Buffer;
}) {
  const mimeType = detectImageMime(input.content);
  if (!mimeType || input.content.length === 0 || input.content.length > 5_242_880) {
    throw new AppError(
      400,
      "INVALID_DOCUMENT",
      "৫ MB-এর কম PNG, JPEG অথবা WebP ছবি দিন।",
    );
  }
  const [document] = await db
    .insert(walletDocuments)
    .values({
      userId: input.userId,
      kind: input.kind,
      mimeType,
      byteSize: input.content.length,
      contentHash: createHash("sha256").update(input.content).digest("hex"),
      content: input.content,
    })
    .returning({
      id: walletDocuments.id,
      kind: walletDocuments.kind,
      mimeType: walletDocuments.mimeType,
      byteSize: walletDocuments.byteSize,
      createdAt: walletDocuments.createdAt,
    });
  return document!;
}

export async function getWalletDocument(
  documentId: string,
  requester: User,
) {
  const document = await db.query.walletDocuments.findFirst({
    where: eq(walletDocuments.id, documentId),
  });
  if (
    !document ||
    (document.userId !== requester.id &&
      !requester.isAdmin &&
      !requester.isSubAdmin)
  ) {
    throw new AppError(404, "DOCUMENT_NOT_FOUND", "Document পাওয়া যায়নি।");
  }
  return document;
}

async function assertOwnedDocument(
  transaction: DatabaseTransaction,
  userId: string,
  documentId: string,
  kind: "manual_deposit_proof",
) {
  const document = await transaction.query.walletDocuments.findFirst({
    where: and(
      eq(walletDocuments.id, documentId),
      eq(walletDocuments.userId, userId),
      eq(walletDocuments.kind, kind),
    ),
    columns: { id: true },
  });
  if (!document) {
    throw new AppError(
      400,
      "INVALID_DOCUMENT",
      "সঠিক document নির্বাচন করুন।",
    );
  }
}

export async function createManualDeposit(input: {
  userId: string;
  amount: string | number;
  offerId?: string;
  method: string;
  documentId: string;
}) {
  const config = await getWalletConfig();
  if (!config.manualDepositEnabled) {
    throw new AppError(
      503,
      "MANUAL_DEPOSIT_DISABLED",
      "Manual deposit এখন বন্ধ আছে।",
    );
  }
  if (
    config.manualMethods.length > 0 &&
    !config.manualMethods.some((method) => method.name === input.method)
  ) {
    throw new AppError(
      400,
      "INVALID_PAYMENT_METHOD",
      "সঠিক payment method নির্বাচন করুন।",
    );
  }
  const resolved = await resolveDeposit(input.amount, input.offerId);
  return db.transaction(async (transaction) => {
    await assertOwnedDocument(
      transaction,
      input.userId,
      input.documentId,
      "manual_deposit_proof",
    );
    const [created] = await transaction
      .insert(transactions)
      .values({
        userId: input.userId,
        type: "deposit",
        amount: resolved.amount,
        bonusAmount: resolved.bonusAmount,
        status: "pending",
        method: input.method,
        provider: "manual",
        balanceSource: "main",
        relatedDocumentId: input.documentId,
        reference: `manual-${randomUUID()}`,
        metadata: {
          offerId: input.offerId ?? null,
          totalAmount: resolved.totalAmount,
        },
      })
      .returning();
    await transaction.insert(notifications).values({
      userId: input.userId,
      title: "ডিপোজিট pending",
      message: `৳${resolved.amount} admin approval-এর অপেক্ষায় আছে।`,
    });
    return created!;
  });
}

export async function createAutoDeposit(input: {
  user: User;
  amount: string | number;
  offerId?: string;
  provider?: "uddoktapay" | "zinipay";
}) {
  const config = await getWalletConfig();
  const provider = input.provider ?? "zinipay";
  const providerReady =
    provider === "uddoktapay"
      ? config.uddoktaPayEnabled && Boolean(config.uddoktaPayApiKey)
      : config.ziniPayEnabled && Boolean(config.ziniPayApiKey);
  if (!providerReady) {
    throw new AppError(
      503,
      "AUTO_DEPOSIT_DISABLED",
      "Auto deposit এখন চালু নেই।",
    );
  }
  const resolved = await resolveDeposit(input.amount, input.offerId);
  const [created] = await db
    .insert(transactions)
    .values({
      userId: input.user.id,
      type: "deposit",
      amount: resolved.amount,
      bonusAmount: resolved.bonusAmount,
      status: "pending",
      method: provider === "uddoktapay" ? "Uddokta Pay" : "ZiniPay",
      provider,
      balanceSource: "main",
      reference: `${provider}-${randomUUID()}`,
      metadata: {
        offerId: input.offerId ?? null,
        totalAmount: resolved.totalAmount,
      },
    })
    .returning();

  try {
    if (provider === "uddoktapay") {
      const paymentUrl = await createUddoktaCheckout(
        {
          apiKey: config.uddoktaPayApiKey,
          baseUrl: config.uddoktaPayBaseUrl,
        },
        {
          transactionId: created!.id,
          userId: input.user.id,
          gameId: input.user.gameId,
          name: input.user.name,
          email: input.user.email,
          amount: resolved.amount,
        },
      );
      return { transaction: created!, paymentUrl };
    }
    const invoice = await createZiniPayCheckout(
      {
        apiKey: config.ziniPayApiKey,
        baseUrl: config.ziniPayBaseUrl,
      },
      {
        transactionId: created!.id,
        userId: input.user.id,
        gameId: input.user.gameId,
        name: input.user.name,
        email: input.user.email,
        amount: resolved.amount,
      },
    );
    if (!invoice.invoiceId) {
      throw new AppError(
        502,
        "PAYMENT_INVOICE_MISSING",
        "ZiniPay invoice ID পাওয়া যায়নি।",
      );
    }
    const [updated] = await db
      .update(transactions)
      .set({
        providerInvoiceId: invoice.invoiceId,
        metadata: {
          ...(created!.metadata as Record<string, unknown>),
          providerCreate: invoice.raw,
        },
      })
      .where(eq(transactions.id, created!.id))
      .returning();
    return { transaction: updated ?? created!, paymentUrl: invoice.paymentUrl };
  } catch (error) {
    await db
      .update(transactions)
      .set({
        status: "failed",
        failureReason:
          error instanceof Error ? error.message.slice(0, 500) : "Provider error",
      })
      .where(eq(transactions.id, created!.id));
    throw error;
  }
}

async function addReferralCommission(
  transaction: DatabaseTransaction,
  depositedUser: User,
  depositAmountCents: number,
  referralPercent: number,
): Promise<{ referrerId: string; amount: string } | null> {
  if (!depositedUser.referredBy || referralPercent <= 0) return null;
  const commissionCents = percentAmountCents(
    depositAmountCents,
    referralPercent,
  );
  if (commissionCents <= 0) return null;
  const commission = centsToMoney(commissionCents);
  const [referrer] = await transaction
    .select()
    .from(users)
    .where(eq(users.id, depositedUser.referredBy))
    .for("update");
  if (!referrer) return null;

  await transaction
    .update(users)
    .set({
      mainBalance: sql`${users.mainBalance} + cast(${commission} as numeric)`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, referrer.id));
  await transaction.insert(transactions).values({
    userId: referrer.id,
    type: "refer",
    amount: commission,
    status: "success",
    direction: "incoming",
    relatedUserId: depositedUser.id,
    balanceSource: "main",
    balanceAppliedAt: new Date(),
    reference: `refer-${randomUUID()}`,
  });
  await transaction.insert(notifications).values([
    {
      userId: referrer.id,
      title: "রেফার কমিশন পেয়েছেন",
      message: `${depositedUser.name}-এর ডিপোজিট থেকে ৳${commission} পেয়েছেন।`,
    },
    {
      userId: depositedUser.id,
      title: "রেফার কমিশন সম্পন্ন",
      message: "আপনার ডিপোজিট থেকে referrer কমিশন পেয়েছেন।",
    },
  ]);
  return { referrerId: referrer.id, amount: commission };
}

async function applyDeposit(
  transaction: DatabaseTransaction,
  depositId: string,
  input: {
    reviewerId?: string;
    providerInvoiceId?: string;
    providerPayload?: Record<string, unknown>;
    expectedProvider?: "manual" | "uddoktapay" | "zinipay";
  },
) {
  const [deposit] = await transaction
    .select()
    .from(transactions)
    .where(eq(transactions.id, depositId))
    .for("update");
  if (!deposit || deposit.type !== "deposit") {
    throw new AppError(404, "DEPOSIT_NOT_FOUND", "Deposit পাওয়া যায়নি।");
  }
  if (input.expectedProvider && deposit.provider !== input.expectedProvider) {
    throw new AppError(
      409,
      "DEPOSIT_PROVIDER_MISMATCH",
      "Deposit provider মিলছে না।",
    );
  }
  if (deposit.balanceAppliedAt) {
    const user = await transaction.query.users.findFirst({
      where: eq(users.id, deposit.userId),
    });
    return { deposit, user: user!, referral: null, alreadyApplied: true };
  }
  if (deposit.status !== "pending") {
    throw new AppError(
      409,
      "DEPOSIT_NOT_PENDING",
      "Deposit আর pending অবস্থায় নেই।",
    );
  }

  const [user] = await transaction
    .select()
    .from(users)
    .where(eq(users.id, deposit.userId))
    .for("update");
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User পাওয়া যায়নি।");
  }
  const totalCents =
    moneyToCents(deposit.amount) + Number(deposit.bonusAmount) * 100;
  const totalAmount = centsToMoney(Math.round(totalCents));
  const now = new Date();
  const [updatedUser] = await transaction
    .update(users)
    .set({
      mainBalance: sql`${users.mainBalance} + cast(${totalAmount} as numeric)`,
      updatedAt: now,
    })
    .where(eq(users.id, user.id))
    .returning();
  const [updatedDeposit] = await transaction
    .update(transactions)
    .set({
      status: "paid",
      balanceAppliedAt: now,
      reviewedBy: input.reviewerId,
      reviewedAt: input.reviewerId ? now : undefined,
      providerInvoiceId: input.providerInvoiceId,
      metadata: {
        ...(deposit.metadata as Record<string, unknown>),
        ...(input.providerPayload
          ? { providerVerification: input.providerPayload }
          : {}),
      },
    })
    .where(eq(transactions.id, deposit.id))
    .returning();
  const config = await getWalletConfig();
  const referral = await addReferralCommission(
    transaction,
    user,
    moneyToCents(deposit.amount),
    config.referralCommissionPercent,
  );
  await transaction.insert(notifications).values({
    userId: user.id,
    title: "ডিপোজিট সফল",
    message: `৳${totalAmount} Main Balance-এ যোগ হয়েছে।`,
  });
  return {
    deposit: updatedDeposit!,
    user: updatedUser!,
    referral,
    alreadyApplied: false,
  };
}

export async function reviewManualDeposit(input: {
  depositId: string;
  approve: boolean;
  actorId: string;
  ipAddress: string;
  reason?: string;
}) {
  if (input.approve) {
    return db.transaction(async (transaction) => {
      const result = await applyDeposit(transaction, input.depositId, {
        reviewerId: input.actorId,
        expectedProvider: "manual",
      });
      await transaction.insert(adminAuditLogs).values({
        actorId: input.actorId,
        action: "wallet.deposit.approve",
        targetType: "transaction",
        targetId: input.depositId,
        ipAddress: input.ipAddress,
        details: {},
      });
      return result;
    });
  }

  return db.transaction(async (transaction) => {
    const [deposit] = await transaction
      .select()
      .from(transactions)
      .where(eq(transactions.id, input.depositId))
      .for("update");
    if (
      !deposit ||
      deposit.type !== "deposit" ||
      deposit.provider !== "manual" ||
      deposit.status !== "pending"
    ) {
      throw new AppError(
        409,
        "DEPOSIT_NOT_PENDING",
        "Pending manual deposit পাওয়া যায়নি।",
      );
    }
    const [updated] = await transaction
      .update(transactions)
      .set({
        status: "rejected",
        failureReason: input.reason ?? "Rejected by admin",
        reviewedBy: input.actorId,
        reviewedAt: new Date(),
      })
      .where(eq(transactions.id, deposit.id))
      .returning();
    await transaction.insert(notifications).values({
      userId: deposit.userId,
      title: "ডিপোজিট বাতিল হয়েছে",
      message: input.reason ?? "Payment proof যাচাই করা যায়নি।",
    });
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: "wallet.deposit.reject",
      targetType: "transaction",
      targetId: deposit.id,
      ipAddress: input.ipAddress,
      details: { reason: input.reason ?? null },
    });
    return { deposit: updated!, userId: deposit.userId };
  });
}

function safeSecretMatch(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function completeUddoktaDeposit(input: {
  invoiceId: string;
  webhookApiKey?: string;
}) {
  const config = await getWalletConfig();
  if (!config.uddoktaPayEnabled || !config.uddoktaPayApiKey) {
    throw new AppError(
      503,
      "AUTO_DEPOSIT_DISABLED",
      "Auto deposit এখন চালু নেই।",
    );
  }
  if (input.webhookApiKey !== undefined) {
    if (
      !input.webhookApiKey ||
      !safeSecretMatch(input.webhookApiKey, config.uddoktaPayApiKey)
    ) {
      throw new AppError(401, "INVALID_WEBHOOK_KEY", "Invalid webhook key.");
    }
  }
  const verified = await verifyUddoktaPayment(
    {
      apiKey: config.uddoktaPayApiKey,
      baseUrl: config.uddoktaPayBaseUrl,
    },
    input.invoiceId,
  );
  if (!isCompletedUddoktaStatus(verified.status)) {
    throw new AppError(
      409,
      "PAYMENT_NOT_COMPLETED",
      "Payment এখনো completed হয়নি।",
    );
  }
  if (!verified.transactionId) {
    throw new AppError(
      400,
      "PAYMENT_METADATA_MISSING",
      "Payment metadata পাওয়া যায়নি।",
    );
  }

  return db.transaction(async (transaction) => {
    const deposit = await transaction.query.transactions.findFirst({
      where: eq(transactions.id, verified.transactionId!),
    });
    if (
      !deposit ||
      deposit.provider !== "uddoktapay" ||
      deposit.userId !== verified.userId
    ) {
      throw new AppError(
        400,
        "PAYMENT_TRANSACTION_MISMATCH",
        "Payment transaction মিলছে না।",
      );
    }
    if (moneyToCents(deposit.amount) !== moneyToCents(verified.amount)) {
      throw new AppError(
        400,
        "PAYMENT_AMOUNT_MISMATCH",
        "Payment amount মিলছে না।",
      );
    }
    return applyDeposit(transaction, deposit.id, {
      providerInvoiceId: verified.invoiceId,
      providerPayload: verified.raw,
      expectedProvider: "uddoktapay",
    });
  });
}

export async function completeZiniPayDeposit(input: {
  invoiceId: string;
  webhookApiKey?: string;
}) {
  const config = await getWalletConfig();
  if (!config.ziniPayEnabled || !config.ziniPayApiKey) {
    throw new AppError(
      503,
      "AUTO_DEPOSIT_DISABLED",
      "ZiniPay auto deposit এখন চালু নেই।",
    );
  }
  if (input.webhookApiKey !== undefined) {
    if (
      !input.webhookApiKey ||
      !safeSecretMatch(input.webhookApiKey, config.ziniPayApiKey)
    ) {
      throw new AppError(401, "INVALID_WEBHOOK_KEY", "Invalid webhook key.");
    }
  }
  const verified = await verifyZiniPayPayment(
    {
      apiKey: config.ziniPayApiKey,
      baseUrl: config.ziniPayBaseUrl,
    },
    input.invoiceId,
  );
  if (!isCompletedZiniPayStatus(verified.status)) {
    throw new AppError(
      409,
      "PAYMENT_NOT_COMPLETED",
      "Payment এখনো completed হয়নি।",
    );
  }

  return db.transaction(async (transaction) => {
    const deposit = verified.transactionId
      ? await transaction.query.transactions.findFirst({
          where: eq(transactions.id, verified.transactionId),
        })
      : await transaction.query.transactions.findFirst({
          where: and(
            eq(transactions.provider, "zinipay"),
            eq(transactions.providerInvoiceId, verified.invoiceId),
          ),
        });
    if (
      !deposit ||
      deposit.provider !== "zinipay" ||
      (verified.userId && deposit.userId !== verified.userId)
    ) {
      throw new AppError(
        400,
        "PAYMENT_TRANSACTION_MISMATCH",
        "Payment transaction মিলছে না।",
      );
    }
    if (moneyToCents(deposit.amount) !== moneyToCents(verified.amount)) {
      throw new AppError(
        400,
        "PAYMENT_AMOUNT_MISMATCH",
        "Payment amount মিলছে না।",
      );
    }
    return applyDeposit(transaction, deposit.id, {
      providerInvoiceId: verified.invoiceId,
      providerPayload: verified.raw,
      expectedProvider: "zinipay",
    });
  });
}

export async function createWithdrawal(input: {
  userId: string;
  amount: string | number;
  method: string;
  accountNumber: string;
}) {
  const config = await getWalletConfig();
  const amountCents = moneyToCents(input.amount);
  assertRange(amountCents, config.withdrawMin);
  if (
    config.withdrawMethods.length > 0 &&
    !config.withdrawMethods.includes(input.method)
  ) {
    throw new AppError(
      400,
      "INVALID_PAYMENT_METHOD",
      "সঠিক payment method নির্বাচন করুন।",
    );
  }
  const amount = centsToMoney(amountCents);
  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User পাওয়া যায়নি।");
    }
    if (moneyToCents(user.winnerBalance) < amountCents) {
      throw new AppError(
        409,
        "INSUFFICIENT_WINNER_BALANCE",
        "Withdrawal-এর জন্য Winner Balance পর্যাপ্ত নয়। খেলার Main Balance withdraw করা যাবে না।",
      );
    }
    const now = new Date();
    const [updatedUser] = await transaction
      .update(users)
      .set({
        winnerBalance: sql`${users.winnerBalance} - cast(${amount} as numeric)`,
        updatedAt: now,
      })
      .where(eq(users.id, user.id))
      .returning();
    const [withdrawal] = await transaction
      .insert(transactions)
      .values({
        userId: user.id,
        type: "withdraw",
        amount,
        status: "pending",
        method: input.method,
        balanceSource: "winner",
        balanceAppliedAt: now,
        reference: `withdraw-${randomUUID()}`,
        metadata: {
          accountEncrypted: encryptSecret(input.accountNumber),
          accountLastFour: input.accountNumber.slice(-4),
        },
      })
      .returning();
    await transaction.insert(notifications).values({
      userId: user.id,
      title: "Withdrawal pending",
      message: `৳${amount} admin approval-এর অপেক্ষায় reserve করা হয়েছে।`,
    });
    return { transaction: withdrawal!, user: updatedUser! };
  });
}

export async function cancelWithdrawal(input: {
  userId: string;
  withdrawalId: string;
}) {
  return db.transaction(async (transaction) => {
    const [withdrawal] = await transaction
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, input.withdrawalId),
          eq(transactions.userId, input.userId),
          eq(transactions.type, "withdraw"),
        ),
      )
      .for("update");
    if (!withdrawal) {
      throw new AppError(
        404,
        "WITHDRAWAL_NOT_FOUND",
        "Withdrawal পাওয়া যায়নি।",
      );
    }
    if (withdrawal.status !== "pending") {
      throw new AppError(
        409,
        "WITHDRAWAL_NOT_CANCELLABLE",
        "Pending withdrawal ছাড়া cancel করা যাবে না।",
      );
    }
    const now = new Date();
    const [updatedUser] = await transaction
      .update(users)
      .set({
        winnerBalance: sql`${users.winnerBalance} + cast(${withdrawal.amount} as numeric)`,
        updatedAt: now,
      })
      .where(eq(users.id, input.userId))
      .returning();
    const [updatedWithdrawal] = await transaction
      .update(transactions)
      .set({
        status: "rejected",
        failureReason: "Cancelled by user",
        refundedAt: now,
        reviewedAt: now,
      })
      .where(eq(transactions.id, withdrawal.id))
      .returning();
    await transaction.insert(notifications).values({
      userId: input.userId,
      title: "Withdrawal cancelled",
      message: `৳${withdrawal.amount} Winner Balance-এ ফেরত গেছে।`,
    });
    return { transaction: updatedWithdrawal!, user: updatedUser! };
  });
}

export async function reviewWithdrawal(input: {
  withdrawalId: string;
  status: "approved" | "rejected" | "paid";
  reason?: string;
  actorId: string;
  ipAddress: string;
}) {
  return db.transaction(async (transaction) => {
    const [withdrawal] = await transaction
      .select()
      .from(transactions)
      .where(eq(transactions.id, input.withdrawalId))
      .for("update");
    if (!withdrawal || withdrawal.type !== "withdraw") {
      throw new AppError(
        404,
        "WITHDRAWAL_NOT_FOUND",
        "Withdrawal পাওয়া যায়নি।",
      );
    }
    const allowed =
      (withdrawal.status === "pending" &&
        (input.status === "approved" ||
          input.status === "rejected" ||
          input.status === "paid")) ||
      (withdrawal.status === "approved" &&
        (input.status === "paid" || input.status === "rejected"));
    if (!allowed) {
      throw new AppError(
        409,
        "INVALID_WITHDRAWAL_STATUS",
        "Withdrawal status transition সঠিক নয়।",
      );
    }

    let updatedUser: User | undefined;
    const now = new Date();
    if (input.status === "rejected" && !withdrawal.refundedAt) {
      [updatedUser] = await transaction
        .update(users)
        .set({
          winnerBalance: sql`${users.winnerBalance} + cast(${withdrawal.amount} as numeric)`,
          updatedAt: now,
        })
        .where(eq(users.id, withdrawal.userId))
        .returning();
    }
    const [updatedWithdrawal] = await transaction
      .update(transactions)
      .set({
        status: input.status,
        failureReason:
          input.status === "rejected" ? (input.reason ?? "Rejected") : null,
        refundedAt:
          input.status === "rejected" ? (withdrawal.refundedAt ?? now) : undefined,
        reviewedBy: input.actorId,
        reviewedAt: now,
      })
      .where(eq(transactions.id, withdrawal.id))
      .returning();
    await transaction.insert(notifications).values({
      userId: withdrawal.userId,
      title:
        input.status === "rejected"
          ? "Withdrawal rejected"
          : input.status === "paid"
            ? "Withdrawal paid"
            : `Withdrawal ${input.status}`,
      message:
        input.status === "rejected"
          ? `${input.reason ?? "Request rejected"}; টাকা Winner Balance-এ ফেরত গেছে।`
          : `৳${withdrawal.amount} withdrawal ${input.status} হয়েছে।`,
    });
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: `wallet.withdraw.${input.status}`,
      targetType: "transaction",
      targetId: withdrawal.id,
      ipAddress: input.ipAddress,
      details: { reason: input.reason ?? null },
    });
    return {
      transaction: updatedWithdrawal!,
      user: updatedUser,
      userId: withdrawal.userId,
    };
  });
}

export async function resolveTransferReceiver(
  senderId: string,
  gameId: string,
) {
  const receiver = await db.query.users.findFirst({
    where: and(eq(users.gameId, gameId), eq(users.isBot, false)),
    columns: { id: true, gameId: true, name: true, avatar: true },
  });
  if (!receiver || receiver.id === senderId) {
    throw new AppError(
      404,
      "RECEIVER_NOT_FOUND",
      "Receiver Game ID পাওয়া যায়নি।",
    );
  }
  return receiver;
}

export async function transferMainBalance(input: {
  senderId: string;
  receiverGameId: string;
  amount: string | number;
}) {
  const config = await getWalletConfig();
  const amountCents = moneyToCents(input.amount);
  assertRange(amountCents, config.transferMin);
  const commissionCents = percentAmountCents(
    amountCents,
    config.transferCommissionPercent,
  );
  const totalDebitCents = amountCents + commissionCents;
  const amount = centsToMoney(amountCents);
  const commission = centsToMoney(commissionCents);
  const totalDebit = centsToMoney(totalDebitCents);

  return db.transaction(async (transaction) => {
    const receiver = await transaction.query.users.findFirst({
      where: and(
        eq(users.gameId, input.receiverGameId),
        eq(users.isBot, false),
      ),
      columns: { id: true },
    });
    if (!receiver || receiver.id === input.senderId) {
      throw new AppError(
        404,
        "RECEIVER_NOT_FOUND",
        "Receiver Game ID পাওয়া যায়নি।",
      );
    }
    const lockedUsers = await transaction
      .select()
      .from(users)
      .where(inArray(users.id, [input.senderId, receiver.id].sort()))
      .orderBy(asc(users.id))
      .for("update");
    const sender = lockedUsers.find((user) => user.id === input.senderId);
    const lockedReceiver = lockedUsers.find(
      (user) => user.id === receiver.id,
    );
    if (!sender || !lockedReceiver) {
      throw new AppError(404, "USER_NOT_FOUND", "User পাওয়া যায়নি।");
    }
    if (moneyToCents(sender.mainBalance) < totalDebitCents) {
      throw new AppError(
        409,
        "INSUFFICIENT_MAIN_BALANCE",
        "Main Balance-এ transfer ও commission-এর টাকা নেই।",
      );
    }

    const now = new Date();
    const groupId = randomUUID();
    const [updatedSender] = await transaction
      .update(users)
      .set({
        mainBalance: sql`${users.mainBalance} - cast(${totalDebit} as numeric)`,
        updatedAt: now,
      })
      .where(eq(users.id, sender.id))
      .returning();
    const [updatedReceiver] = await transaction
      .update(users)
      .set({
        mainBalance: sql`${users.mainBalance} + cast(${amount} as numeric)`,
        updatedAt: now,
      })
      .where(eq(users.id, lockedReceiver.id))
      .returning();
    const created = await transaction
      .insert(transactions)
      .values([
        {
          userId: sender.id,
          type: "transfer" as const,
          amount,
          status: "success" as const,
          direction: "outgoing" as const,
          relatedUserId: lockedReceiver.id,
          groupId,
          method: "Game ID",
          commissionAmount: commission,
          balanceSource: "main" as const,
          balanceAppliedAt: now,
          reference: `transfer-out-${groupId}`,
        },
        {
          userId: lockedReceiver.id,
          type: "transfer" as const,
          amount,
          status: "success" as const,
          direction: "incoming" as const,
          relatedUserId: sender.id,
          groupId,
          method: "Game ID",
          balanceSource: "main" as const,
          balanceAppliedAt: now,
          reference: `transfer-in-${groupId}`,
        },
      ])
      .returning();
    await transaction.insert(notifications).values([
      {
        userId: sender.id,
        title: "Balance transfer সফল",
        message: `${lockedReceiver.name}-কে ৳${amount} পাঠানো হয়েছে। Commission ৳${commission}।`,
      },
      {
        userId: lockedReceiver.id,
        title: "Balance পেয়েছেন",
        message: `${sender.name} আপনাকে ৳${amount} পাঠিয়েছেন।`,
      },
    ]);
    return {
      sender: updatedSender!,
      receiver: updatedReceiver!,
      transactions: created,
      commission,
      totalDebit,
    };
  });
}

export async function getWalletHistory(input: {
  userId: string;
  type?:
    | "deposit"
    | "withdraw"
    | "transfer"
    | "prize"
    | "refer"
    | "bonus"
    | "tournament_fee"
    | "tournament_refund";
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}) {
  const conditions = [eq(transactions.userId, input.userId)];
  if (input.type) conditions.push(eq(transactions.type, input.type));
  if (input.from) conditions.push(gte(transactions.createdAt, input.from));
  if (input.to) conditions.push(lte(transactions.createdAt, input.to));

  const [items, countRows] = await Promise.all([
    db.query.transactions.findMany({
      where: and(...conditions),
      orderBy: [desc(transactions.createdAt)],
      limit: input.pageSize,
      offset: input.page * input.pageSize,
    }),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(...conditions)),
  ]);
  const relatedIds = [
    ...new Set(
      items
        .map((item) => item.relatedUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const relatedUsers =
    relatedIds.length > 0
      ? await db.query.users.findMany({
          where: inArray(users.id, relatedIds),
          columns: { id: true, name: true, gameId: true },
        })
      : [];
  const relatedMap = new Map(relatedUsers.map((user) => [user.id, user]));
  return {
    items: items.map((item) => {
      const metadata =
        item.metadata && typeof item.metadata === "object"
          ? (item.metadata as Record<string, unknown>)
          : {};
      return {
        ...item,
        metadata: sanitizeTransactionMetadata(metadata),
        otherParty: item.relatedUserId
          ? (relatedMap.get(item.relatedUserId) ?? null)
          : null,
      };
    }),
    page: input.page,
    pageSize: input.pageSize,
    total: countRows[0]?.total ?? 0,
  };
}

const adminWalletHistoryTypes = ["deposit", "withdraw", "transfer"] as const;

export async function getAdminAllTransactions(input: {
  type?: (typeof adminWalletHistoryTypes)[number];
  page: number;
  pageSize: number;
}) {
  const conditions = [
    inArray(
      transactions.type,
      input.type ? [input.type] : [...adminWalletHistoryTypes],
    ),
  ];

  const [items, countRows] = await Promise.all([
    db
      .select({
        transaction: transactions,
        user: {
          id: users.id,
          gameId: users.gameId,
          name: users.name,
          phone: users.phone,
        },
      })
      .from(transactions)
      .innerJoin(users, eq(transactions.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt))
      .limit(input.pageSize)
      .offset(input.page * input.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(...conditions)),
  ]);

  return {
    items: items.map((row) => {
      const metadata =
        row.transaction.metadata &&
        typeof row.transaction.metadata === "object"
          ? (row.transaction.metadata as Record<string, unknown>)
          : {};
      return {
        ...row.transaction,
        metadata: sanitizeTransactionMetadata(metadata),
        user: row.user,
      };
    }),
    page: input.page,
    pageSize: input.pageSize,
    total: countRows[0]?.total ?? 0,
  };
}

export async function clearAdminTransactionHistory(input: {
  actorId: string;
  ipAddress: string;
}) {
  return db.transaction(async (transaction) => {
    const deleted = await transaction
      .delete(transactions)
      .where(inArray(transactions.type, [...adminWalletHistoryTypes]))
      .returning({ id: transactions.id });
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: "wallet.transactions.clear",
      targetType: "transaction",
      targetId: null,
      ipAddress: input.ipAddress,
      details: { deletedCount: deleted.length },
    });
    return { deletedCount: deleted.length };
  });
}

export async function getAdminWalletQueue(type: "deposit" | "withdraw") {
  const rows = await db
    .select({
      transaction: transactions,
      user: {
        id: users.id,
        gameId: users.gameId,
        name: users.name,
        phone: users.phone,
      },
    })
    .from(transactions)
    .innerJoin(users, eq(transactions.userId, users.id))
    .where(
      and(
        eq(transactions.type, type),
        inArray(transactions.status, ["pending", "approved"]),
      ),
    )
    .orderBy(asc(transactions.createdAt))
    .limit(100);
  return rows.map((row) => {
    const metadata =
      row.transaction.metadata &&
      typeof row.transaction.metadata === "object"
        ? (row.transaction.metadata as Record<string, unknown>)
        : {};
    return {
      ...row,
      transaction: {
        ...row.transaction,
        metadata: sanitizeTransactionMetadata(metadata),
      },
    };
  });
}

export async function getAdminWithdrawalDetails(withdrawalId: string) {
  const withdrawal = await db.query.transactions.findFirst({
    where: and(
      eq(transactions.id, withdrawalId),
      eq(transactions.type, "withdraw"),
    ),
  });
  if (!withdrawal) {
    throw new AppError(
      404,
      "WITHDRAWAL_NOT_FOUND",
      "Withdrawal পাওয়া যায়নি।",
    );
  }
  const metadata =
    withdrawal.metadata && typeof withdrawal.metadata === "object"
      ? (withdrawal.metadata as Record<string, unknown>)
      : {};
  return {
    ...withdrawal,
    metadata: {
      ...metadata,
      accountNumber:
        typeof metadata.accountEncrypted === "string"
          ? decryptSecret(metadata.accountEncrypted)
          : null,
      accountEncrypted: undefined,
    },
  };
}

export async function updateWalletSettings(input: {
  actorId: string;
  ipAddress: string;
  depositMin?: number;
  depositMax?: number;
  withdrawMin?: number;
  transferMin?: number;
  transferCommissionPercent?: number;
  referralCommissionPercent?: number;
  uddoktaPayEnabled?: boolean;
  uddoktaPayBaseUrl?: string;
  uddoktaPayApiKey?: string;
  ziniPayEnabled?: boolean;
  ziniPayBaseUrl?: string;
  ziniPayApiKey?: string;
  manualDepositEnabled?: boolean;
  manualMethods?: WalletConfig["manualMethods"];
  withdrawMethods?: string[];
}) {
  const current = await getWalletConfig();
  const depositMin = input.depositMin ?? current.depositMin;
  const depositMax = input.depositMax ?? current.depositMax;
  if (depositMin > depositMax) {
    throw new AppError(
      400,
      "INVALID_DEPOSIT_LIMITS",
      "Minimum deposit maximum-এর বেশি হতে পারবে না।",
    );
  }
  const values: Record<string, string> = {};
  if (input.depositMin !== undefined)
    values["wallet.deposit_min"] = String(input.depositMin);
  if (input.depositMax !== undefined)
    values["wallet.deposit_max"] = String(input.depositMax);
  if (input.withdrawMin !== undefined)
    values["wallet.withdraw_min"] = String(input.withdrawMin);
  if (input.transferMin !== undefined)
    values["wallet.transfer_min"] = String(input.transferMin);
  if (input.transferCommissionPercent !== undefined)
    values["wallet.transfer_commission_percent"] = String(
      input.transferCommissionPercent,
    );
  if (input.referralCommissionPercent !== undefined)
    values["wallet.referral_commission_percent"] = String(
      input.referralCommissionPercent,
    );
  if (input.uddoktaPayEnabled !== undefined)
    values["wallet.uddoktapay_enabled"] = String(input.uddoktaPayEnabled);
  if (input.uddoktaPayBaseUrl !== undefined)
    values["wallet.uddoktapay_base_url"] = input.uddoktaPayBaseUrl;
  if (input.uddoktaPayApiKey !== undefined && input.uddoktaPayApiKey !== "")
    values["wallet.uddoktapay_api_key"] = encryptSecret(
      input.uddoktaPayApiKey,
    );
  if (input.ziniPayEnabled !== undefined)
    values["wallet.zinipay_enabled"] = String(input.ziniPayEnabled);
  if (input.ziniPayBaseUrl !== undefined)
    values["wallet.zinipay_base_url"] = input.ziniPayBaseUrl;
  if (input.ziniPayApiKey !== undefined && input.ziniPayApiKey !== "")
    values["wallet.zinipay_api_key"] = encryptSecret(input.ziniPayApiKey);
  if (input.manualDepositEnabled !== undefined) {
    values["wallet.manual_deposit_enabled"] = MANUAL_DEPOSIT_ENABLED
      ? String(input.manualDepositEnabled)
      : "false";
  }
  if (input.manualMethods !== undefined)
    values["wallet.manual_methods"] = JSON.stringify(input.manualMethods);
  if (input.withdrawMethods !== undefined)
    values["wallet.withdraw_methods"] = JSON.stringify(
      input.withdrawMethods
        .map((method) => method.trim())
        .filter((method) => method.length >= 2)
        .slice(0, 12),
    );

  await updateSettingsWithAudit({
    values,
    actorId: input.actorId,
    ipAddress: input.ipAddress,
    action: "wallet.settings.update",
    targetType: "wallet_settings",
  });
  return getWalletAdminSettings();
}

export async function getWalletAdminSettings() {
  const config = await getWalletConfig();
  return {
    ...config,
    uddoktaPayApiKey: undefined,
    uddoktaPayApiKeyConfigured: Boolean(config.uddoktaPayApiKey),
    ziniPayApiKey: undefined,
    ziniPayApiKeyConfigured: Boolean(config.ziniPayApiKey),
  };
}

export async function listDepositOffers() {
  return db.query.depositOffers.findMany({
    orderBy: [asc(depositOffers.sortOrder), asc(depositOffers.amount)],
  });
}

export async function saveDepositOffer(input: {
  id?: string;
  amount: string | number;
  bonusPercent: number;
  isActive: boolean;
  sortOrder: number;
  actorId: string;
  ipAddress: string;
}) {
  const amount = centsToMoney(moneyToCents(input.amount));
  return db.transaction(async (transaction) => {
    let offer;
    if (input.id) {
      [offer] = await transaction
        .update(depositOffers)
        .set({
          amount,
          bonusPercent: String(input.bonusPercent),
          isActive: input.isActive,
          sortOrder: input.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(depositOffers.id, input.id))
        .returning();
      if (!offer) {
        throw new AppError(404, "OFFER_NOT_FOUND", "Offer পাওয়া যায়নি।");
      }
    } else {
      [offer] = await transaction
        .insert(depositOffers)
        .values({
          amount,
          bonusPercent: String(input.bonusPercent),
          isActive: input.isActive,
          sortOrder: input.sortOrder,
        })
        .returning();
    }
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: input.id ? "wallet.offer.update" : "wallet.offer.create",
      targetType: "deposit_offer",
      targetId: offer!.id,
      ipAddress: input.ipAddress,
      details: { amount, bonusPercent: input.bonusPercent },
    });
    return offer;
  });
}

export async function deleteDepositOffer(input: {
  offerId: string;
  actorId: string;
  ipAddress: string;
}): Promise<void> {
  await db.transaction(async (transaction) => {
    const deleted = await transaction
      .delete(depositOffers)
      .where(eq(depositOffers.id, input.offerId))
      .returning({ id: depositOffers.id });
    if (!deleted[0]) {
      throw new AppError(404, "OFFER_NOT_FOUND", "Offer পাওয়া যায়নি।");
    }
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: "wallet.offer.delete",
      targetType: "deposit_offer",
      targetId: input.offerId,
      ipAddress: input.ipAddress,
      details: {},
    });
  });
}
