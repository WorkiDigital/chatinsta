import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;

// scrypt from Node's own crypto module — no native dependency to compile in
// a slim Docker image, unlike bcrypt.
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derivedHex] = stored.split(":");
  if (!salt || !derivedHex) return false;
  const derived = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(derivedHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
