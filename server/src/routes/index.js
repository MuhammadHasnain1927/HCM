import { Router } from 'express';
import mongoose from 'mongoose';
import setupRoutes from './setup.routes.js';
import authRoutes from './auth.routes.js';
import settingsRoutes from './settings.routes.js';
import orgRoutes from './org.routes.js';
import usersRoutes from './users.routes.js';
import employeesRoutes from './employees.routes.js';
import attendanceRoutes from './attendance.routes.js';
import leaveRoutes from './leave.routes.js';
import commsRoutes from './comms.routes.js';
import { payrollRouter, payslipRouter } from './payroll.routes.js';
import { analyticsRouter, auditRouter } from './analytics.routes.js';
import aiRoutes from './ai.routes.js';

const router = Router();

router.get('/health', (_req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ ok: dbUp, db: dbUp ? 'connected' : 'disconnected' });
});

router.use('/setup', setupRoutes);
router.use('/auth', authRoutes);
router.use('/settings', settingsRoutes);
router.use('/org', orgRoutes);
router.use('/users', usersRoutes);
router.use('/employees', employeesRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/leaves', leaveRoutes);
router.use('/payroll', payrollRouter);
router.use('/payslips', payslipRouter);
router.use('/analytics', analyticsRouter);
router.use('/audit-logs', auditRouter);
router.use('/ai', aiRoutes);
router.use('/', commsRoutes);

// Remaining module routes (employees, attendance, leave, payroll, analytics, ai, comms, audit)
// are mounted here as each module is built.

export default router;
