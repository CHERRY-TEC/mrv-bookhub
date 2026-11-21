'use strict';

const cron = require('node-cron');
const { getDb } = require('../config/database');
const env = require('../config/environment');
const notificationService = require('./notificationService');
const { addDays, now, daysBetween, isPast } = require('../utils/dateUtils');

/**
 * reminderService - automated due-date reminders for both:
 *   - peer-to-peer borrow transactions
 *   - college library issues
 *
 * Policy (configurable via .env):
 *   REMINDER_UPCOMING_DAYS (default 2) -> "due soon" reminder
 *   1 day before due                  -> "due tomorrow" reminder
 *   after due date                    -> overdue notification
 *
 * Duplicate prevention: reminder_logs has a UNIQUE(entity_type, entity_id,
 * reminder_type). We insert with INSERT OR IGNORE; if no row was inserted
 * the reminder was already sent today for that entity.
 */

function logReminder(entityType, entityId, reminderType) {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO reminder_logs (entity_type, entity_id, reminder_type)
       VALUES (?, ?, ?)`
    )
    .run(entityType, entityId, reminderType);
  return info.changes > 0; // true = newly logged (send), false = duplicate
}

/** Records a reminder attempt for auditing even when already sent. */
function reminderStats() {
  const db = getDb();
  return db.prepare('SELECT reminder_type, COUNT(*) AS count FROM reminder_logs GROUP BY reminder_type').all();
}

// ---------------------------------------------------------------
// Peer-to-peer borrow transactions
// ---------------------------------------------------------------
function scanBorrowTransactions() {
  const db = getDb();
  const upcomingDays = env.REMINDER_UPCOMING_DAYS;
  const rows = db
    .prepare(
      `SELECT t.id, t.due_date, t.transaction_status,
              r.borrower_user_id, r.listing_id, l.book_id,
              b.title
       FROM borrow_transactions t
       JOIN borrow_requests r ON r.id = t.borrow_request_id
       JOIN book_listings l   ON l.id = r.listing_id
       JOIN books b           ON b.id = l.book_id
       WHERE t.transaction_status = 'active'`
    )
    .all();

  const today = now();
  let sent = 0;

  for (const row of rows) {
    const daysLeft = daysBetween(today, row.due_date);

    if (daysLeft < 0) {
      // Overdue
      if (logReminder('borrow_transaction', row.id, 'overdue')) {
        notificationService.createNotification({
          userId: row.borrower_user_id,
          title: `Overdue: "${row.title}"`,
          message: `Your borrow of "${row.title}" was due on ${toDate(row.due_date)} and is now overdue. Please return it to the owner.`,
          type: 'overdue',
        });
        sent++;
      }
    } else if (daysLeft === 1) {
      if (logReminder('borrow_transaction', row.id, 'upcoming_1d')) {
        notificationService.createNotification({
          userId: row.borrower_user_id,
          title: `Due tomorrow: "${row.title}"`,
          message: `"${row.title}" is due back tomorrow (${toDate(row.due_date)}).`,
          type: 'return_reminder',
        });
        sent++;
      }
    } else if (daysLeft <= upcomingDays) {
      if (logReminder('borrow_transaction', row.id, `upcoming_${upcomingDays}d`)) {
        notificationService.createNotification({
          userId: row.borrower_user_id,
          title: `Due in ${daysLeft} days: "${row.title}"`,
          message: `"${row.title}" is due back on ${toDate(row.due_date)} (${daysLeft} days left).`,
          type: 'return_reminder',
        });
        sent++;
      }
    }
  }
  return sent;
}

// ---------------------------------------------------------------
// Library issues
// ---------------------------------------------------------------
function scanLibraryIssues() {
  const db = getDb();
  const upcomingDays = env.REMINDER_UPCOMING_DAYS;
  const rows = db
    .prepare(
      `SELECT i.id, i.due_date, i.student_user_id, b.title
       FROM library_issues i
       JOIN library_inventory inv ON inv.id = i.inventory_id
       JOIN books b ON b.id = inv.book_id
       WHERE i.issue_status IN ('issued', 'overdue')`
    )
    .all();

  const today = now();
  let sent = 0;

  for (const row of rows) {
    const daysLeft = daysBetween(today, row.due_date);

    if (daysLeft < 0) {
      if (logReminder('library_issue', row.id, 'overdue')) {
        db.prepare(
          `UPDATE library_issues SET issue_status = 'overdue' WHERE id = ? AND issue_status = 'issued'`
        ).run(row.id);
        notificationService.createNotification({
          userId: row.student_user_id,
          title: `Library book overdue: "${row.title}"`,
          message: `Your library copy of "${row.title}" was due on ${toDate(row.due_date)}. Please return it to the library counter.`,
          type: 'overdue',
        });
        sent++;
      }
    } else if (daysLeft === 1) {
      if (logReminder('library_issue', row.id, 'upcoming_1d')) {
        notificationService.createNotification({
          userId: row.student_user_id,
          title: `Library book due tomorrow: "${row.title}"`,
          message: `"${row.title}" is due back at the library tomorrow (${toDate(row.due_date)}).`,
          type: 'return_reminder',
        });
        sent++;
      }
    } else if (daysLeft <= upcomingDays) {
      if (logReminder('library_issue', row.id, `upcoming_${upcomingDays}d`)) {
        notificationService.createNotification({
          userId: row.student_user_id,
          title: `Library book due in ${daysLeft} days: "${row.title}"`,
          message: `"${row.title}" is due back at the library on ${toDate(row.due_date)}.`,
          type: 'return_reminder',
        });
        sent++;
      }
    }
  }
  return sent;
}

// ---------------------------------------------------------------
// Expiring / expired library reservations
// ---------------------------------------------------------------
function scanReservations() {
  const db = getDb();
  const inventoryService = require('./inventoryService');
  let handled = 0;

  const expiring = db
    .prepare(
      `SELECT id, reservation_code, student_user_id, inventory_id, expiry_date
       FROM library_reservations
       WHERE reservation_status IN ('pending', 'confirmed')
         AND date(expiry_date) = date('now', '+1 day')`
    )
    .all();

  for (const r of expiring) {
    if (logReminder('library_reservation', r.id, 'expiring_1d')) {
      notificationService.createNotification({
        userId: r.student_user_id,
        title: 'Library reservation expiring soon',
        message: `Your reservation ${r.reservation_code} expires on ${toDate(r.expiry_date)}. Collect it before then.`,
        type: 'reservation_expired',
      });
      handled++;
    }
  }

  const expired = db
    .prepare(
      `SELECT id, reservation_code, student_user_id, inventory_id
       FROM library_reservations
       WHERE reservation_status IN ('pending', 'confirmed')
         AND datetime(expiry_date) < datetime('now')`
    )
    .all();

  for (const r of expired) {
    try {
      inventoryService.releaseReservation(r.inventory_id);
      db.prepare(
        `UPDATE library_reservations SET reservation_status = 'expired' WHERE id = ?`
      ).run(r.id);
      notificationService.createNotification({
        userId: r.student_user_id,
        title: 'Library reservation expired',
        message: `Your reservation ${r.reservation_code} expired and the copy has been released for others.`,
        type: 'reservation_expired',
      });
      handled++;
    } catch (err) {
      console.error(`[REMINDER] Failed to expire reservation ${r.id}:`, err.message);
    }
  }
  return handled;
}

function toDate(ts) {
  return String(ts).slice(0, 10);
}

/** Run every scan once. Exposed for tests and manual triggering. */
function runAllScans() {
  const results = {
    borrowReminders: scanBorrowTransactions(),
    libraryReminders: scanLibraryIssues(),
    reservationEvents: scanReservations(),
  };
  console.log(`[REMINDER] scan complete:`, JSON.stringify(results));
  return results;
}

/** Start the cron scheduler (called by server.js). */
function startReminderScheduler() {
  if (!env.REMINDER_ENABLED) {
    console.log('[REMINDER] scheduler disabled via REMINDER_ENABLED=false');
    return null;
  }
  if (!cron.validate(env.REMINDER_CRON)) {
    console.warn(`[REMINDER] invalid cron "${env.REMINDER_CRON}" - scheduler not started`);
    return null;
  }
  const task = cron.schedule(env.REMINDER_CRON, () => {
    try {
      runAllScans();
    } catch (err) {
      console.error('[REMINDER] scan failed:', err);
    }
  });
  console.log(`[REMINDER] scheduler started (cron: "${env.REMINDER_CRON}")`);
  return task;
}

module.exports = { startReminderScheduler, runAllScans, reminderStats, logReminder };
