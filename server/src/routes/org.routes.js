import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { idParams, isoDateSchema, objectIdSchema } from '../utils/validators.js';
import * as org from '../services/org.service.js';

// Brief, Section 8, #04: Admin manages; HR can view. Employees read leave
// types and holidays through the leave module, not here.
const canView = [requireAuth, requireRole(ROLES.ADMIN, ROLES.HR)];
const canManage = [requireAuth, requireRole(ROLES.ADMIN)];

const listQuery = z.object({ includeArchived: z.enum(['true', 'false']).optional().transform((v) => v === 'true') });
const ctx = (req) => ({ ip: req.ip });

const router = Router();

// ----- Departments -----
const departmentBody = z.object({
  name: z.string().trim().min(2, 'Name is required').max(80),
  description: z.string().trim().max(300).optional(),
});

router.get('/departments', ...canView, validate({ query: listQuery }), async (req, res) => {
  res.json(await org.listDepartments(req.validQuery));
});
router.post('/departments', ...canManage, validate({ body: departmentBody }), async (req, res) => {
  res.status(201).json(await org.createDepartment(req.user, req.body, ctx(req)));
});
router.patch(
  '/departments/:id',
  ...canManage,
  validate({ params: idParams, body: departmentBody.partial().extend({ isActive: z.boolean().optional() }) }),
  async (req, res) => {
    res.json(await org.updateDepartment(req.user, req.validParams.id, req.body, ctx(req)));
  },
);

// ----- Designations -----
const designationBody = z.object({
  title: z.string().trim().min(2, 'Title is required').max(80),
  departmentId: objectIdSchema,
});

router.get(
  '/designations',
  ...canView,
  validate({ query: listQuery.extend({ departmentId: objectIdSchema.optional() }) }),
  async (req, res) => {
    res.json(await org.listDesignations(req.validQuery));
  },
);
router.post('/designations', ...canManage, validate({ body: designationBody }), async (req, res) => {
  res.status(201).json(await org.createDesignation(req.user, req.body, ctx(req)));
});
router.patch(
  '/designations/:id',
  ...canManage,
  validate({ params: idParams, body: designationBody.partial().extend({ isActive: z.boolean().optional() }) }),
  async (req, res) => {
    res.json(await org.updateDesignation(req.user, req.validParams.id, req.body, ctx(req)));
  },
);

// ----- Leave types -----
const leaveTypeBody = z.object({
  name: z.string().trim().min(2, 'Name is required').max(60),
  yearlyQuota: z.number().int('Whole days only').min(0).max(365).nullable(),
  isPaid: z.boolean().default(true),
});

router.get('/leave-types', ...canView, validate({ query: listQuery }), async (req, res) => {
  res.json(await org.listLeaveTypes(req.validQuery));
});
router.post('/leave-types', ...canManage, validate({ body: leaveTypeBody }), async (req, res) => {
  res.status(201).json(await org.createLeaveType(req.user, req.body, ctx(req)));
});
router.patch(
  '/leave-types/:id',
  ...canManage,
  validate({
    params: idParams,
    body: z.object({
      name: leaveTypeBody.shape.name.optional(),
      yearlyQuota: leaveTypeBody.shape.yearlyQuota.optional(),
      isPaid: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    res.json(await org.updateLeaveType(req.user, req.validParams.id, req.body, ctx(req)));
  },
);

// ----- Holidays -----
const holidayBody = z.object({
  date: isoDateSchema,
  name: z.string().trim().min(2, 'Name is required').max(80),
});

router.get(
  '/holidays',
  ...canView,
  validate({ query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }) }),
  async (req, res) => {
    res.json(await org.listHolidays(req.validQuery));
  },
);
router.post('/holidays', ...canManage, validate({ body: holidayBody }), async (req, res) => {
  res.status(201).json(await org.createHoliday(req.user, req.body, ctx(req)));
});
router.patch('/holidays/:id', ...canManage, validate({ params: idParams, body: holidayBody.partial() }), async (req, res) => {
  res.json(await org.updateHoliday(req.user, req.validParams.id, req.body, ctx(req)));
});
router.delete('/holidays/:id', ...canManage, validate({ params: idParams }), async (req, res) => {
  await org.deleteHoliday(req.user, req.validParams.id, ctx(req));
  res.status(204).end();
});

export default router;
