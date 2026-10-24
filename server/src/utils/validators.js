import mongoose from 'mongoose';
import { z } from 'zod';

export function isTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z.string().trim().refine(isTimezone, 'Unknown timezone');

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM, e.g. 09:00');

/** A real calendar date as "YYYY-MM-DD" (rejects 2026-02-30). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-25')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real date');

export const objectIdSchema = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

export const idParams = z.object({ id: objectIdSchema });

/** Escapes user text for use inside a RegExp (search boxes). */
export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ?page=&limit= with sane bounds. */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const pageInfo = ({ page, limit }, total) => ({ page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
