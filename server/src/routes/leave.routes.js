import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { LEAVE_STATUS } from '../models/LeaveRequest.js';
import { idParams, isoDateSchema, objectIdSchema, paginationQuery } from '../utils/validators.js';
import * as svc from '../services/leave.service.js';
import { listLeaveTypes, listHolidays } from '../services/org.service.js';

const router = Router();
router.use(requireAuth);

// Brief #12: HR and Employee apply for their own leave; #13: HR decides; Admin views.
const selfService = requireRole(ROLES.HR, ROLES.EMPLOYEE);

// Leave types and holidays for the apply form (all roles may read these).
router.get('/types', async (_req, res) => {
  res.json(await listLeaveTypes());
});
router.get('/holidays', validate({ query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }) }), async (req, res) => {
  res.json(await listHolidays(req.validQuery));
});

router.get(
  '/balance',
  validate({ query: z.object({ employeeId: objectIdSchema.optional(), year: z.coerce.number().int().min(2000).max(2100).optional() }) }),
  async (req, res) => {
    res.json(await svc.getBalancesFor(req.user, req.validQuery));
  },
);

router.get(
  '/preview',
  validate({ query: z.object({ startDate: isoDateSchema, endDate: isoDateSchema }) }),
  async (req, res) => {
    const { startDate, endDate } = req.validQuery;
    res.json({ days: endDate < startDate ? 0 : await svc.countLeaveDays(startDate, endDate) });
  },
);

router.get(
  '/',
  validate({
    query: paginationQuery.extend({
      status: z.enum(LEAVE_STATUS).optional(),
      employeeId: objectIdSchema.optional(),
      departmentId: objectIdSchema.optional(),
      leaveTypeId: objectIdSchema.optional(),
      from: isoDateSchema.optional(),
      to: isoDateSchema.optional(),
    }),
  }),
  async (req, res) => {
    res.json(await svc.listLeaves(req.user, req.validQuery));
  },
);

router.get('/on-leave', requireRole(ROLES.ADMIN, ROLES.HR), validate({ query: z.object({ date: isoDateSchema, departmentId: objectIdSchema.optional() }) }), async (req, res) => {
  res.json(await svc.whoIsOnLeave(req.validQuery));
});

router.post(
  '/',
  selfService,
  validate({
    body: z.object({
      leaveTypeId: objectIdSchema,
      startDate: isoDateSchema,
      endDate: isoDateSchema,
      reason: z.string().trim().max(500).optional(),
      source: z.enum(['form', 'smart']).optional(),
    }),
  }),
  async (req, res) => {
    res.status(201).json(await svc.applyLeave(req.user, req.body, { ip: req.ip }));
  },
);

router.patch('/:id/cancel', selfService, validate({ params: idParams }), async (req, res) => {
  res.json(await svc.cancelLeave(req.user, req.validParams.id, { ip: req.ip }));
});

router.patch(
  '/:id/decision',
  requireRole(ROLES.HR),
  validate({
    params: idParams,
    body: z.object({ decision: z.enum(['approved', 'rejected']), comment: z.string().trim().max(500).optional() }),
  }),
  async (req, res) => {
    res.json(await svc.decideLeave(req.user, req.validParams.id, req.body, { ip: req.ip }));
  },
);

export default router;
