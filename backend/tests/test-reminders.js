'use strict';

/** Verify reminder scanning + duplicate suppression. Usage: node tests/test-reminders.js */

const { initDatabase, getDb, closeDatabase } = require('../config/database');
const { addDays, now } = require('../utils/dateUtils');

initDatabase();
const reminderService = require('../services/reminderService');
const db = getDb();

// Force the seeded active borrow transaction + library issue into the past
db.prepare("UPDATE borrow_transactions SET due_date = ? WHERE transaction_status = 'active'").run(addDays(now(), -3));
db.prepare("UPDATE library_issues SET due_date = ? WHERE issue_status = 'issued'").run(addDays(now(), -2));

const first = reminderService.runAllScans();
console.log('first scan:', JSON.stringify(first));

const second = reminderService.runAllScans();
console.log('second scan (must be all zeros):', JSON.stringify(second));

const notifs = db
  .prepare("SELECT notification_type, COUNT(*) AS c FROM notifications WHERE notification_type IN ('overdue','return_reminder') GROUP BY notification_type")
  .all();
console.log('reminder notifications:', JSON.stringify(notifs));

const logs = db.prepare('SELECT reminder_type, COUNT(*) AS c FROM reminder_logs GROUP BY reminder_type').all();
console.log('reminder log entries:', JSON.stringify(logs));

const okDuplicates = Object.values(second).every((v) => v === 0);
const okOverdue = notifs.some((n) => n.notification_type === 'overdue' && n.c >= 2);
console.log(okDuplicates && okOverdue ? 'REMINDER TESTS PASSED' : 'REMINDER TESTS FAILED');
closeDatabase();
process.exit(okDuplicates && okOverdue ? 0 : 1);
