'use strict';

const { ok, ApiError } = require('../utils/response');
const notificationService = require('../services/notificationService');

/** GET /api/notifications - current user's notifications */
async function listNotifications(req, res, next) {
  try {
    const unreadOnly = req.query.unread === 'true';
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const notifications = notificationService.getNotifications(req.user.id, { unreadOnly, limit, offset });
    const unread_count = notificationService.unreadCount(req.user.id);

    return ok(res, { notifications, unread_count }, 'OK');
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/notifications/:id/read */
async function markRead(req, res, next) {
  try {
    const changed = notificationService.markRead(req.user.id, Number(req.params.id));
    if (!changed) throw ApiError.notFound('Notification not found');
    return ok(res, { id: Number(req.params.id), is_read: true }, 'Marked as read');
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/notifications/read-all */
async function markAllRead(req, res, next) {
  try {
    const count = notificationService.markAllRead(req.user.id);
    return ok(res, { updated: count }, 'All notifications marked as read');
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/notifications/:id */
async function removeNotification(req, res, next) {
  try {
    const changed = notificationService.removeNotification(req.user.id, Number(req.params.id));
    if (!changed) throw ApiError.notFound('Notification not found');
    return ok(res, { id: Number(req.params.id) }, 'Notification deleted');
  } catch (err) {
    next(err);
  }
}

module.exports = { listNotifications, markRead, markAllRead, removeNotification };
