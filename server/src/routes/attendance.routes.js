import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { idParams, isoDateSchema, objectIdSchema, timeSchema } from '../utils/validators.js';
import * as svc from '../services/attendance.service.js';

const router = Router();
router.use(requireAuth);

// Brief #09: HR and Employee check in for themselves (Admin has no attendance).
const selfService = requireRole(ROLES.HR, ROLES.EMPLOYEE);
const managers = requireRole(ROLES.ADMIN, ROLES.HR);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

router.get('/today', async (req, res) => {
  res.json(await svc.getToday(req.user));
});

router.post(
  '/check-in',
  selfService,
  validate({
    body: z
      .object({
        source: z.enum(['web', 'camera']).default('web'),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        accuracy: z.number().min(0).max(100000).optional(),
        faceCount: z.number().int().min(0).max(20).optional(),
        faceVerified: z.boolean().optional(),
      })
      .refine((b) => b.source !== 'camera' || (b.lat !== undefined && b.lng !== undefined), {
        message: 'Location is required for camera check-in',
        path: ['lat'],
      }),
  }),
  async (req, res) => {
    res.status(201).json(await svc.checkIn(req.user, req.body, { ip: req.ip }));
  },
);

router.post('/check-out', selfService, async (req, res) => {
  res.json(await svc.checkOut(req.user, { ip: req.ip }));
});

router.get(
  '/calendar',
  validate({ query: z.object({ month: monthSchema, employeeId: objectIdSchema.optional() }) }),
  async (req, res) => {
    res.json(await svc.getCalendar(req.user, req.validQuery));
  },
);

router.get(
  '/board',
  managers,
  validate({ query: z.object({ date: isoDateSchema.optional(), departmentId: objectIdSchema.optional() }) }),
  async (req, res) => {
    res.json(await svc.getBoard(req.validQuery));
  },
);

// ----- Corrections (brief #11: Employee requests, HR approves, Admin views) -----
router.get(
  '/corrections',
  validate({ query: z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional(), employeeId: objectIdSchema.optional() }) }),
  async (req, res) => {
    res.json(await svc.listCorrections(req.user, req.validQuery));
  },
);

router.post(
  '/corrections',
  selfService,
  validate({
    body: z.object({
      date: isoDateSchema,
      checkIn: timeSchema,
      checkOut: timeSchema.nullable().optional(),
      reason: z.string().trim().min(3, 'Explain what happened').max(500),
    }),
  }),
  async (req, res) => {
    res.status(201).json(await svc.requestCorrection(req.user, req.body, { ip: req.ip }));
  },
);

router.patch(
  '/corrections/:id',
  requireRole(ROLES.HR),
  validate({
    params: idParams,
    body: z.object({ decision: z.enum(['approved', 'rejected']), comment: z.string().trim().max(500).optional() }),
  }),
  async (req, res) => {
    res.json(await svc.decideCorrection(req.user, req.validParams.id, req.body, { ip: req.ip }));
  },
);

export default router;
