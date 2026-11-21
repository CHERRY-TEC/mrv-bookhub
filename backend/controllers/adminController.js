'use strict';

const { getDb, withTransaction } = require('../config/database');
const { ApiError, ok } = require('../utils/response');
const notificationService = require('../services/notificationService');
const auditService = require('../services/auditService');

/**
 * Admin controller - user management, listings, reports, audit logs.
 * Every handler must run behind requireAuth + requireRole('admin').
 */

// ---------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------
async function listUsers(req, res, next) {
  try {
    const db = getDb();
    const { role, status, search, page = 1, limit = 25 } = req.query;

    const clauses = ['1 = 1'];
    const params = [];
    if (role) { clauses.push('u.role = ?'); params.push(role); }
    if (status) { clauses.push('u.account_status = ?'); params.push(status); }
    if (search) {
      clauses.push("(u.full_name LIKE ? OR u.email LIKE ? OR u.mobile_number LIKE ?)");
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * limitNum;
    const where = clauses.join(' AND ');

    const total = db.prepare(`SELECT COUNT(*) AS c FROM users u WHERE ${where}`).get(...params).c;

    const rows = db
      .prepare(
        `SELECT u.id, u.full_name, u.email, u.mobile_number, u.role, u.account_status,
                u.email_verified, u.mobile_verified, u.created_at, u.updated_at,
                s.hall_ticket_number, f.faculty_id, l.staff_id,
                v.vendor_name, v.business_name, v.approval_status,
                d.department_code
         FROM users u
         LEFT JOIN students s ON s.user_id = u.id
         LEFT JOIN faculty f ON f.user_id = u.id
         LEFT JOIN librarians l ON l.user_id = u.id
         LEFT JOIN vendors v ON v.user_id = u.id
         LEFT JOIN departments d ON d.id = COALESCE(s.department_id, f.department_id)
         WHERE ${where}
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limitNum, offset);

    return ok(res, {
      users: rows,
      pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) || 1 },
    }, 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PATCH /api/admin/users/:id/approve
// ---------------------------------------------------------------
async function approveUser(req, res, next) {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) throw ApiError.notFound('User not found');
    if (user.account_status === 'active') throw ApiError.conflict('User is already active');
    if (user.role === 'admin' && user.id !== req.user.id) {
      // approving other admins is allowed but audited loudly
    }

    withTransaction(() => {
      db.prepare(
        `UPDATE users SET account_status = 'active', email_verified = 1, updated_at = datetime('now')
         WHERE id = ?`
      ).run(user.id);

      // Auto-approve linked vendor profile
      db.prepare(
        `UPDATE vendors SET approval_status = 'approved' WHERE user_id = ? AND approval_status = 'pending'`
      ).run(user.id);
    });

    notificationService.createNotification({
      userId: user.id,
      title: 'Account approved',
      message: 'Your MRV BookHub account has been verified and is now active. You can log in and start using the platform.',
      type: 'system_alert',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'user_approved',
      entityType: 'user',
      entityId: user.id,
      details: `${user.full_name} (${user.role})`,
    });

    const updated = db.prepare('SELECT id, full_name, role, account_status FROM users WHERE id = ?').get(user.id);
    return ok(res, updated, 'User approved');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PATCH /api/admin/users/:id/suspend  (body may include action: 'reject')
// ---------------------------------------------------------------
async function suspendUser(req, res, next) {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) throw ApiError.notFound('User not found');
    if (user.id === req.user.id) throw ApiError.badRequest('You cannot suspend your own account');
    if (user.role === 'admin' && req.user.role !== 'admin') {
      throw ApiError.forbidden('Only an admin can suspend an admin');
    }

    const action = req.body.action === 'reject' ? 'rejected' : 'suspended';
    const reason = req.body.reason || null;

    db.prepare('UPDATE users SET account_status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(action, user.id);

    if (action === 'rejected') {
      db.prepare(`UPDATE vendors SET approval_status = 'rejected' WHERE user_id = ?`).run(user.id);
    }

    notificationService.createNotification({
      userId: user.id,
      title: action === 'rejected' ? 'Account application rejected' : 'Account suspended',
      message: reason
        ? `Your account has been ${action}. Reason: ${reason}`
        : `Your account has been ${action}. Contact the administrator for details.`,
      type: 'system_alert',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: `user_${action}`,
      entityType: 'user',
      entityId: user.id,
      details: reason || '',
    });

    const updated = db.prepare('SELECT id, full_name, role, account_status FROM users WHERE id = ?').get(user.id);
    return ok(res, updated, `User ${action}`);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/admin/books
// ---------------------------------------------------------------
async function listAllListings(req, res, next) {
  try {
    const db = getDb();
    const { page = 1, limit = 25, listing_type, active } = req.query;

    const clauses = ['1 = 1'];
    const params = [];
    if (listing_type) { clauses.push('l.listing_type = ?'); params.push(listing_type); }
    if (active === 'true') clauses.push('l.is_active = 1');
    if (active === 'false') clauses.push('l.is_active = 0');

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * limitNum;
    const where = clauses.join(' AND ');

    const total = db.prepare(`SELECT COUNT(*) AS c FROM book_listings l WHERE ${where}`).get(...params).c;

    const rows = db
      .prepare(
        `SELECT l.*, b.title, b.author, b.isbn, b.image_path,
                u.full_name AS owner_name, u.role AS owner_role
         FROM book_listings l
         JOIN books b ON b.id = l.book_id
         JOIN users u ON u.id = l.owner_user_id
         WHERE ${where}
         ORDER BY l.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limitNum, offset);

    return ok(res, {
      listings: rows.map((r) => ({
        id: r.id,
        book_id: r.book_id,
        title: r.title,
        author: r.author,
        isbn: r.isbn,
        listing_type: r.listing_type,
        owner_user_id: r.owner_user_id,
        owner_name: r.owner_name,
        owner_role: r.owner_role,
        price: r.price,
        stock_quantity: r.stock_quantity,
        available: Boolean(r.available),
        is_active: Boolean(r.is_active),
        created_at: r.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) || 1 },
    }, 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// DELETE /api/admin/books/:id
// ---------------------------------------------------------------
async function removeListing(req, res, next) {
  try {
    const db = getDb();
    const listing = db.prepare('SELECT * FROM book_listings WHERE id = ?').get(req.params.id);
    if (!listing) throw ApiError.notFound('Listing not found');

    const activeTx = db
      .prepare(
        `SELECT t.id FROM borrow_transactions t
         JOIN borrow_requests r ON r.id = t.borrow_request_id
         WHERE r.listing_id = ? AND t.transaction_status = 'active'`
      )
      .get(listing.id);
    if (activeTx) {
      throw ApiError.conflict('Cannot remove a listing with an active borrowing transaction');
    }

    withTransaction(() => {
      db.prepare(
        `UPDATE borrow_requests SET status = 'cancelled'
         WHERE listing_id = ? AND status = 'pending'`
      ).run(listing.id);
      db.prepare(
        `UPDATE book_listings SET is_active = 0, available = 0, updated_at = datetime('now') WHERE id = ?`
      ).run(listing.id);
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'admin_listing_removed',
      entityType: 'book_listing',
      entityId: listing.id,
      details: listing.book_id,
    });

    return ok(res, { id: listing.id, is_active: false }, 'Listing removed by administrator');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/admin/reports
// ---------------------------------------------------------------
async function reports(_req, res, next) {
  try {
    const db = getDb();

    const userStats = db
      .prepare(
        `SELECT role, account_status, COUNT(*) AS count FROM users GROUP BY role, account_status`
      )
      .all();

    const listingStats = db
      .prepare(
        `SELECT listing_type, COUNT(*) AS count,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count
         FROM book_listings GROUP BY listing_type`
      )
      .all();

    const borrowStats = db
      .prepare(
        `SELECT status, COUNT(*) AS count FROM borrow_requests GROUP BY status`
      )
      .all();

    const transactionStats = db
      .prepare(
        `SELECT transaction_status, COUNT(*) AS count FROM borrow_transactions GROUP BY transaction_status`
      )
      .all();

    const overduePeer = db
      .prepare(
        `SELECT COUNT(*) AS count FROM borrow_transactions
         WHERE transaction_status = 'active' AND datetime(due_date) < datetime('now')`
      )
      .get().count;

    const libraryStats = db
      .prepare(
        `SELECT COUNT(*) AS titles,
                COALESCE(SUM(total_copies), 0) AS total_copies,
                COALESCE(SUM(available_copies), 0) AS available_copies,
                COALESCE(SUM(reserved_copies), 0) AS reserved_copies,
                COALESCE(SUM(issued_copies), 0) AS issued_copies
         FROM library_inventory`
      )
      .get();

    const libraryOverdue = db
      .prepare(
        `SELECT COUNT(*) AS count FROM library_issues
         WHERE issue_status != 'returned' AND datetime(due_date) < datetime('now')`
      )
      .get().count;

    const orderStats = db
      .prepare(
        `SELECT order_status, COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN total_amount END), 0) AS revenue
         FROM orders GROUP BY order_status`
      )
      .all();

    const vendorStats = db
      .prepare(`SELECT approval_status, COUNT(*) AS count FROM vendors GROUP BY approval_status`)
      .all();

    return ok(res, {
      users: userStats,
      listings: listingStats,
      borrow_requests: borrowStats,
      borrow_transactions: transactionStats,
      overdue_peer_books: overduePeer,
      library: { ...libraryStats, overdue_books: libraryOverdue },
      orders: orderStats,
      vendors: vendorStats,
      generated_at: new Date().toISOString(),
    }, 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/admin/audit-logs
// ---------------------------------------------------------------
async function auditLogs(req, res, next) {
  try {
    const { action, entity_type, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const logs = auditService.getAuditLogs({
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
      action: action || null,
      entityType: entity_type || null,
    });

    return ok(res, { logs }, 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// Department management
// ---------------------------------------------------------------
async function createDepartment(req, res, next) {
  try {
    const { department_name, department_code } = req.body;
    const db = getDb();
    try {
      const info = db
        .prepare('INSERT INTO departments (department_name, department_code) VALUES (?, ?)')
        .run(department_name.trim(), department_code.trim().toUpperCase());

      auditService.logAudit({
        actorUserId: req.user.id,
        action: 'department_created',
        entityType: 'department',
        entityId: info.lastInsertRowid,
        details: department_code,
      });

      return ok(res, { id: info.lastInsertRowid, department_name, department_code }, 'Department created', 201);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        throw ApiError.conflict('A department with that name or code already exists');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

async function deleteDepartment(req, res, next) {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
    if (!dept) throw ApiError.notFound('Department not found');

    const inUse = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM students WHERE department_id = ?) +
                (SELECT COUNT(*) FROM faculty WHERE department_id = ?) +
                (SELECT COUNT(*) FROM books WHERE department_id = ?) AS c`
      )
      .get(id, id, id).c;
    if (inUse > 0) {
      throw ApiError.conflict('Department is in use by students, faculty or books and cannot be deleted');
    }

    db.prepare('DELETE FROM departments WHERE id = ?').run(id);
    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'department_deleted',
      entityType: 'department',
      entityId: id,
      details: dept.department_code,
    });
    return ok(res, { id }, 'Department deleted');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/admin/notifications-broadcast (system alerts)
// ---------------------------------------------------------------
async function broadcast(req, res, next) {
  try {
    const { title, message, role } = req.body;
    const db = getDb();

    let userIds;
    if (role) {
      userIds = db.prepare('SELECT id FROM users WHERE role = ? AND account_status = \'active\'').all(role).map((r) => r.id);
    } else {
      userIds = db.prepare('SELECT id FROM users WHERE account_status = \'active\'').all().map((r) => r.id);
    }

    const count = notificationService.notifyMany(userIds, {
      title, message, type: 'system_alert',
    }).length;

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'system_broadcast',
      entityType: 'notification',
      entityId: null,
      details: `${count} recipients: ${title}`,
    });

    return ok(res, { recipients: count }, 'Broadcast sent', 201);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listUsers,
  approveUser,
  suspendUser,
  listAllListings,
  removeListing,
  reports,
  auditLogs,
  createDepartment,
  deleteDepartment,
  broadcast,
};
