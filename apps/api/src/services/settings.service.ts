import { randomInt } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  adminAuditLogs,
  botPlayers,
  settings,
  users,
} from "../db/schema.js";
import { presetAvatarPath } from "../lib/avatars.js";

export const homeSettingDefaults = {
  "site.name": "PrizeJito.com",
  "site.logo_url": "/prizejito-logo.png",
  "site.theme_preset": "forest",
  "site.primary_color": "#29a056",
  "site.secondary_color": "#0b3d24",
  "site.button_color": "#1d6b3f",
  "site.card_color": "#081d12",
  "site.background_color": "#07100c",
  "site.accent_color": "#5cdb8b",
  "site.maintenance_enabled": "false",
  "site.maintenance_message": "PrizeJito.com is temporarily under maintenance.",
  "home.max_win_amount": "10000",
  "home.marquee_speed_seconds": "28",
  "home.marquee_interval_seconds": "90",
  "home.marquee_custom_items": "[]",
  "home.promotional_wins_enabled": "true",
  "home.game_carrom_visible": "false",
  "home.game_hockey_visible": "false",
  "home.game_pool_visible": "false",
  "bots.enabled": "true",
  "bots.global_win_rate": "70",
  "bots.action_delay_min_ms": "900",
  "bots.action_delay_max_ms": "2200",
  "bots.promotional_seeded": "false",
  "social.telegram_url": "",
  "social.whatsapp_url": "",
  "social.facebook_url": "",
  "wallet.deposit_min": "100",
  "wallet.deposit_max": "50000",
  "wallet.withdraw_min": "100",
  "wallet.transfer_min": "50",
  "wallet.transfer_commission_percent": "10",
  "wallet.referral_commission_percent": "5",
  "wallet.uddoktapay_enabled": "false",
  "wallet.uddoktapay_base_url": "https://sandbox.uddoktapay.com/api",
  "wallet.uddoktapay_api_key": "",
  "wallet.zinipay_enabled": "false",
  "wallet.zinipay_base_url": "https://api.zinipay.com",
  "wallet.zinipay_api_key": "",
  "wallet.manual_deposit_enabled": "false",
  "wallet.manual_methods": "[]",
  "wallet.withdraw_methods": "[\"bKash\",\"Nagad\",\"Rocket\"]",
  "wallet.offers_seeded": "false",
  "game.dice_speed": "normal",
  "game.token_speed": "normal",
  "game.voice_enabled": "true",
  "game.voice_provider": "jitsi",
  "game.voice_daily_domain": "",
  "game.voice_daily_api_key": "",
  "tournament.default_admin_commission": "10",
  "tournament.showcase_enabled": "false",
  "tournament.showcase_count": "3",
  "tournament.showcase_sizes": "8,16,32",
  "tournament.mixed_auto_enabled": "true",
  "tournament.mixed_auto_countdown_seconds": "15",
  "tournament.recurring_full_countdown_seconds": "300",
  "security.max_accounts_per_ip": "100",
  "security.max_accounts_per_device": "3",
  "security.auto_ban_threshold": "10",
  "api.google_client_id": "",
  "api.google_client_secret": "",
  "api.google_callback_url": "",
  "api.other_keys": "{}",
  "legal.terms_text":
    "PrizeJito.com ব্যবহার করে আপনি স্থানীয় আইন, বয়সসীমা, ন্যায্য খেলা এবং platform rules মেনে চলতে সম্মত হচ্ছেন। Real-money launch-এর আগে পূর্ণ শর্তাবলি Admin panel থেকে প্রকাশ করা হবে।",
  "legal.privacy_text":
    "PrizeJito.com account security, gameplay, payment compliance এবং abuse prevention-এর জন্য প্রয়োজনীয় তথ্য সংরক্ষণ করে। ব্যক্তিগত তথ্য অনুমতি ছাড়া বিক্রি করা হয় না।",
} as const;

const legacyBrandDefaults = {
  "site.logo_url": {
    from: "/logo.svg",
    to: homeSettingDefaults["site.logo_url"],
  },
  "site.name": {
    from: "Khan Ludo",
    to: homeSettingDefaults["site.name"],
  },
  "site.maintenance_message": {
    from: "Khan Ludo is temporarily under maintenance.",
    to: homeSettingDefaults["site.maintenance_message"],
  },
} as const;

const legacyPromotionalNames = [
  "Sumon Ahmed",
  "Nargis Begum",
  "Rahim Mia",
  "Tania Akter",
  "Karim Uddin",
] as const;

const promotionalNamePool = [
  "Ayman Hossain", "Raihan Kabir", "Mehedi Hasan", "Sadia Islam",
  "Nusrat Jahan", "Farhan Ahmed", "Mahmud Rahman", "Tasnim Akter",
  "Shakib Hasan", "Mim Sultana", "Nafis Chowdhury", "Jannat Noor",
  "Arman Sheikh", "Faria Ahmed", "Siam Hossain", "Raisa Khan",
  "Adnan Karim", "Sanjida Haque", "Tamim Sarker", "Mahi Islam",
  "Rafi Uddin", "Samira Rahman", "Zubair Ahmed", "Anika Hossain",
] as const;

const defaultPromotionalProfiles = [
  { winRate: 70, wins: 28, losses: 12, totalEarnings: "8400" },
  { winRate: 72, wins: 31, losses: 12, totalEarnings: "9200" },
  { winRate: 68, wins: 26, losses: 12, totalEarnings: "7600" },
  { winRate: 71, wins: 30, losses: 12, totalEarnings: "8800" },
  { winRate: 69, wins: 27, losses: 12, totalEarnings: "7900" },
] as const;

function takeRandomPromotionalName(usedNames: Set<string>): string {
  const available = promotionalNamePool.filter(
    (name) => !usedNames.has(name.toLowerCase()),
  );
  const name = available.length > 0
    ? available[randomInt(0, available.length)]!
    : `Prize Player ${randomInt(10_000, 100_000)}`;
  usedNames.add(name.toLowerCase());
  return name;
}

export async function ensureHomeDefaults(): Promise<void> {
  await db
    .insert(settings)
    .values(
      Object.entries(homeSettingDefaults).map(([key, value]) => ({
        key,
        value,
      })),
    )
    .onConflictDoNothing();

  for (const [key, migration] of Object.entries(legacyBrandDefaults)) {
    await db
      .update(settings)
      .set({ value: migration.to, updatedAt: new Date() })
      .where(and(eq(settings.key, key), eq(settings.value, migration.from)));
  }
  await db
    .update(settings)
    .set({
      value: sql`replace(${settings.value}, 'Khan Ludo', 'PrizeJito.com')`,
      updatedAt: new Date(),
    })
    .where(sql`${settings.value} like '%Khan Ludo%'`);
  await db
    .update(settings)
    .set({ value: "100", updatedAt: new Date() })
    .where(
      and(
        eq(settings.key, "security.max_accounts_per_ip"),
        eq(settings.value, "5"),
      ),
    );

  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('prizejito-promotional-player-names'))`,
    );
    const allBots = await transaction
      .select({
        id: botPlayers.id,
        userId: botPlayers.userId,
        name: botPlayers.name,
      })
      .from(botPlayers);
    const usedNames = new Set(allBots.map((player) => player.name.toLowerCase()));
    const legacyBots = allBots.filter((player) =>
      legacyPromotionalNames.includes(
        player.name as (typeof legacyPromotionalNames)[number],
      ),
    );

    for (const player of legacyBots) {
      usedNames.delete(player.name.toLowerCase());
      const name = takeRandomPromotionalName(usedNames);
      await transaction
        .update(botPlayers)
        .set({ name, updatedAt: new Date() })
        .where(eq(botPlayers.id, player.id));
      if (player.userId) {
        await transaction
          .update(users)
          .set({ name, updatedAt: new Date() })
          .where(eq(users.id, player.userId));
      }
    }

    const seeded = await transaction.query.settings.findFirst({
      where: eq(settings.key, "bots.promotional_seeded"),
    });
    if (seeded?.value === "true") return;

    const missingCount = Math.max(0, 5 - allBots.length);
    if (missingCount > 0) {
      await transaction.insert(botPlayers).values(
        defaultPromotionalProfiles.slice(0, missingCount).map((profile, index) => ({
          ...profile,
          name: takeRandomPromotionalName(usedNames),
          avatar: presetAvatarPath(index + 1),
        })),
      );
    }
    await transaction
      .update(settings)
      .set({ value: "true", updatedAt: new Date() })
      .where(eq(settings.key, "bots.promotional_seeded"));
  });
}

export async function getSettings(
  keys: readonly string[],
): Promise<Record<string, string>> {
  const rows = await db.query.settings.findMany({
    where: inArray(settings.key, [...keys]),
  });
  const values: Record<string, string> = {};

  for (const key of keys) {
    const row = rows.find((item) => item.key === key);
    const fallback =
      homeSettingDefaults[key as keyof typeof homeSettingDefaults] ?? "";
    values[key] = row?.value ?? fallback;
  }

  return values;
}

export async function updateSettings(
  values: Record<string, string>,
): Promise<void> {
  await db.transaction(async (transaction) => {
    for (const [key, value] of Object.entries(values)) {
      await transaction
        .insert(settings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedAt: new Date() },
        });
    }
  });
}

export async function updateSettingsWithAudit(input: {
  values: Record<string, string>;
  actorId: string;
  ipAddress: string;
  action?: string;
  targetType?: string;
}): Promise<void> {
  await db.transaction(async (transaction) => {
    for (const [key, value] of Object.entries(input.values)) {
      await transaction
        .insert(settings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedAt: new Date() },
        });
    }

    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: input.action ?? "home.settings.update",
      targetType: input.targetType ?? "settings",
      ipAddress: input.ipAddress,
      details: { keys: Object.keys(input.values) },
    });
  });
}

export async function getSetting(key: string): Promise<string> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  });
  return (
    row?.value ??
    homeSettingDefaults[key as keyof typeof homeSettingDefaults] ??
    ""
  );
}
