import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { passwordSchema } from '../utils/password.js';
import { completeSetup, getSetupStatus } from '../services/setup.service.js';
import { signToken } from '../utils/jwt.js';
import { timezoneSchema } from '../utils/validators.js';

const setupBody = z.object({
  companyName: z.string().trim().min(2, 'Company name is required').max(120),
  timezone: timezoneSchema.optional(),
  adminName: z.string().trim().min(2, 'Admin name is required').max(120),
  adminEmail: z.email('Enter a valid email').trim().toLowerCase(),
  adminPassword: passwordSchema,
});

const router = Router();

// Public: the frontend calls this first to decide between the setup wizard and the login page.
router.get('/status', async (_req, res) => {
  res.json(await getSetupStatus());
});

// Public, but only works once. Returns a session so the Admin lands signed in.
router.post('/', validate({ body: setupBody }), async (req, res) => {
  const { settings, admin } = await completeSetup(req.body, { ip: req.ip });
  res.status(201).json({
    token: signToken(admin),
    user: admin.toSafeJSON(),
    company: { name: settings.companyName, timezone: settings.timezone },
  });
});

export default router;
