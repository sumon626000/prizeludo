import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
} from "node:crypto";
import { config } from "../config.js";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const encryptionKey = createHash("sha256")
  .update(`khan-ludo:v1:${config.JWT_SECRET}`)
  .digest();

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "enc",
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(value: string): string {
  if (!value.startsWith("enc:v1:")) return value;
  const [, , ivValue, tagValue, encryptedValue] = value.split(":");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Encrypted value is malformed.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateGameId(): string {
  return randomInt(10_000, 100_000).toString();
}

export function generateReferCode(): string {
  return randomBytes(6).toString("base64url").toUpperCase();
}

export function rollFairDice(): number {
  return randomInt(1, 7);
}
