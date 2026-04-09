import { randomInt } from "node:crypto";

import bcrypt from "bcryptjs";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

const TEMP_PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

export function generateTemporaryPassword(length = 14) {
  if (!Number.isInteger(length) || length < 12) {
    throw new Error("Temporary password length must be at least 12 characters.");
  }

  let password = "";
  for (let index = 0; index < length; index += 1) {
    const charIndex = randomInt(0, TEMP_PASSWORD_CHARS.length);
    password += TEMP_PASSWORD_CHARS[charIndex];
  }
  return password;
}

