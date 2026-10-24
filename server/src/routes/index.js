import { Router } from 'express';
import mongoose from 'mongoose';
import setupRoutes from './setup.routes.js';
import authRoutes from './auth.routes.js';

const router = Router();

router.get('/health', (_req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ ok: dbUp, db: dbUp ? 'connected' : 'disconnected' });
});

router.use('/setup', setupRoutes);
router.use('/auth', authRoutes);

// Module routes (org, employees, attendance, leave, payroll, analytics, ai, comms, audit)
// are mounted here as each module is built.

export default router;
