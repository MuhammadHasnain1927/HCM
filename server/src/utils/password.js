import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const SALT_ROUNDS = 12;

// bcrypt only uses the first 72 bytes, so cap the length.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// A valid hash of a random value, compared against when a login email does not
// exist so that response time does not reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), SALT_ROUNDS);
export const fakeVerify = (plain) => bcrypt.compare(plain, DUMMY_HASH);

// Temporary password for new accounts and resets, e.g. "Tmp-k3J9xQ2m".
// Always satisfies passwordSchema; the user must change it on first sign-in.
export function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (const byte of crypto.randomBytes(8)) out += alphabet[byte % alphabet.length];
  return `Tmp-${out}${crypto.randomInt(10)}`;
}
