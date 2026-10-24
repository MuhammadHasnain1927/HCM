import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { Settings } from '../models/Settings.js';
import { idParams, objectIdSchema } from '../utils/validators.js';
import * as svc from '../services/payroll.service.js';
import { writePayslipPdf } from '../services/payslip.pdf.js';
import { recordAudit } from '../services/audit.service.js';

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

// ----- Payroll runs: HR creates/reviews drafts, Admin views and finalizes -----
export const payrollRouter = Router();
payrollRouter.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.HR));

payrollRouter.get('/runs', async (_req, res) => {
  res.json(await svc.listRuns());
});
payrollRouter.post('/runs', requireRole(ROLES.HR), validate({ body: z.object({ month: monthSchema }) }), async (req, res) => {
  res.status(201).json(await svc.createRun(req.user, req.body, { ip: req.ip }));
});
payrollRouter.get('/runs/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await svc.getRun(req.validParams.id));
});
payrollRouter.post('/runs/:id/recalculate', requireRole(ROLES.HR), validate({ params: idParams }), async (req, res) => {
  res.json(await svc.recalculateRun(req.user, req.validParams.id, { ip: req.ip }));
});
payrollRouter.post('/runs/:id/finalize', requireRole(ROLES.ADMIN), validate({ params: idParams }), async (req, res) => {
  res.json(await svc.finalizeRun(req.user, req.validParams.id, { ip: req.ip }));
});
payrollRouter.get('/summary', validate({ query: z.object({ month: monthSchema.optional() }) }), async (req, res) => {
  res.json(await svc.payrollSummary(req.user, req.validQuery));
});

// ----- Payslips: Admin/HR all, Employee own finalized (brief #17) -----
export const payslipRouter = Router();
payslipRouter.use(requireAuth);

payslipRouter.get(
  '/',
  validate({ query: z.object({ employeeId: objectIdSchema.optional(), month: monthSchema.optional() }) }),
  async (req, res) => {
    res.json(await svc.listPayslips(req.user, req.validQuery));
  },
);
payslipRouter.get('/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await svc.getPayslip(req.user, req.validParams.id));
});
payslipRouter.get('/:id/pdf', validate({ params: idParams }), async (req, res) => {
  const payslip = await svc.getPayslip(req.user, req.validParams.id);
  const settings = await Settings.get().lean();
  await recordAudit({ actor: req.user, action: 'payslip.download', entity: 'Payslip', entityId: payslip.id, ip: req.ip });
  const safeName = payslip.employeeName.replace(/[^A-Za-z0-9]+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payslip-${payslip.month}-${safeName}.pdf"`);
  writePayslipPdf(res, payslip, { companyName: settings?.companyName ?? 'Company', currency: settings?.currency ?? 'PKR' });
});
