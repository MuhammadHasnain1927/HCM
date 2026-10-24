import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { timeSchema, timezoneSchema } from '../utils/validators.js';
import { getSettings, updateSettings } from '../services/settings.service.js';

const settingsBody = z
  .object({
    companyName: z.string().trim().min(2, 'Company name is required').max(120),
    timezone: timezoneSchema,
    officeStart: timeSchema,
    officeEnd: timeSchema,
    graceMinutes: z.number().int('Whole minutes only').min(0).max(120),
    halfDayHours: z.number().min(1).max(12),
    weekendDays: z.array(z.number().int().min(0).max(6)).max(6),
    office: z
      .object({
        lat: z.number().min(-90).max(90).nullable(),
        lng: z.number().min(-180).max(180).nullable(),
        radiusMeters: z.number().int().min(10, 'At least 10 m').max(5000, 'At most 5000 m'),
      })
      .partial(),
  })
  .partial();

const router = Router();

router.get('/', requireAuth, requireRole(ROLES.ADMIN, ROLES.HR), async (_req, res) => {
  res.json(await getSettings());
});

router.put('/', requireAuth, requireRole(ROLES.ADMIN), validate({ body: settingsBody }), async (req, res) => {
  res.json(await updateSettings(req.user, req.body, { ip: req.ip }));
});

export default router;
