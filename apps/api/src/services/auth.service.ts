import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  adminAuditLogs,
  authSessions,
  supportTickets,
  users,
  type User,
} from "../db/schema.js";
import {
  generateGameId,
  generateReferCode,
  sha256,
} from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import { normalizeBangladeshPhone } from "../lib/phone.js";
import { assertLoginAllowed } from "./ban.service.js";
import { defaultPresetAvatar } from "../lib/avatars.js";

interface GoogleIdentity {
  googleId: string;
  name: string;
  email: string;
  avatar?: string;
}

function defaultForestAvatar(gameId: string) {
  return defaultPresetAvatar(gameId);
}

async function generateUniqueUserKeys(): Promise<{
  gameId: string;
  referCode: string;
}> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const gameId = generateGameId();
    const referCode = generateReferCode();
    const existing = await db.query.users.findFirst({
      where: or(eq(users.gameId, gameId), eq(users.referCode, referCode)),
      columns: { id: true },
    });
    if (!existing) return { gameId, referCode };
  }

  throw new AppError(
    503,
    "IDENTITY_ALLOCATION_FAILED",
    "নতুন Game ID তৈরি করা যায়নি। আবার চেষ্টা করুন।",
  );
}

export async function registerUserDirect(input: {
  phone: string;
  name: string;
  password: string;
  email?: string;
  referCode?: string;
}): Promise<User> {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return db.transaction(async (transaction) => {
    const duplicate = await transaction.query.users.findFirst({
      where: input.email
        ? or(eq(users.phone, input.phone), eq(users.email, input.email))
        : eq(users.phone, input.phone),
      columns: { phone: true, email: true },
    });

    if (duplicate?.phone === input.phone) {
      throw new AppError(
        409,
        "PHONE_EXISTS",
        "An account already exists with this phone number.",
      );
    }
    if (input.email && duplicate?.email === input.email) {
      throw new AppError(
        409,
        "EMAIL_EXISTS",
        "An account already exists with this email address.",
      );
    }

    let referredBy: string | undefined;
    if (input.referCode) {
      const referrer = await transaction.query.users.findFirst({
        where: eq(users.referCode, input.referCode),
        columns: { id: true },
      });
      if (!referrer) {
        throw new AppError(
          400,
          "INVALID_REFER_CODE",
          "Referral code is not valid.",
        );
      }
      referredBy = referrer.id;
    }

    const keys = await generateUniqueUserKeys();
    const [createdUser] = await transaction
      .insert(users)
      .values({
        ...keys,
        name: input.name,
        phone: input.phone,
        passwordHash,
        email: input.email,
        referredBy,
        avatar: defaultForestAvatar(keys.gameId),
      })
      .returning();

    if (!createdUser) {
      throw new AppError(
        500,
        "REGISTRATION_FAILED",
        "The account could not be created.",
      );
    }

    return createdUser;
  });
}

export async function registerGuestUser(deviceId?: string): Promise<User> {
  if (deviceId) {
    const existing = await db.query.users.findFirst({
      where: and(
        eq(users.deviceId, deviceId),
        eq(users.isGuest, true),
        eq(users.isBanned, false),
      ),
      orderBy: (table, { desc }) => [desc(table.updatedAt)],
    });
    if (existing) return existing;
  }
  const keys = await generateUniqueUserKeys();
  const [createdUser] = await db
    .insert(users)
    .values({
      ...keys,
      name: `Guest ${keys.gameId}`,
      isGuest: true,
      deviceId,
      avatar: defaultForestAvatar(keys.gameId),
    })
    .returning();

  if (!createdUser) {
    throw new AppError(
      500,
      "GUEST_REGISTRATION_FAILED",
      "Guest account could not be created.",
    );
  }

  return createdUser;
}

export async function authenticatePassword(
  phone: string,
  password: string,
): Promise<User> {
  const user = await db.query.users.findFirst({
    where: eq(users.phone, phone),
  });
  const valid =
    user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));

  if (!user || !valid) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "ফোন নম্বর অথবা পাসওয়ার্ড সঠিক নয়।",
    );
  }

  return user;
}

export async function authenticateAdminPassword(
  identifier: string,
  password: string,
): Promise<User> {
  const trimmedIdentifier = identifier.trim();
  const phoneCandidates = new Set<string>([trimmedIdentifier]);
  if (/^[+0-9 -]+$/.test(trimmedIdentifier)) {
    const compactPhone = trimmedIdentifier.replace(/[^\d+]/g, "");
    if (compactPhone) phoneCandidates.add(compactPhone);
    try {
      phoneCandidates.add(normalizeBangladeshPhone(trimmedIdentifier));
    } catch {
      // Keep username login working even when the identifier only looks phone-like.
    }
  }

  const user = await db.query.users.findFirst({
    where: or(
      eq(users.username, trimmedIdentifier.toLowerCase()),
      inArray(users.phone, Array.from(phoneCandidates)),
    ),
  });
  const valid =
    user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));

  if (!user || !valid || (!user.isAdmin && !user.isSubAdmin)) {
    throw new AppError(
      401,
      "INVALID_ADMIN_CREDENTIALS",
      "Admin username/phone or password is incorrect.",
    );
  }
  return user;
}

export async function requestPasswordHelp(
  phone: string,
  message?: string,
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.phone, phone),
    columns: { id: true },
  });

  if (!user) return;
  const existing = await db.query.supportTickets.findFirst({
    where: and(
      eq(supportTickets.userId, user.id),
      eq(supportTickets.subject, "Password recovery request"),
      or(
        eq(supportTickets.status, "open"),
        eq(supportTickets.status, "in_progress"),
      ),
    ),
    columns: { id: true },
  });
  if (existing) return;

  await db.insert(supportTickets).values({
    userId: user.id,
    subject: "Password recovery request",
    message:
      message?.trim() ||
      "The player requested a password reset from the login screen. Verify ownership before setting a new password.",
  });
}

export async function findOrCreateGoogleUser(
  identity: GoogleIdentity,
): Promise<User> {
  const existing = await db.query.users.findFirst({
    where: or(
      eq(users.googleId, identity.googleId),
      eq(users.email, identity.email),
    ),
  });

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        googleId: identity.googleId,
        avatar: existing.avatar || identity.avatar,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const keys = await generateUniqueUserKeys();
  const [created] = await db
    .insert(users)
    .values({
      ...keys,
      name: identity.name,
      email: identity.email,
      googleId: identity.googleId,
      avatar: identity.avatar ?? defaultForestAvatar(keys.gameId),
    })
    .returning();

  if (!created) {
    throw new AppError(500, "GOOGLE_LOGIN_FAILED", "Google login সম্পন্ন হয়নি।");
  }
  return created;
}

export async function issueSession(input: {
  user: User;
  ipAddress: string;
  deviceId: string;
}): Promise<{ token: string; sessionId: string }> {
  await assertLoginAllowed(input.ipAddress, input.deviceId, input.user.id);

  const sessionId = randomUUID();
  const expiresAt = new Date(
    Date.now() + config.JWT_EXPIRES_IN_SECONDS * 1_000,
  );
  const token = jwt.sign({}, config.JWT_SECRET, {
    algorithm: "HS256",
    subject: input.user.id,
    jwtid: sessionId,
    expiresIn: config.JWT_EXPIRES_IN_SECONDS,
    issuer: "khan-ludo-api",
    audience: "khan-ludo-web",
  });

  await db.transaction(async (transaction) => {
    await transaction.insert(authSessions).values({
      id: sessionId,
      userId: input.user.id,
      tokenHash: sha256(token),
      ipAddress: input.ipAddress,
      deviceId: input.deviceId,
      expiresAt,
    });
    await transaction
      .update(users)
      .set({
        ipAddress: input.ipAddress,
        deviceId: input.deviceId,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.user.id));
  });

  return { token, sessionId };
}

export async function authenticateSession(
  token: string,
  currentContext?: { ipAddress: string; deviceId: string },
): Promise<{ user: User; sessionId: string }> {
  let payload: JwtPayload;
  try {
    const verified = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "khan-ludo-api",
      audience: "khan-ludo-web",
    });
    if (typeof verified === "string") throw new Error("Invalid JWT payload");
    payload = verified;
  } catch {
    throw new AppError(401, "AUTH_REQUIRED", "আবার লগইন করুন।");
  }

  if (!payload.sub || !payload.jti) {
    throw new AppError(401, "AUTH_REQUIRED", "আবার লগইন করুন।");
  }

  const [result] = await db
    .select({ session: authSessions, user: users })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(
      and(
        eq(authSessions.id, payload.jti),
        eq(authSessions.userId, payload.sub),
        eq(authSessions.tokenHash, sha256(token)),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!result) {
    throw new AppError(401, "AUTH_REQUIRED", "আবার লগইন করুন।");
  }

  await assertLoginAllowed(
    result.session.ipAddress,
    result.session.deviceId,
    result.user.id,
  );
  if (currentContext) {
    if (currentContext.deviceId !== result.session.deviceId) {
      throw new AppError(
        401,
        "SESSION_DEVICE_MISMATCH",
        "This session belongs to another device. Please log in again.",
      );
    }
    await assertLoginAllowed(
      currentContext.ipAddress,
      currentContext.deviceId,
      result.user.id,
    );
  }
  return { user: result.user, sessionId: result.session.id };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(eq(authSessions.id, sessionId));
}

export async function isAdminClaimAvailable(): Promise<boolean> {
  const admin = await db.query.users.findFirst({
    where: eq(users.isAdmin, true),
    columns: { id: true },
  });
  return !admin;
}

export async function claimFirstAdmin(
  userId: string,
  ipAddress: string,
): Promise<User> {
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('khan-ludo-first-admin'))`,
    );

    const existingAdmin = await transaction.query.users.findFirst({
      where: eq(users.isAdmin, true),
      columns: { id: true },
    });
    if (existingAdmin) {
      throw new AppError(
        409,
        "ADMIN_ALREADY_CLAIMED",
        "Admin claim ইতিমধ্যে সম্পন্ন হয়েছে।",
      );
    }

    const claimant = await transaction.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, isGuest: true },
    });
    if (!claimant) {
      throw new AppError(404, "USER_NOT_FOUND", "User পাওয়া যায়নি।");
    }
    if (claimant.isGuest) {
      throw new AppError(
        403,
        "GUEST_ADMIN_FORBIDDEN",
        "Guest account থেকে Admin claim করা যাবে না।",
      );
    }

    const [user] = await transaction
      .update(users)
      .set({ isAdmin: true, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User পাওয়া যায়নি।");
    }
    await transaction.insert(adminAuditLogs).values({
      actorId: user.id,
      action: "admin.first_claim",
      targetType: "user",
      targetId: user.id,
      ipAddress,
      details: {},
    });
    return user;
  });
}
