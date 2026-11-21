'use strict';

const { getDb, withTransaction } = require('../config/database');
const env = require('../config/environment');
const { ApiError, ok } = require('../utils/response');
const { addDays, now, isPast, daysBetween } = require('../utils/dateUtils');
const { generateReservationId } = require('../utils/generateReservationId');
const { sanitizeSearchTerm } = require('../middleware/validationMiddleware');
const inventoryService = require('../services/inventoryService');
const notificationService = require('../services/notificationService');
const auditService = require('../services/auditService');

/**
 * Digital library module - inventory, reservations, counter issue/return.
 *
 * Inventory invariant (total = available + reserved + issued) is enforced
 * by inventoryService inside database transactions.
 */

// ---------------------------------------------------------------
// POST /api/library/inventory - librarian adds library book
// ---------------------------------------------------------------
async function addInventory(req, res, next) {
  try {
    const {
      title, author, edition, isbn, course_code, department_id,
      category, total_copies, shelf_number, rack_number, max_issue_days,
    } = req.body;

    const db = getDb();
    let departmentId = null;
    if (department_id) {
      const d = db.prepare('SELECT id FROM departments WHERE id = ?').get(department_id);
      if (!d) throw ApiError.validationError('Unknown department_id');
      departmentId = department_id;
    }

    const inventory = withTransaction(() => {
      // Link to an existing catalogue book by ISBN, else create one
      let bookId = null;
      if (isbn) {
        const existing = db.prepare('SELECT id FROM books WHERE isbn = ?').get(isbn);
        if (existing) bookId = existing.id;
      }
      if (!bookId) {
        const info = db
          .prepare(
            `INSERT INTO books (title, author, edition, isbn, course_code, department_id, category, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            title.trim(), author.trim(), edition || null, isbn || null,
            course_code || null, departmentId, category || null, req.user.id
          );
        bookId = info.lastInsertRowid;
      }

      return inventoryService.createInventory({
        bookId,
        totalCopies: Number(total_copies),
        shelfNumber: shelf_number,
        rackNumber: rack_number,
        maxIssueDays: max_issue_days || env.DEFAULT_MAX_ISSUE_DAYS,
      });
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'inventory_created',
      entityType: 'library_inventory',
      entityId: inventory.id,
      details: `${title} x${total_copies}`,
    });

    return ok(res, inventory, 'Library book added to inventory', 201);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PUT /api/library/inventory/:id
// ---------------------------------------------------------------
async function updateInventory(req, res, next) {
  try {
    const { total_copies, shelf_number, rack_number, max_issue_days } = req.body;
    const patch = {};
    if (total_copies !== undefined) patch.total_copies = Number(total_copies);
    if (shelf_number !== undefined) patch.shelf_number = shelf_number;
    if (rack_number !== undefined) patch.rack_number = rack_number;
    if (max_issue_days !== undefined) patch.max_issue_days = Number(max_issue_days);

    if (patch.max_issue_days !== undefined && (patch.max_issue_days < 1 || patch.max_issue_days > 120)) {
      throw ApiError.validationError('max_issue_days must be between 1 and 120');
    }

    const updated = inventoryService.updateInventory(Number(req.params.id), patch);

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'inventory_updated',
      entityType: 'library_inventory',
      entityId: Number(req.params.id),
      details: JSON.stringify(patch),
    });

    return ok(res, updated, 'Inventory updated');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/library/books - search library catalogue (students + all)
// ---------------------------------------------------------------
async function searchLibraryBooks(req, res, next) {
  try {
    const db = getDb();
    const { title, author, isbn, course_code, department, availability, page = 1, limit = 20 } = req.query;

    const clauses = ['1 = 1'];
    const params = [];

    const like = (col, val) => {
      clauses.push(`${col} LIKE ? ESCAPE '\\'`);
      params.push(`%${sanitizeSearchTerm(val)}%`);
    };

    if (title) like('b.title', title);
    if (author) like('b.author', author);
    if (isbn) { clauses.push("b.isbn LIKE ? ESCAPE '\\'"); params.push(`%${sanitizeSearchTerm(isbn)}%`); }
    if (course_code) like('b.course_code', course_code);
    if (department) {
      if (/^\d+$/.test(department)) {
        clauses.push('b.department_id = ?');
        params.push(Number(department));
      } else {
        clauses.push('(d.department_code = ? OR d.department_name = ?)');
        params.push(department.toUpperCase(), department);
      }
    }
    if (availability === 'available') clauses.push('i.available_copies > 0');
    if (availability === 'unavailable') clauses.push('i.available_copies = 0');

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = clauses.join(' AND ');

    const total = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM library_inventory i
         JOIN books b ON b.id = i.book_id
         LEFT JOIN departments d ON d.id = b.department_id
         WHERE ${where}`
      )
      .get(...params).c;

    const rows = db
      .prepare(
        `SELECT i.id AS inventory_id, i.total_copies, i.available_copies, i.reserved_copies,
                i.issued_copies, i.shelf_number, i.rack_number, i.max_issue_days, i.updated_at,
                b.id AS book_id, b.title, b.author, b.edition, b.isbn, b.course_code,
                b.category, b.description, b.image_path,
                d.department_code, d.department_name
         FROM library_inventory i
         JOIN books b ON b.id = i.book_id
         LEFT JOIN departments d ON d.id = b.department_id
         WHERE ${where}
         ORDER BY b.title COLLATE NOCASE ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limitNum, offset);

    return ok(res, {
      books: rows.map((r) => ({
        inventory_id: r.inventory_id,
        book_id: r.book_id,
        title: r.title,
        author: r.author,
        edition: r.edition,
        isbn: r.isbn,
        course_code: r.course_code,
        category: r.category,
        description: r.description,
        image_path: r.image_path ? `/uploads/book-images/${require('path').basename(r.image_path)}` : null,
        department_code: r.department_code,
        department_name: r.department_name,
        total_copies: r.total_copies,
        available_copies: r.available_copies,
        reserved_copies: r.reserved_copies,
        issued_copies: r.issued_copies,
        shelf_number: r.shelf_number,
        rack_number: r.rack_number,
        max_issue_days: r.max_issue_days,
        is_available: r.available_copies > 0,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum) || 1,
      },
    }, 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/library/inventory - librarian full inventory list
// ---------------------------------------------------------------
async function listInventory(req, res, next) {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT i.*, b.title, b.author, b.isbn, b.course_code, b.image_path,
                d.department_code, d.department_name
         FROM library_inventory i
         JOIN books b ON b.id = i.book_id
         LEFT JOIN departments d ON d.id = b.department_id
         ORDER BY b.title COLLATE NOCASE ASC`
      )
      .all();

    return ok(res, rows.map((r) => ({
      ...r,
      image_path: r.image_path ? `/uploads/book-images/${require('path').basename(r.image_path)}` : null,
      is_available: r.available_copies > 0,
    })), 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// POST /api/library/reservations - student reserves a copy
// ---------------------------------------------------------------
async function createReservation(req, res, next) {
  try {
    const { inventory_id } = req.body;
    const db = getDb();

    const inventory = inventoryService.getInventoryById(Number(inventory_id));
    if (!inventory) throw ApiError.notFound('Library book not found');

    // Duplicate active reservation check
    const duplicate = db
      .prepare(
        `SELECT id, reservation_code FROM library_reservations
         WHERE student_user_id = ? AND inventory_id = ?
           AND reservation_status IN ('pending','confirmed')`
      )
      .get(req.user.id, inventory.id);
    if (duplicate) {
      throw ApiError.conflict(`You already have an active reservation (${duplicate.reservation_code})`);
    }

    // Reserve one copy atomically (rolls back on any failure)
    const reservation = withTransaction(() => {
      inventoryService.reserveCopy(inventory.id);

      const code = generateReservationId();
      const expiry = addDays(now(), env.RESERVATION_EXPIRY_DAYS);

      const info = db
        .prepare(
          `INSERT INTO library_reservations
             (reservation_code, student_user_id, inventory_id, reservation_status, expiry_date)
           VALUES (?, ?, ?, 'pending', ?)`
        )
        .run(code, req.user.id, inventory.id, expiry);

      return {
        id: info.lastInsertRowid,
        reservation_code: code,
        expiry_date: expiry,
      };
    });

    notificationService.createNotification({
      userId: req.user.id,
      title: 'Library reservation placed',
      message: `Your reservation ${reservation.reservation_code} for "${inventory.title}" is pending librarian approval. Collect by ${reservation.expiry_date.slice(0, 10)}.`,
      type: 'library_reserved',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'library_reserved',
      entityType: 'library_reservation',
      entityId: reservation.id,
      details: `${reservation.reservation_code} - ${inventory.title}`,
    });

    return ok(res, {
      ...reservation,
      inventory_id: inventory.id,
      title: inventory.title,
      available_copies: inventoryService.getInventoryById(inventory.id).available_copies,
    }, 'Book reserved successfully', 201);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/library/my-reservations
// ---------------------------------------------------------------
async function myReservations(req, res, next) {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT r.*, b.title, b.author, b.isbn, i.shelf_number, i.rack_number
         FROM library_reservations r
         JOIN library_inventory i ON i.id = r.inventory_id
         JOIN books b ON b.id = i.book_id
         WHERE r.student_user_id = ?
         ORDER BY r.created_at DESC`
      )
      .all(req.user.id);

    return ok(res, rows.map(decorateReservation), 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/library/reservations - librarian view
// ---------------------------------------------------------------
async function listReservations(req, res, next) {
  try {
    const db = getDb();
    const { status, page = 1, limit = 30 } = req.query;
    const clauses = ['1 = 1'];
    const params = [];
    if (status) { clauses.push('r.reservation_status = ?'); params.push(status); }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
    const offset = (pageNum - 1) * limitNum;
    const where = clauses.join(' AND ');

    const total = db
      .prepare(`SELECT COUNT(*) AS c FROM library_reservations r WHERE ${where}`)
      .get(...params).c;

    const rows = db
      .prepare(
        `SELECT r.*, b.title, b.author, b.isbn, i.shelf_number, i.rack_number,
                u.full_name AS student_name, s.hall_ticket_number
         FROM library_reservations r
         JOIN library_inventory i ON i.id = r.inventory_id
         JOIN books b ON b.id = i.book_id
         JOIN users u ON u.id = r.student_user_id
         LEFT JOIN students s ON s.user_id = u.id
         WHERE ${where}
         ORDER BY r.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limitNum, offset);

    return ok(res, {
      reservations: rows.map(decorateReservation),
      pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) || 1 },
    }, 'OK');
  } catch (err) {
    next(err);
  }
}

function decorateReservation(r) {
  return {
    id: r.id,
    reservation_code: r.reservation_code,
    inventory_id: r.inventory_id,
    student_user_id: r.student_user_id,
    student_name: r.student_name,
    hall_ticket_number: r.hall_ticket_number,
    status: r.reservation_status,
    reservation_date: r.reservation_date,
    expiry_date: r.expiry_date,
    created_at: r.created_at,
    is_expired: isPast(r.expiry_date),
    days_until_expiry: Math.max(0, daysBetween(now(), r.expiry_date)),
    book: {
      title: r.title,
      author: r.author,
      isbn: r.isbn,
      shelf_number: r.shelf_number,
      rack_number: r.rack_number,
    },
  };
}

// ---------------------------------------------------------------
// PATCH /api/library/reservations/:id/approve (librarian)
// ---------------------------------------------------------------
async function approveReservation(req, res, next) {
  try {
    const db = getDb();
    const r = db.prepare('SELECT * FROM library_reservations WHERE id = ?').get(req.params.id);
    if (!r) throw ApiError.notFound('Reservation not found');
    if (r.reservation_status !== 'pending') {
      throw ApiError.conflict(`Reservation is already ${r.reservation_status}`);
    }
    if (isPast(r.expiry_date)) throw ApiError.conflict('Reservation has expired');

    db.prepare(
      `UPDATE library_reservations SET reservation_status = 'confirmed' WHERE id = ?`
    ).run(r.id);

    notificationService.createNotification({
      userId: r.student_user_id,
      title: 'Library reservation confirmed',
      message: `Your reservation ${r.reservation_code} is confirmed. Collect it before ${r.expiry_date.slice(0, 10)} (show your hall ticket at the counter).`,
      type: 'library_reserved',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'reservation_approved',
      entityType: 'library_reservation',
      entityId: r.id,
      details: r.reservation_code,
    });

    const updated = db.prepare('SELECT * FROM library_reservations WHERE id = ?').get(r.id);
    return ok(res, updated, 'Reservation approved');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PATCH /api/library/reservations/:id/reject (librarian)
// ---------------------------------------------------------------
async function rejectReservation(req, res, next) {
  try {
    const db = getDb();
    const r = db.prepare('SELECT * FROM library_reservations WHERE id = ?').get(req.params.id);
    if (!r) throw ApiError.notFound('Reservation not found');
    if (!['pending', 'confirmed'].includes(r.reservation_status)) {
      throw ApiError.conflict(`Reservation is already ${r.reservation_status}`);
    }

    withTransaction(() => {
      inventoryService.releaseReservation(r.inventory_id);
      db.prepare(`UPDATE library_reservations SET reservation_status = 'rejected' WHERE id = ?`).run(r.id);
    });

    notificationService.createNotification({
      userId: r.student_user_id,
      title: 'Library reservation rejected',
      message: `Your reservation ${r.reservation_code} was rejected. The copy is available for others.`,
      type: 'system_alert',
    });

    return ok(res, { id: r.id, status: 'rejected' }, 'Reservation rejected');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PATCH /api/library/reservations/:id/cancel
// ---------------------------------------------------------------
async function cancelReservation(req, res, next) {
  try {
    const db = getDb();
    const r = db.prepare('SELECT * FROM library_reservations WHERE id = ?').get(req.params.id);
    if (!r) throw ApiError.notFound('Reservation not found');

    const isOwn = r.student_user_id === req.user.id;
    if (!isOwn && req.user.role !== 'admin' && req.user.role !== 'librarian') {
      throw ApiError.forbidden('You can only cancel your own reservation');
    }
    if (!['pending', 'confirmed'].includes(r.reservation_status)) {
      throw ApiError.conflict(`Reservation is already ${r.reservation_status}`);
    }

    withTransaction(() => {
      inventoryService.releaseReservation(r.inventory_id);
      db.prepare(`UPDATE library_reservations SET reservation_status = 'cancelled' WHERE id = ?`).run(r.id);
    });

    notificationService.createNotification({
      userId: r.student_user_id,
      title: 'Library reservation cancelled',
      message: `Reservation ${r.reservation_code} was cancelled and the copy released.`,
      type: 'system_alert',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'reservation_cancelled',
      entityType: 'library_reservation',
      entityId: r.id,
      details: r.reservation_code,
    });

    return ok(res, { id: r.id, status: 'cancelled' }, 'Reservation cancelled');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// POST /api/library/issues - librarian issues book at counter
// ---------------------------------------------------------------
async function issueBook(req, res, next) {
  try {
    const { reservation_id, hall_ticket_number, student_user_id } = req.body;
    const db = getDb();

    const r = db.prepare('SELECT * FROM library_reservations WHERE id = ?').get(reservation_id);
    if (!r) throw ApiError.notFound('Reservation not found');

    if (!['pending', 'confirmed'].includes(r.reservation_status)) {
      throw ApiError.conflict(`Cannot issue: reservation is ${r.reservation_status}`);
    }
    if (isPast(r.expiry_date)) {
      throw ApiError.conflict('Reservation has expired - ask the student to re-reserve');
    }

    // Verify student identity (hall ticket OR explicit user id)
    let studentUserId = r.student_user_id;
    if (hall_ticket_number) {
      const student = db
        .prepare(
          `SELECT s.user_id FROM students s WHERE UPPER(s.hall_ticket_number) = UPPER(?)`
        )
        .get(hall_ticket_number);
      if (!student) throw ApiError.validationError('Student not found with that hall ticket number');
      if (student.user_id !== r.student_user_id) {
        throw ApiError.conflict('Reservation does not belong to this student');
      }
      studentUserId = student.user_id;
    } else if (student_user_id && Number(student_user_id) !== r.student_user_id) {
      throw ApiError.conflict('Reservation does not belong to this student');
    }

    const inventory = inventoryService.getInventoryById(r.inventory_id);
    if (!inventory) throw ApiError.notFound('Inventory record not found');

    const existingIssue = db
      .prepare(`SELECT id FROM library_issues WHERE reservation_id = ? AND issue_status != 'returned'`)
      .get(r.id);
    if (existingIssue) throw ApiError.conflict('This reservation has already been issued');

    const issueDate = now();
    const dueDate = addDays(issueDate, inventory.max_issue_days);

    const issue = withTransaction(() => {
      // Reserved copy -> issued copy
      inventoryService.issueReservedCopy(r.inventory_id);

      const info = db
        .prepare(
          `INSERT INTO library_issues
             (reservation_id, inventory_id, student_user_id, issued_by_librarian_id,
              issue_date, due_date, issue_status)
           VALUES (?, ?, ?, ?, ?, ?, 'issued')`
        )
        .run(r.id, r.inventory_id, studentUserId, req.user.id, issueDate, dueDate);

      db.prepare(`UPDATE library_reservations SET reservation_status = 'collected' WHERE id = ?`).run(r.id);

      return { id: info.lastInsertRowid, issue_date: issueDate, due_date: dueDate };
    });

    notificationService.createNotification({
      userId: studentUserId,
      title: `Library book issued: "${inventory.title}"`,
      message: `"${inventory.title}" has been issued to you. Due date: ${dueDate.slice(0, 10)}. Keep it safe.`,
      type: 'library_issued',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'library_issued',
      entityType: 'library_issue',
      entityId: issue.id,
      details: `${inventory.title} due ${dueDate}`,
    });

    return ok(res, {
      ...issue,
      reservation_id: r.id,
      inventory_id: r.inventory_id,
      title: inventory.title,
      available_copies: inventoryService.getInventoryById(r.inventory_id).available_copies,
      issued_copies: inventoryService.getInventoryById(r.inventory_id).issued_copies,
    }, 'Book issued successfully', 201);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PATCH /api/library/issues/:id/return
// ---------------------------------------------------------------
async function returnBook(req, res, next) {
  try {
    const db = getDb();
    const issue = db.prepare('SELECT * FROM library_issues WHERE id = ?').get(req.params.id);
    if (!issue) throw ApiError.notFound('Issue record not found');
    if (issue.issue_status === 'returned') throw ApiError.conflict('Book already returned');

    const inventory = inventoryService.getInventoryById(issue.inventory_id);
    const returnDate = now();

    withTransaction(() => {
      inventoryService.returnIssuedCopy(issue.inventory_id);
      db.prepare(
        `UPDATE library_issues SET return_date = ?, issue_status = 'returned' WHERE id = ?`
      ).run(returnDate, issue.id);
    });

    notificationService.createNotification({
      userId: issue.student_user_id,
      title: `Library book returned: "${inventory.title}"`,
      message: `Your return of "${inventory.title}" was recorded on ${returnDate.slice(0, 10)}. Thank you!`,
      type: 'library_returned',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'library_returned',
      entityType: 'library_issue',
      entityId: issue.id,
      details: inventory.title,
    });

    const updated = inventoryService.getInventoryById(issue.inventory_id);
    return ok(res, {
      issue_id: issue.id,
      return_date: returnDate,
      status: 'returned',
      inventory: {
        total_copies: updated.total_copies,
        available_copies: updated.available_copies,
        reserved_copies: updated.reserved_copies,
        issued_copies: updated.issued_copies,
      },
    }, 'Book returned successfully');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/library/issues - active issues / overdue (librarian)
// ---------------------------------------------------------------
async function listIssues(req, res, next) {
  try {
    const db = getDb();
    const { status, overdue, page = 1, limit = 30 } = req.query;
    const clauses = ['1 = 1'];
    const params = [];

    if (status) { clauses.push('i.issue_status = ?'); params.push(status); }
    if (overdue === 'true') {
      clauses.push("i.issue_status != 'returned' AND datetime(i.due_date) < datetime('now')");
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
    const offset = (pageNum - 1) * limitNum;
    const where = clauses.join(' AND ');

    const total = db.prepare(`SELECT COUNT(*) AS c FROM library_issues i WHERE ${where}`).get(...params).c;

    const rows = db
      .prepare(
        `SELECT i.*, b.title, b.author, i2.shelf_number, i2.rack_number,
                u.full_name AS student_name, s.hall_ticket_number,
                lu.full_name AS librarian_name
         FROM library_issues i
         JOIN library_inventory i2 ON i2.id = i.inventory_id
         JOIN books b ON b.id = i2.book_id
         JOIN users u ON u.id = i.student_user_id
         LEFT JOIN students s ON s.user_id = u.id
         LEFT JOIN users lu ON lu.id = i.issued_by_librarian_id
         WHERE ${where}
         ORDER BY i.due_date ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limitNum, offset);

    const today = now();
    return ok(res, {
      issues: rows.map((r) => ({
        id: r.id,
        reservation_id: r.reservation_id,
        student_user_id: r.student_user_id,
        student_name: r.student_name,
        hall_ticket_number: r.hall_ticket_number,
        librarian_name: r.librarian_name,
        issue_date: r.issue_date,
        due_date: r.due_date,
        return_date: r.return_date,
        status: r.issue_status,
        days_overdue: r.issue_status !== 'returned' && isPast(r.due_date) ? daysBetween(r.due_date, today) : 0,
        book: { title: r.title, author: r.author, shelf_number: r.shelf_number, rack_number: r.rack_number },
      })),
      pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) || 1 },
    }, 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/library/reports
// ---------------------------------------------------------------
async function reports(req, res, next) {
  try {
    const db = getDb();

    const totals = db
      .prepare(
        `SELECT COUNT(*) AS total_titles,
                COALESCE(SUM(total_copies), 0) AS total_copies,
                COALESCE(SUM(available_copies), 0) AS available_copies,
                COALESCE(SUM(reserved_copies), 0) AS reserved_copies,
                COALESCE(SUM(issued_copies), 0) AS issued_copies
         FROM library_inventory`
      )
      .get();

    const overdue = db
      .prepare(
        `SELECT COUNT(*) AS c FROM library_issues
         WHERE issue_status != 'returned' AND datetime(due_date) < datetime('now')`
      )
      .get().c;

    const mostReserved = db
      .prepare(
        `SELECT b.title, b.author, COUNT(r.id) AS reservation_count
         FROM library_reservations r
         JOIN library_inventory i ON i.id = r.inventory_id
         JOIN books b ON b.id = i.book_id
         GROUP BY i.id
         ORDER BY reservation_count DESC
         LIMIT 10`
      )
      .all();

    const departmentUsage = db
      .prepare(
        `SELECT COALESCE(d.department_code, 'GENERAL') AS department,
                COUNT(DISTINCT b.id) AS titles,
                COALESCE(SUM(i.total_copies), 0) AS copies,
                (SELECT COUNT(*) FROM library_issues li
                   JOIN library_inventory ii ON ii.id = li.inventory_id
                   JOIN books bb ON bb.id = ii.book_id
                   LEFT JOIN departments dd ON dd.id = bb.department_id
                   WHERE dd.id = b.department_id) AS times_issued
         FROM library_inventory i
         JOIN books b ON b.id = i.book_id
         LEFT JOIN departments d ON d.id = b.department_id
         GROUP BY d.id
         ORDER BY copies DESC`
      )
      .all();

    const activeIssues = db
      .prepare(`SELECT COUNT(*) AS c FROM library_issues WHERE issue_status IN ('issued','overdue')`)
      .get().c;

    const activeReservations = db
      .prepare(`SELECT COUNT(*) AS c FROM library_reservations WHERE reservation_status IN ('pending','confirmed')`)
      .get().c;

    return ok(res, {
      totals: { ...totals, overdue_books: overdue, active_issues: activeIssues, active_reservations: activeReservations },
      most_reserved_books: mostReserved,
      department_usage: departmentUsage,
      generated_at: now(),
    }, 'OK');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  addInventory,
  updateInventory,
  searchLibraryBooks,
  listInventory,
  createReservation,
  myReservations,
  listReservations,
  approveReservation,
  rejectReservation,
  cancelReservation,
  issueBook,
  returnBook,
  listIssues,
  reports,
};
