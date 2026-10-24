import { Router } from 'express';
import { z } from 'zod';
import { assertEmployeeAccess, requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { EMPLOYEE_STATUS, GENDERS } from '../models/Employee.js';
import { idParams, isoDateSchema, objectIdSchema, paginationQuery } from '../utils/validators.js';
import * as svc from '../services/employees.service.js';
import * as face from '../services/face.service.js';

const router = Router();
const managers = requireRole(ROLES.ADMIN, ROLES.HR);
const ctx = (req) => ({ ip: req.ip });

const optionalText = (max) => z.string().trim().max(max).optional();

const employeeFields = {
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{2,20}$/, 'Use 2-20 letters, digits or dashes')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.email('Enter a valid email').trim().toLowerCase(),
  phone: optionalText(30),
  address: optionalText(300),
  gender: z.enum(GENDERS).nullable().optional(),
  dateOfBirth: isoDateSchema.nullable().optional(),
  departmentId: objectIdSchema,
  designationId: objectIdSchema.nullable().optional(),
  joinDate: isoDateSchema,
  status: z.enum(['active', 'probation']).optional(),
};

const registerBody = z.object({
  ...employeeFields,
  // Optional Face ID photo taken by HR during registration.
  photo: z.string().max(500000, 'The photo is too large').optional(),
  basicSalary: z.number({ error: 'Basic salary is required' }).positive('Salary must be greater than 0').max(100000000),
});

const updateBody = z
  .object({ ...employeeFields, status: z.enum(EMPLOYEE_STATUS.filter((s) => s !== 'exited')) })
  .partial();

const listQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  departmentId: objectIdSchema.optional(),
  designationId: objectIdSchema.optional(),
  status: z.enum([...EMPLOYEE_STATUS, 'current']).optional(),
  sort: z.enum(['name', 'code', 'joinDate', 'newest']).optional(),
});

// ----- Self service (Employee and HR with an employee record) -----
router.get('/me', requireAuth, async (req, res) => {
  res.json(await svc.getMyEmployee(req.user));
});
router.patch(
  '/me',
  requireAuth,
  validate({ body: z.object({ phone: optionalText(30), address: optionalText(300) }) }),
  async (req, res) => {
    res.json(await svc.updateMyProfile(req.user, req.body, ctx(req)));
  },
);

// Face ID: the person enrolls once; after that only HR/Admin can replace it.
const photoBody = z.object({ photo: z.string().min(1, 'Take a photo first').max(500000, 'The photo is too large') });
router.put('/me/face', requireAuth, validate({ body: photoBody }), async (req, res) => {
  if (!req.user.employee) throw new AppError(422, 'NO_EMPLOYEE_RECORD', 'No employee record is linked to your account');
  res.json(await face.enrollFace(req.user, req.user.employee, req.body.photo, ctx(req)));
});

// ----- Directory, CSV (Admin and HR manage) -----
router.get('/', requireAuth, managers, validate({ query: listQuery }), async (req, res) => {
  res.json(await svc.listEmployees(req.validQuery));
});

router.get('/export', requireAuth, managers, validate({ query: listQuery.omit({ page: true, limit: true }) }), async (req, res) => {
  const csv = await svc.exportEmployeesCsv(req.validQuery);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="employees-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

router.post(
  '/import',
  requireAuth,
  managers,
  validate({
    query: z.object({ dryRun: z.enum(['true', 'false']).default('true').transform((v) => v === 'true') }),
    body: z.object({ csv: z.string().min(1, 'The file is empty').max(900000, 'The file is too large (max ~900 KB)') }),
  }),
  async (req, res) => {
    res.json(await svc.importEmployeesCsv(req.user, req.body.csv, { dryRun: req.validQuery.dryRun, ip: req.ip }));
  },
);

router.post('/', requireAuth, managers, validate({ body: registerBody }), async (req, res) => {
  const { photo, ...data } = req.body;
  if (photo) face.parsePhoto(photo); // reject a bad photo before anything is created
  const result = await svc.registerEmployee(req.user, data, ctx(req));
  if (photo) {
    result.face = await face.enrollFace(req.user, result.employee.id, photo, ctx(req));
    result.employee.faceEnrolledAt = result.face.enrolledAt;
  }
  res.status(201).json(result);
});

// ----- One employee (Employee 360) -----
router.get('/:id', requireAuth, validate({ params: idParams }), async (req, res) => {
  res.json(await svc.getEmployee(req.user, req.validParams.id));
});

router.patch('/:id', requireAuth, managers, validate({ params: idParams, body: updateBody }), async (req, res) => {
  res.json(await svc.updateEmployee(req.user, req.validParams.id, req.body, ctx(req)));
});

router.put(
  '/:id/salary',
  requireAuth,
  managers,
  validate({ params: idParams, body: z.object({ basic: z.number().positive('Salary must be greater than 0').max(100000000) }) }),
  async (req, res) => {
    res.json(await svc.updateSalary(req.user, req.validParams.id, req.body, ctx(req)));
  },
);

router.post(
  '/:id/exit',
  requireAuth,
  managers,
  validate({ params: idParams, body: z.object({ exitDate: isoDateSchema, reason: optionalText(300) }) }),
  async (req, res) => {
    res.json(await svc.exitEmployee(req.user, req.validParams.id, req.body, ctx(req)));
  },
);

// ----- Face ID per employee -----
router.get('/:id/face', requireAuth, validate({ params: idParams }), async (req, res) => {
  assertEmployeeAccess(req.user, req.validParams.id);
  res.json(await face.getFaceStatus(req.validParams.id));
});

router.get('/:id/face/photo', requireAuth, validate({ params: idParams }), async (req, res) => {
  const photo = await face.getFacePhoto(req.user, req.validParams.id);
  res.setHeader('Content-Type', photo.contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(photo.data);
});

router.put('/:id/face', requireAuth, managers, validate({ params: idParams, body: photoBody }), async (req, res) => {
  res.json(await face.enrollFace(req.user, req.validParams.id, req.body.photo, ctx(req)));
});

router.delete('/:id/face', requireAuth, managers, validate({ params: idParams }), async (req, res) => {
  res.json(await face.resetFace(req.user, req.validParams.id, ctx(req)));
});

export default router;
