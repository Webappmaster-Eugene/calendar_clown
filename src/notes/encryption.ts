/**
 * AES-256-GCM encryption for note content.
 * Key from env NOTES_ENCRYPTION_KEY (32 bytes = 64 hex chars).
 * Format: iv:authTag:ciphertext (all base64).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { createLogger } from "../utils/logger.js";

const log = createLogger("encryption");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let encryptionKey: Buffer | null = null;

/** Check if encryption is configured. */
export function isEncryptionConfigured(): boolean {
  return getKey() !== null;
}

/** Get encryption key from env, cached. Returns null if not configured. */
function getKey(): Buffer | null {
  if (encryptionKey) return encryptionKey;

  const keyHex = process.env.NOTES_ENCRYPTION_KEY?.trim();
  if (!keyHex) return null;

  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    log.error("NOTES_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
    return null;
  }

  encryptionKey = Buffer.from(keyHex, "hex");
  return encryptionKey;
}

/** Encrypt plaintext. Returns "iv:authTag:ciphertext" in base64. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) {
    // If encryption not configured, store as-is
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/** Decrypt encrypted string. Returns plaintext. */
export function decrypt(encrypted: string): string {
  const key = getKey();
  if (!key) {
    // If encryption not configured, return as-is
    return encrypted;
  }

  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    // Not encrypted (legacy data), return as-is
    return encrypted;
  }

  try {
    const iv = Buffer.from(parts[0], "base64");
    const authTag = Buffer.from(parts[1], "base64");
    const ciphertext = Buffer.from(parts[2], "base64");

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch {
    // If decryption fails, return as-is (might be unencrypted data)
    return encrypted;
  }
}
