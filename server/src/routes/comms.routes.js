import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { Announcement } from '../models/Comms.js';
import { forbidden, notFound } from '../utils/AppError.js';
import { idParams } from '../utils/validators.js';
import { recordAudit } from '../services/audit.service.js';
import { listNotifications, markAllRead, markRead, notifyRoles } from '../services/notifications.service.js';

const router = Router();

const serializeAnnouncement = (a) => ({
  id: a._id.toString(),
  title: a.title,
  body: a.body,
  pinned: a.pinned,
  authorName: a.authorName,
  authorRole: a.authorRole,
  createdBy: String(a.createdBy),
  createdAt: a.createdAt,
});

// ----- Announcements (brief #23: Admin and HR post, everyone reads) -----
router.get('/announcements', requireAuth, validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }) }), async (req, res) => {
  const rows = await Announcement.find().sort({ pinned: -1, createdAt: -1 }).limit(req.validQuery.limit).lean();
  res.json(rows.map(serializeAnnouncement));
});

router.post(
  '/announcements',
  requireAuth,
  requireRole(ROLES.ADMIN, ROLES.HR),
  validate({
    body: z.object({
      title: z.string().trim().min(3, 'Title is required').max(120),
      body: z.string().trim().min(3, 'Write the announcement').max(3000),
      pinned: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const a = await Announcement.create({
      ...req.body,
      createdBy: req.user._id,
      authorName: req.user.name,
      authorRole: req.user.role,
    });
    await recordAudit({ actor: req.user, action: 'announcement.create', entity: 'Announcement', entityId: a._id, after: a, ip: req.ip });
    await notifyRoles([ROLES.ADMIN, ROLES.HR, ROLES.EMPLOYEE], { type: 'announcement', title: `New announcement: ${a.title}`, body: a.body.slice(0, 200), link: '/announcements' }, { exceptUserId: req.user._id });
    res.status(201).json(serializeAnnouncement(a));
  },
);

router.delete('/announcements/:id', requireAuth, requireRole(ROLES.ADMIN, ROLES.HR), validate({ params: idParams }), async (req, res) => {
  const a = await Announcement.findById(req.validParams.id);
  if (!a) throw notFound('Announcement not found');
  // Authors remove their own; Admin can remove any.
  if (req.user.role !== ROLES.ADMIN && String(a.createdBy) !== String(req.user._id)) throw forbidden('You can only remove your own announcements');
  await a.deleteOne();
  await recordAudit({ actor: req.user, action: 'announcement.delete', entity: 'Announcement', entityId: a._id, before: a, ip: req.ip });
  res.status(204).end();
});

// ----- Notifications (brief #24: own only) -----
router.get('/notifications', requireAuth, validate({ query: z.object({ unreadOnly: z.enum(['true', 'false']).optional() }) }), async (req, res) => {
  res.json(await listNotifications(req.user, { unreadOnly: req.validQuery.unreadOnly === 'true' }));
});
router.patch('/notifications/:id/read', requireAuth, validate({ params: idParams }), async (req, res) => {
  await markRead(req.user, req.validParams.id);
  res.status(204).end();
});
router.post('/notifications/read-all', requireAuth, async (req, res) => {
  await markAllRead(req.user);
  res.status(204).end();
});

export default router;
