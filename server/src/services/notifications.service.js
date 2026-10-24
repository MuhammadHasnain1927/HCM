import { Notification } from '../models/Comms.js';
import { User, ROLES } from '../models/User.js';
import { inList, ne } from '../utils/query.js';

/** Sends one notification to each user id. Failures never break the main action. */
export async function notifyUsers(userIds, { type, title, body = '', link = null }) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return;
  try {
    await Notification.insertMany(ids.map((user) => ({ user, type, title, body, link })));
  } catch (err) {
    console.error('Failed to send notifications:', err.message);
  }
}

/** Notifies every active user with one of the roles, except the actor. */
export async function notifyRoles(roles, payload, { exceptUserId } = {}) {
  const filter = { role: inList(roles), isActive: true };
  if (exceptUserId) filter._id = ne(exceptUserId);
  const users = await User.find(filter).select('_id').lean();
  await notifyUsers(users.map((u) => u._id), payload);
}

export const notifyHr = (payload, opts) => notifyRoles([ROLES.HR], payload, opts);

const serialize = (n) => ({
  id: n._id.toString(),
  type: n.type,
  title: n.title,
  body: n.body,
  link: n.link,
  read: Boolean(n.readAt),
  createdAt: n.createdAt,
});

export async function listNotifications(user, { limit = 20, unreadOnly = false } = {}) {
  const filter = { user: user._id, ...(unreadOnly ? { readAt: null } : {}) };
  const [items, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ user: user._id, readAt: null }),
  ]);
  return { items: items.map(serialize), unread };
}

export async function markRead(user, id) {
  await Notification.updateOne({ _id: id, user: user._id, readAt: null }, { readAt: new Date() });
}

export async function markAllRead(user) {
  await Notification.updateMany({ user: user._id, readAt: null }, { readAt: new Date() });
}
