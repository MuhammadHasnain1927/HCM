import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { isoDateSchema, objectIdSchema, paginationQuery, pageInfo, escapeRegex } from '../utils/validators.js';
import { between } from '../utils/query.js';
import * as analytics from '../services/analytics.service.js';

// Dashboards (brief #18): all numbers computed on the server, filterable by
// date range and department.
export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

const filters = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  departmentId: objectIdSchema.optional(),
});

analyticsRouter.get('/admin', requireRole(ROLES.ADMIN), validate({ query: filters }), async (req, res) => {
  res.json(await analytics.adminDashboard(req.user, req.validQuery));
});
analyticsRouter.get('/hr', requireRole(ROLES.ADMIN, ROLES.HR), validate({ query: filters }), async (req, res) => {
  res.json(await analytics.hrDashboard(req.user, req.validQuery));
});
analyticsRouter.get('/me', async (req, res) => {
  res.json(await analytics.employeeDashboard(req.user));
});

// Audit log (brief #25): Admin only, read-only.
export const auditRouter = Router();
auditRouter.use(requireAuth, requireRole(ROLES.ADMIN));

auditRouter.get(
  '/',
  validate({
    query: paginationQuery.extend({
      action: z.string().trim().max(60).optional(),
      entity: z.string().trim().max(60).optional(),
      search: z.string().trim().max(100).optional(),
      from: isoDateSchema.optional(),
      to: isoDateSchema.optional(),
    }),
  }),
  async (req, res) => {
    const { action, entity, search, from, to, page, limit } = req.validQuery;
    const filter = {};
    if (action) filter.action = new RegExp(`^${escapeRegex(action)}`);
    if (entity) filter.entity = entity;
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ actorName: re }, { action: re }, { entity: re }];
    }
    if (from || to) {
      filter.createdAt = between(new Date(`${from ?? '2000-01-01'}T00:00:00Z`), new Date(`${to ?? '2100-01-01'}T23:59:59Z`));
    }
    const [rows, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({
      items: rows.map((a) => ({
        id: String(a._id),
        action: a.action,
        entity: a.entity,
        entityId: a.entityId,
        actorName: a.actorName,
        actorRole: a.actorRole,
        before: a.before,
        after: a.after,
        ip: a.ip,
        createdAt: a.createdAt,
      })),
      ...pageInfo({ page, limit }, total),
    });
  },
);
