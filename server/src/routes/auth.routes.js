import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuthAllowPending } from '../middleware/auth.js';
import { passwordSchema } from '../utils/password.js';
import { changePassword, getMe, login } from '../services/auth.service.js';
import { env } from '../config/env.js';

// Slow down password guessing: 10 failed attempts per 15 minutes for one
// account from one IP. Successful sign-ins are not counted, so people switching
// between accounts on one machine (e.g. a live demo) are never locked out.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.email ?? '').toLowerCase().trim()}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many sign-in attempts. Try again in 15 minutes.' } },
});

const loginBody = z.object({
  email: z.email('Enter a valid email').trim().toLowerCase(),
  password: z.string().min(1, 'Password is required').max(200),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(200),
  newPassword: passwordSchema,
});

const router = Router();

router.post('/login', loginLimiter, validate({ body: loginBody }), async (req, res) => {
  res.json(await login(req.body));
});

router.get('/me', requireAuthAllowPending, async (req, res) => {
  res.json(await getMe(req.user));
});

router.post('/change-password', requireAuthAllowPending, validate({ body: changePasswordBody }), async (req, res) => {
  res.json(await changePassword(req.user, req.body, { ip: req.ip }));
});

export default router;
