import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { env } from '../config/env.js';
import { isoDateSchema, objectIdSchema } from '../utils/validators.js';
import { chat, smartLeave, summarizeDashboard } from '../services/ai/ai.service.js';
import { configuredProviders } from '../services/ai/providers.js';

const router = Router();
router.use(requireAuth);

// About 20 requests per user per hour (brief, Section 4 guardrails).
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.isTest ? 1000 : 20,
  keyGenerator: (req) => `ai:${req.user._id}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'AI_RATE_LIMITED', message: 'You have reached the assistant limit (20 questions per hour). Please try again later.' } },
});

router.get('/status', (_req, res) => {
  res.json({ available: configuredProviders().length > 0, providers: configuredProviders() });
});

router.post(
  '/chat',
  aiLimiter,
  validate({
    body: z.object({
      message: z.string().trim().min(1, 'Ask a question').max(1000, 'Keep questions under 1000 characters'),
      history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(12).optional(),
    }),
  }),
  async (req, res) => {
    res.json(await chat(req.user, req.body));
  },
);

router.post(
  '/summary',
  aiLimiter,
  requireRole(ROLES.ADMIN, ROLES.HR),
  validate({
    body: z.object({
      scope: z.enum(['hr', 'admin']).default('hr'),
      from: isoDateSchema.optional(),
      to: isoDateSchema.optional(),
      departmentId: objectIdSchema.optional(),
    }),
  }),
  async (req, res) => {
    res.json(await summarizeDashboard(req.user, req.body));
  },
);

router.post(
  '/smart-leave',
  aiLimiter,
  requireRole(ROLES.HR, ROLES.EMPLOYEE),
  validate({ body: z.object({ text: z.string().trim().min(5, 'Describe the leave you need').max(500) }) }),
  async (req, res) => {
    res.json(await smartLeave(req.user, req.body));
  },
);

export default router;
