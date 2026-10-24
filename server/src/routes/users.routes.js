import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { idParams, paginationQuery } from '../utils/validators.js';
import { createHrUser, listUsers, resetUserPassword, setUserActive, setUserRole } from '../services/users.service.js';

// Brief, Section 8, #05: only Admin creates HR logins and deactivates or resets accounts.
const router = Router();
router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get(
  '/',
  validate({
    query: paginationQuery.extend({
      role: z.enum(['admin', 'hr', 'employee']).optional(),
      status: z.enum(['active', 'inactive']).optional(),
      search: z.string().trim().max(100).optional(),
    }),
  }),
  async (req, res) => {
    res.json(await listUsers(req.validQuery));
  },
);

router.post(
  '/hr',
  validate({
    body: z.object({
      name: z.string().trim().min(2, 'Name is required').max(120),
      email: z.email('Enter a valid email').trim().toLowerCase(),
    }),
  }),
  async (req, res) => {
    res.status(201).json(await createHrUser(req.user, req.body, { ip: req.ip }));
  },
);

router.patch(
  '/:id/status',
  validate({ params: idParams, body: z.object({ isActive: z.boolean() }) }),
  async (req, res) => {
    res.json(await setUserActive(req.user, req.validParams.id, req.body.isActive, { ip: req.ip }));
  },
);

router.patch(
  '/:id/role',
  validate({ params: idParams, body: z.object({ role: z.enum(['hr', 'employee']) }) }),
  async (req, res) => {
    res.json(await setUserRole(req.user, req.validParams.id, req.body.role, { ip: req.ip }));
  },
);

router.post('/:id/reset-password', validate({ params: idParams }), async (req, res) => {
  res.json(await resetUserPassword(req.user, req.validParams.id, { ip: req.ip }));
});

export default router;
