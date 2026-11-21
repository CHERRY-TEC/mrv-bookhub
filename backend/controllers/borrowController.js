'use strict';

const { getDb, withTransaction } = require('../config/database');
const { ApiError, ok } = require('../utils/response');
const { addDays, now, isPast } = require('../utils/dateUtils');
const notificationService = require('../services/notificationService');
const auditService = require('../services/auditService');

/**
 * Borrow controller - peer to peer borrowing workflow.
 *
 * Flow: request -> approve -> issue (physical handover) -> return
 *                                        \-> extension request/approve/reject
 */

/** Load a request with listing + book + owner context. */
function loadRequest(id) {
  const db = getDb();
  return db
    .prepare(
      `SELECT r.*,
              l.book_id, l.owner_user_id, l.owner_type, l.listing_type,
              l.max_borrow_days, l.available, l.is_active,
              b.title, b.author, b.image_path
       FROM borrow_requests r
       JOIN book_listings l ON l.id = r.listing_id
       JOIN books b ON b.id = l.book_id
       WHERE r.id = ?`
    )
    .get(id);
}

/** Owner or admin may act on a request. */
function assertRequestOwner(req, row) {
  if (!req.user) throw ApiError.unauthorized();
  if (req.user.role === 'admin') return;
  if (row.owner_user_id !== req.user.id) {
    throw ApiError.forbidden('Only the book owner can perform this action');
  }
}

function requestDto(row) {
  return {
    id: row.id,
    listing_id: row.listing_id,
    borrower_user_id: row.borrower_user_id,
    requested_days: row.requested_days,
    request_message: row.request_message,
    status: row.status,
    requested_at: row.requested_at,
    approved_at: row.approved_at,
    rejected_at: row.rejected_at,
    book: {
      book_id: row.book_id,
      title: row.title,
      author: row.author,
      image_path: row.image_path ? `/uploads/book-images/${require('path').basename(row.image_path)}` : null,
    },
    owner_user_id: row.owner_user_id,
    owner_type: row.owner_type,
    borrower_name: row.borrower_name || undefined,
    owner_name: row.owner_name || undefined,
  };
}

// ---------------------------------------------------------------
// POST /api/borrow/request
// ---------------------------------------------------------------
async function createRequest(req, res, next) {
  try {
    const { listing_id, requested_days, request_message } = req.body;
    const db = getDb();

    const listing = db
      .prepare(
        `SELECT l.*, b.title, b.author FROM book_listings l
         JOIN books b ON b.id = l.book_id WHERE l.id = ?`
      )
      .get(listing_id);

    if (!listing || !listing.is_active) throw ApiError.notFound('Book listing not found');
    if (listing.owner_user_id === req.user.id) {
      throw ApiError.badRequest('You cannot request your own book');
    }
    if (!listing.listing_type || listing.listing_type === 'sell') {
      throw ApiError.badRequest('This book is not available for borrowing');
    }
    if (!listing.available) {
      throw ApiError.conflict('Book is not available');
    }
    if (listing.max_borrow_days && Number(requested_days) > listing.max_borrow_days) {
      throw ApiError.validationError(
        `Requested days exceed the owner limit of ${listing.max_borrow_days} days`
      );
    }

    // Prevent duplicate active requests for the same listing
    const duplicate = db
      .prepare(
        `SELECT id FROM borrow_requests
         WHERE listing_id = ? AND borrower_user_id = ? AND status IN ('pending','approved')`
      )
      .get(listing_id, req.user.id);
    if (duplicate) {
      throw ApiError.conflict('You already have an active request for this book');
    }

    const info = db
      .prepare(
        `INSERT INTO borrow_requests (listing_id, borrower_user_id, requested_days, request_message)
         VALUES (?, ?, ?, ?)`
      )
      .run(listing_id, req.user.id, Number(requested_days), request_message || null);

    notificationService.createNotification({
      userId: listing.owner_user_id,
      title: `New borrow request: "${listing.title}"`,
      message: `${req.user.full_name} wants to borrow "${listing.title}" for ${requested_days} days.`,
      type: 'borrow_request',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'borrow_requested',
      entityType: 'borrow_request',
      entityId: info.lastInsertRowid,
      details: listing.title,
    });

    const row = loadRequest(info.lastInsertRowid);
    return ok(res, requestDto(row), 'Borrow request sent', 201);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/borrow/my-requests  &  GET /api/borrow/received-requests
// ---------------------------------------------------------------
async function myRequests(req, res, next) {
  try {
    const db = getDb();
    const status = req.query.status;
    const params = [req.user.id];
    let statusClause = '';
    if (status) {
      statusClause = 'AND r.status = ?';
      params.push(status);
    }

    const rows = db
      .prepare(
        `SELECT r.*, l.book_id, l.owner_user_id, l.owner_type, l.max_borrow_days, l.available, l.is_active,
                b.title, b.author, b.image_path,
                u.full_name AS owner_name, bu.full_name AS borrower_name,
                t.id AS transaction_id, t.issue_date, t.due_date, t.return_date,
                t.transaction_status, t.extension_days
         FROM borrow_requests r
         JOIN book_listings l ON l.id = r.listing_id
         JOIN books b ON b.id = l.book_id
         JOIN users u ON u.id = l.owner_user_id
         JOIN users bu ON bu.id = r.borrower_user_id
         LEFT JOIN borrow_transactions t ON t.borrow_request_id = r.id
         WHERE r.borrower_user_id = ? ${statusClause}
         ORDER BY r.requested_at DESC`
      )
      .all(...params);

    return ok(res, rows.map((row) => ({
      ...requestDto(row),
      transaction: row.transaction_id ? {
        id: row.transaction_id,
        issue_date: row.issue_date,
        due_date: row.due_date,
        return_date: row.return_date,
        status: row.transaction_status,
        extension_days: row.extension_days,
      } : null,
    })), 'OK');
  } catch (err) {
    next(err);
  }
}

async function receivedRequests(req, res, next) {
  try {
    const db = getDb();
    const status = req.query.status;
    const params = [];
    let statusClause = '';
    if (status) {
      statusClause = 'AND r.status = ?';
      params.push(status);
    }
    const whereOwner = req.user.role === 'admin' ? '' : 'l.owner_user_id = ?';
    if (whereOwner) params.unshift(req.user.id);

    const rows = db
      .prepare(
        `SELECT r.*, l.book_id, l.owner_user_id, l.owner_type, l.max_borrow_days, l.available, l.is_active,
                b.title, b.author, b.image_path,
                u.full_name AS owner_name, bu.full_name AS borrower_name
         FROM borrow_requests r
         JOIN book_listings l ON l.id = r.listing_id
         JOIN books b ON b.id = l.book_id
         JOIN users u ON u.id = l.owner_user_id
         JOIN users bu ON bu.id = r.borrower_user_id
         WHERE ${whereOwner} ${whereOwner ? 'AND' : ''} 1 = 1 ${statusClause}
         ORDER BY r.requested_at DESC`
      )
      .all(...params);

    return ok(res, rows.map(requestDto), 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PATCH /api/borrow/:id/approve
// ---------------------------------------------------------------
async function approveRequest(req, res, next) {
  try {
    const row = loadRequest(req.params.id);
    if (!row) throw ApiError.notFound('Borrow request not found');
    assertRequestOwner(req, row);

    if (row.status !== 'pending') throw ApiError.conflict(`Request is already ${row.status}`);
    if (!row.is_active) throw ApiError.conflict('This listing is no longer active');
    if (!row.available) throw ApiError.conflict('Book is not available');

    withTransaction(() => {
      const db = getDb();
      // Reserve the listing so no other request can be approved concurrently
      const info = db
        .prepare(
          `UPDATE borrow_requests SET status = 'approved', approved_at = datetime('now')
           WHERE id = ? AND status = 'pending'`
        )
        .run(row.id);
      if (info.changes === 0) throw ApiError.conflict('Request was already processed');

      db.prepare('UPDATE book_listings SET available = 0, updated_at = datetime(\'now\') WHERE id = ?')
        .run(row.listing_id);
    });

    notificationService.createNotification({
      userId: row.borrower_user_id,
      title: `Borrow request approved: "${row.title}"`,
      message: `${row.owner_name || 'The owner'} approved your request. Coordinate the handover to collect "${row.title}".`,
      type: 'borrow_approved',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'borrow_approved',
      entityType: 'borrow_request',
      entityId: row.id,
      details: row.title,
    });

    return ok(res, requestDto(loadRequest(row.id)), 'Request approved');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PATCH /api/borrow/:id/reject
// ---------------------------------------------------------------
async function rejectRequest(req, res, next) {
  try {
    const row = loadRequest(req.params.id);
    if (!row) throw ApiError.notFound('Borrow request not found');
    assertRequestOwner(req, row);

    if (row.status !== 'pending') throw ApiError.conflict(`Request is already ${row.status}`);

    const reason = req.body.reason || null;
    getDb()
      .prepare(
        `UPDATE borrow_requests SET status = 'rejected', rejected_at = datetime('now') WHERE id = ?`
      )
      .run(row.id);

    notificationService.createNotification({
      userId: row.borrower_user_id,
      title: `Borrow request rejected: "${row.title}"`,
      message: reason
        ? `Your request for "${row.title}" was rejected. Reason: ${reason}`
        : `Your request for "${row.title}" was rejected.`,
      type: 'borrow_rejected',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'borrow_rejected',
      entityType: 'borrow_request',
      entityId: row.id,
      details: reason || '',
    });

    return ok(res, requestDto(loadRequest(row.id)), 'Request rejected');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// POST /api/borrow/:id/cancel (borrower cancels a pending request)
// ---------------------------------------------------------------
async function cancelRequest(req, res, next) {
  try {
    const row = loadRequest(req.params.id);
    if (!row) throw ApiError.notFound('Borrow request not found');
    if (row.borrower_user_id !== req.user.id && req.user.role !== 'admin') {
      throw ApiError.forbidden('Only the borrower can cancel this request');
    }
    if (row.status !== 'pending') throw ApiError.conflict(`Request is already ${row.status}`);

    getDb().prepare(`UPDATE borrow_requests SET status = 'cancelled' WHERE id = ?`).run(row.id);

    return ok(res, requestDto(loadRequest(row.id)), 'Request cancelled');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// POST /api/borrow/:id/issue - record physical handover
// ---------------------------------------------------------------
async function issueBook(req, res, next) {
  try {
    const row = loadRequest(req.params.id);
    if (!row) throw ApiError.notFound('Borrow request not found');

    // Owner, borrower or admin may record the handover
    const isOwner = row.owner_user_id === req.user.id;
    const isBorrower = row.borrower_user_id === req.user.id;
    if (!isOwner && !isBorrower && req.user.role !== 'admin') {
      throw ApiError.forbidden('Only the owner, borrower or admin can record the handover');
    }
    if (row.status !== 'approved') throw ApiError.conflict('Request must be approved before issuing');

    const db = getDb();
    const existing = db
      .prepare('SELECT id FROM borrow_transactions WHERE borrow_request_id = ?')
      .get(row.id);
    if (existing) throw ApiError.conflict('This request has already been issued');

    const issueDate = now();
    const dueDate = addDays(issueDate, row.requested_days + 0);

    const info = db
      .prepare(
        `INSERT INTO borrow_transactions
           (borrow_request_id, issue_date, due_date, original_due_date, transaction_status)
         VALUES (?, ?, ?, ?, 'active')`
      )
      .run(row.id, issueDate, dueDate, dueDate);

    notificationService.createNotification({
      userId: row.borrower_user_id,
      title: `Book handed over: "${row.title}"`,
      message: `"${row.title}" is now with you. It is due back on ${dueDate.slice(0, 10)}.`,
      type: 'library_issued',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'borrow_issued',
      entityType: 'borrow_transaction',
      entityId: info.lastInsertRowid,
      details: `${row.title} due ${dueDate}`,
    });

    return ok(res, {
      transaction_id: info.lastInsertRowid,
      borrow_request_id: row.id,
      issue_date: issueDate,
      due_date: dueDate,
      approved_days: row.requested_days,
    }, 'Book issued successfully', 201);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PATCH /api/borrow/:id/return
// ---------------------------------------------------------------
async function returnBook(req, res, next) {
  try {
    const row = loadRequest(req.params.id);
    if (!row) throw ApiError.notFound('Borrow request not found');

    const isOwner = row.owner_user_id === req.user.id;
    const isBorrower = row.borrower_user_id === req.user.id;
    if (!isOwner && !isBorrower && req.user.role !== 'admin') {
      throw ApiError.forbidden('Only the owner, borrower or admin can record the return');
    }

    const db = getDb();
    const tx = db
      .prepare('SELECT * FROM borrow_transactions WHERE borrow_request_id = ?')
      .get(row.id);
    if (!tx) throw ApiError.notFound('No active transaction for this request');
    if (tx.transaction_status === 'returned') throw ApiError.conflict('Book already returned');

    const returnDate = now();

    withTransaction(() => {
      db.prepare(
        `UPDATE borrow_transactions
         SET return_date = ?, transaction_status = 'returned'
         WHERE id = ? AND transaction_status != 'returned'`
      ).run(returnDate, tx.id);

      db.prepare(`UPDATE borrow_requests SET status = 'returned' WHERE id = ?`).run(row.id);
      db.prepare('UPDATE book_listings SET available = 1, updated_at = datetime(\'now\') WHERE id = ?')
        .run(row.listing_id);
    });

    notificationService.createNotification({
      userId: row.owner_user_id,
      title: `Book returned: "${row.title}"`,
      message: `${req.user.full_name} returned "${row.title}".`,
      type: 'library_returned',
    });
    if (row.borrower_user_id !== req.user.id) {
      notificationService.createNotification({
        userId: row.borrower_user_id,
        title: `Return recorded: "${row.title}"`,
        message: `Your return of "${row.title}" has been recorded. Thank you!`,
        type: 'library_returned',
      });
    }

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'borrow_returned',
      entityType: 'borrow_transaction',
      entityId: tx.id,
      details: row.title,
    });

    return ok(res, {
      transaction_id: tx.id,
      return_date: returnDate,
      status: 'returned',
    }, 'Book returned successfully');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// Extension workflow
// ---------------------------------------------------------------
async function extensionRequest(req, res, next) {
  try {
    const row = loadRequest(req.params.id);
    if (!row) throw ApiError.notFound('Borrow request not found');
    if (row.borrower_user_id !== req.user.id && req.user.role !== 'admin') {
      throw ApiError.forbidden('Only the borrower can request an extension');
    }

    const db = getDb();
    const tx = db.prepare('SELECT * FROM borrow_transactions WHERE borrow_request_id = ?').get(row.id);
    if (!tx) throw ApiError.notFound('No active transaction for this request');
    if (tx.transaction_status !== 'active') throw ApiError.conflict('Transaction is not active');

    const extensionDays = Number(req.body.extension_days);
    if (!extensionDays || extensionDays < 1 || extensionDays > 60) {
      throw ApiError.validationError('extension_days must be between 1 and 60');
    }

    // Mark pending extension in the transaction record
    const history = JSON.parse(tx.extension_history || '[]');
    if (history.some((h) => h.status === 'pending')) {
      throw ApiError.conflict('An extension request is already pending');
    }
    history.push({
      requested_days: extensionDays,
      requested_at: now(),
      requested_by: req.user.id,
      status: 'pending',
    });
    db.prepare('UPDATE borrow_transactions SET extension_history = ? WHERE id = ?')
      .run(JSON.stringify(history), tx.id);

    notificationService.createNotification({
      userId: row.owner_user_id,
      title: `Extension requested: "${row.title}"`,
      message: `${req.user.full_name} requests ${extensionDays} more days for "${row.title}".`,
      type: 'borrow_request',
    });

    return ok(res, { transaction_id: tx.id, extension_days: extensionDays }, 'Extension request sent', 201);
  } catch (err) {
    next(err);
  }
}

/** Shared approve/reject logic for extensions. */
async function decideExtension(req, res, next, decision) {
  try {
    const row = loadRequest(req.params.id);
    if (!row) throw ApiError.notFound('Borrow request not found');
    assertRequestOwner(req, row);

    const db = getDb();
    const tx = db.prepare('SELECT * FROM borrow_transactions WHERE borrow_request_id = ?').get(row.id);
    if (!tx) throw ApiError.notFound('No active transaction for this request');

    const history = JSON.parse(tx.extension_history || '[]');
    const pendingIdx = history.findIndex((h) => h.status === 'pending');
    if (pendingIdx === -1) throw ApiError.conflict('No pending extension request');

    const entry = history[pendingIdx];
    entry.status = decision;
    entry.decided_at = now();
    entry.decided_by = req.user.id;

    if (decision === 'approved') {
      // Keep original_due_date intact; new due date is recorded alongside.
      const newDue = addDays(tx.due_date, entry.requested_days);
      entry.new_due_date = newDue;
      db.prepare(
        `UPDATE borrow_transactions
         SET extension_days = extension_days + ?, due_date = ?, extension_history = ?
         WHERE id = ?`
      ).run(entry.requested_days, newDue, JSON.stringify(history), tx.id);

      notificationService.createNotification({
        userId: row.borrower_user_id,
        title: `Extension approved: "${row.title}"`,
        message: `Your extension was approved. New due date: ${newDue.slice(0, 10)}.`,
        type: 'borrow_approved',
      });
    } else {
      db.prepare('UPDATE borrow_transactions SET extension_history = ? WHERE id = ?')
        .run(JSON.stringify(history), tx.id);

      notificationService.createNotification({
        userId: row.borrower_user_id,
        title: `Extension rejected: "${row.title}"`,
        message: `Your extension request for "${row.title}" was rejected. Original due date stands: ${tx.due_date.slice(0, 10)}.`,
        type: 'borrow_rejected',
      });
    }

    auditService.logAudit({
      actorUserId: req.user.id,
      action: `extension_${decision}`,
      entityType: 'borrow_transaction',
      entityId: tx.id,
      details: row.title,
    });

    const updated = db.prepare('SELECT * FROM borrow_transactions WHERE id = ?').get(tx.id);
    return ok(res, {
      transaction_id: tx.id,
      status: decision,
      due_date: updated.due_date,
      original_due_date: updated.original_due_date,
      extension_days: updated.extension_days,
      extension_history: JSON.parse(updated.extension_history || '[]'),
    }, `Extension ${decision}`);
  } catch (err) {
    next(err);
  }
}

const extensionApprove = (req, res, next) => decideExtension(req, res, next, 'approved');
const extensionReject = (req, res, next) => decideExtension(req, res, next, 'rejected');

// ---------------------------------------------------------------
// GET /api/borrow/history - transaction history
// ---------------------------------------------------------------
async function history(req, res, next) {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT t.*, r.listing_id, r.borrower_user_id, r.requested_days,
                l.owner_user_id, b.title, b.author,
                bu.full_name AS borrower_name, ou.full_name AS owner_name
         FROM borrow_transactions t
         JOIN borrow_requests r ON r.id = t.borrow_request_id
         JOIN book_listings l ON l.id = r.listing_id
         JOIN books b ON b.id = l.book_id
         JOIN users bu ON bu.id = r.borrower_user_id
         JOIN users ou ON ou.id = l.owner_user_id
         WHERE r.borrower_user_id = ? OR l.owner_user_id = ? OR ? = 'admin'
         ORDER BY t.created_at DESC`
      )
      .all(req.user.id, req.user.id, req.user.role);

    return ok(res, rows.map((t) => ({
      id: t.id,
      borrow_request_id: t.borrow_request_id,
      title: t.title,
      author: t.author,
      borrower_name: t.borrower_name,
      owner_name: t.owner_name,
      issue_date: t.issue_date,
      due_date: t.due_date,
      original_due_date: t.original_due_date,
      return_date: t.return_date,
      status: t.transaction_status,
      extension_days: t.extension_days,
      extension_history: JSON.parse(t.extension_history || '[]'),
      is_overdue: t.transaction_status === 'active' && isPast(t.due_date),
    })), 'OK');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createRequest,
  myRequests,
  receivedRequests,
  approveRequest,
  rejectRequest,
  cancelRequest,
  issueBook,
  returnBook,
  extensionRequest,
  extensionApprove,
  extensionReject,
  history,
};
