'use strict';

const { getDb } = require('../config/database');

/**
 * Create an in-app notification row.
 * @param {{userId:number, title:string, message:string, type:string}} params
 * @returns {number|null} notification id
 */
function createNotification({ userId, title, message, type }) {
  if (!userId || !title || !message) return null;
  const allowed = [
    'borrow_request', 'borrow_approved', 'borrow_rejected',
    'return_reminder', 'overdue', 'library_reserved', 'library_issued',
    'library_returned', 'reservation_expired', 'order_update', 'system_alert',
  ];
  const safeType = allowed.includes(type) ? type : 'system_alert';

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO notifications (user_id, title, message, notification_type)
       VALUES (?, ?, ?, ?)`
    )
    .run(userId, title, message, safeType);

  // Fire-and-forget email if SMTP is configured (never blocks the API).
  try {
    const emailService = require('./emailService');
    const user = db.prepare('SELECT email, full_name FROM users WHERE id = ?').get(userId);
    if (user && emailService.isConfigured()) {
      emailService.sendEmail({
        to: user.email,
        subject: title,
        text: message,
      }).catch((err) => console.error('[EMAIL] send failed:', err.message));
    }
  } catch (_err) {
    // email service optional
  }

  return info.lastInsertRowid;
}

/** Notify several users at once. */
function notifyMany(userIds, payload) {
  const ids = [...new Set(userIds.filter(Boolean))];
  return ids.map((id) => createNotification({ ...payload, userId: id }));
}

/** List notifications for a user, newest first. */
function getNotifications(userId, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const where = unreadOnly ? 'AND is_read = 0' : '';
  return db
    .prepare(
      `SELECT id, title, message, notification_type AS type, is_read, created_at
       FROM notifications
       WHERE user_id = ? ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(userId, limit, offset);
}

function markRead(userId, notificationId) {
  const db = getDb();
  const info = db
    .prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(notificationId, userId);
  return info.changes > 0;
}

function markAllRead(userId) {
  const db = getDb();
  const info = db
    .prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')
    .run(userId);
  return info.changes;
}

function removeNotification(userId, notificationId) {
  const db = getDb();
  const info = db
    .prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?')
    .run(notificationId, userId);
  return info.changes > 0;
}

function unreadCount(userId) {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(userId);
  return row.c;
}

module.exports = {
  createNotification,
  notifyMany,
  getNotifications,
  markRead,
  markAllRead,
  removeNotification,
  unreadCount,
};
