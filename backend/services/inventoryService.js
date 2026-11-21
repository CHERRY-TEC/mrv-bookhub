'use strict';

const { getDb, withTransaction } = require('../config/database');
const { ApiError } = require('../utils/response');
const { now } = require('../utils/dateUtils');

/**
 * Inventory service - the single place that mutates library_inventory.
 *
 * HARD INVARIANT (also enforced by a SQLite CHECK constraint):
 *   total_copies = available_copies + reserved_copies + issued_copies
 *
 * Every mutation runs inside a transaction so concurrent reservations
 * can never oversell the last available copy.
 */

function getInventoryById(id) {
  return getDb()
    .prepare(
      `SELECT i.*, b.title, b.author, b.isbn, b.course_code, b.image_path,
              d.department_code, d.department_name
       FROM library_inventory i
       JOIN books b ON b.id = i.book_id
       LEFT JOIN departments d ON d.id = b.department_id
       WHERE i.id = ?`
    )
    .get(id);
}

function assertInvariant(row) {
  const sum = row.available_copies + row.reserved_copies + row.issued_copies;
  if (sum !== row.total_copies) {
    throw ApiError.internal(
      `Inventory invariant violated for item ${row.id}: ${row.available_copies}+${row.reserved_copies}+${row.issued_copies} != ${row.total_copies}`
    );
  }
}

/**
 * Atomically move copies between inventory buckets.
 * @param {number} inventoryId
 * @param {{available?:number, reserved?:number, issued?:number}} deltas signed deltas
 * @returns {object} updated inventory row
 */
function adjustInventory(inventoryId, deltas = {}) {
  return withTransaction(() => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM library_inventory WHERE id = ?').get(inventoryId);
    if (!row) throw ApiError.notFound('Inventory record not found');

    const next = {
      available_copies: row.available_copies + (deltas.available || 0),
      reserved_copies: row.reserved_copies + (deltas.reserved || 0),
      issued_copies: row.issued_copies + (deltas.issued || 0),
      total_copies: row.total_copies + (deltas.total || 0),
    };

    if (Object.values(next).some((v) => v < 0)) {
      throw ApiError.conflict('This action would make copy counts negative');
    }
    assertInvariant(next);

    db.prepare(
      `UPDATE library_inventory
       SET available_copies = ?, reserved_copies = ?, issued_copies = ?, total_copies = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(next.available_copies, next.reserved_copies, next.issued_copies, next.total_copies, inventoryId);

    return getInventoryById(inventoryId);
  });
}

/**
 * Reserve one copy. Fails with 409 when no copy is free.
 * Runs in a transaction - safe against concurrent requests.
 */
function reserveCopy(inventoryId) {
  return withTransaction(() => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM library_inventory WHERE id = ?').get(inventoryId);
    if (!row) throw ApiError.notFound('Inventory record not found');
    if (row.available_copies < 1) {
      throw ApiError.conflict('Book is not available - all copies are reserved or issued');
    }

    const nextAvailable = row.available_copies - 1;
    const nextReserved = row.reserved_copies + 1;
    assertInvariant({ ...row, available_copies: nextAvailable, reserved_copies: nextReserved });

    const info = db
      .prepare(
        `UPDATE library_inventory
         SET available_copies = ?, reserved_copies = ?, updated_at = datetime('now')
         WHERE id = ? AND available_copies > 0`
      )
      .run(nextAvailable, nextReserved, inventoryId);

    if (info.changes === 0) {
      // Another transaction took the last copy between our read and write.
      throw ApiError.conflict('Book is not available - all copies are reserved or issued');
    }
    return getInventoryById(inventoryId);
  });
}

/** Release a reservation back to available (cancel/expire/reject). */
function releaseReservation(inventoryId) {
  return adjustInventory(inventoryId, { reserved: -1, available: +1 });
}

/** Move a reserved copy to issued (counter issue). */
function issueReservedCopy(inventoryId) {
  return adjustInventory(inventoryId, { reserved: -1, issued: +1 });
}

/** Return an issued copy back to the shelf. */
function returnIssuedCopy(inventoryId) {
  return adjustInventory(inventoryId, { issued: -1, available: +1 });
}

/**
 * Create an inventory record for a book with initial counts.
 * available = total, reserved = 0, issued = 0.
 */
function createInventory({ bookId, totalCopies, shelfNumber, rackNumber, maxIssueDays }) {
  return withTransaction(() => {
    const db = getDb();
    const total = Number(totalCopies) || 0;
    if (total < 0) throw ApiError.validationError('Total copies cannot be negative');

    const info = db
      .prepare(
        `INSERT INTO library_inventory
           (book_id, total_copies, available_copies, reserved_copies, issued_copies,
            shelf_number, rack_number, max_issue_days)
         VALUES (?, ?, ?, 0, 0, ?, ?, ?)`
      )
      .run(bookId, total, total, shelfNumber || null, rackNumber || null, maxIssueDays || 14);

    return getInventoryById(info.lastInsertRowid);
  });
}

/**
 * Update stock/location. Prevents reducing total below reserved+issued.
 */
function updateInventory(id, patch) {
  return withTransaction(() => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM library_inventory WHERE id = ?').get(id);
    if (!row) throw ApiError.notFound('Inventory record not found');

    const newTotal = patch.total_copies !== undefined ? Number(patch.total_copies) : row.total_copies;
    const minimum = row.reserved_copies + row.issued_copies;
    if (newTotal < minimum) {
      throw ApiError.conflict(
        `Total copies cannot be below reserved + issued (${minimum} copies are currently committed)`
      );
    }

    // Copies removed come out of the available bucket.
    const newAvailable = row.available_copies + (newTotal - row.total_copies);
    if (newAvailable < 0) throw ApiError.conflict('Not enough available copies to reduce total');

    assertInvariant({
      available_copies: newAvailable,
      reserved_copies: row.reserved_copies,
      issued_copies: row.issued_copies,
      total_copies: newTotal,
    });

    db.prepare(
      `UPDATE library_inventory
       SET total_copies = ?, available_copies = ?, shelf_number = ?, rack_number = ?,
           max_issue_days = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      newTotal,
      newAvailable,
      patch.shelf_number !== undefined ? patch.shelf_number : row.shelf_number,
      patch.rack_number !== undefined ? patch.rack_number : row.rack_number,
      patch.max_issue_days !== undefined ? Number(patch.max_issue_days) : row.max_issue_days,
      id
    );

    return getInventoryById(id);
  });
}

module.exports = {
  getInventoryById,
  adjustInventory,
  reserveCopy,
  releaseReservation,
  issueReservedCopy,
  returnIssuedCopy,
  createInventory,
  updateInventory,
};
