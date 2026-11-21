'use strict';

const { getDb, withTransaction } = require('../config/database');
const { ApiError, ok } = require('../utils/response');
const { sanitizeSearchTerm } = require('../middleware/validationMiddleware');
const { upload, removeImageFile, imageUrl } = require('../utils/upload');
const { assertOwnerOrAdmin } = require('../middleware/roleMiddleware');
const auditService = require('../services/auditService');

/** Roles allowed to upload listings. */
const UPLOADER_ROLES = ['student', 'faculty', 'vendor', 'admin'];

/** Roles that must be approved before listing (vendors). */
async function assertCanList(req) {
  const db = getDb();
  if (req.user.role === 'vendor') {
    const v = db.prepare('SELECT approval_status FROM vendors WHERE user_id = ?').get(req.user.id);
    if (!v || v.approval_status !== 'approved') {
      throw ApiError.forbidden('Only approved vendors can publish listings');
    }
  }
}

function ownerTypeFor(role) {
  // admin acts as an owner_type 'admin'
  return role;
}

/** Join listing + book + owner into one API object. */
function decorateListing(row) {
  if (!row) return null;
  return {
    id: row.id,
    book_id: row.book_id,
    title: row.title,
    author: row.author,
    edition: row.edition,
    isbn: row.isbn,
    course_code: row.course_code,
    category: row.category,
    description: row.description,
    image_url: imageUrl(row.image_path),
    department_id: row.department_id,
    department_code: row.department_code,
    department_name: row.department_name,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    owner_type: row.owner_type,
    listing_type: row.listing_type,
    book_condition: row.book_condition,
    max_borrow_days: row.max_borrow_days,
    price: row.price,
    stock_quantity: row.stock_quantity,
    available: Boolean(row.available),
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const LISTING_SELECT = `
  SELECT l.*, b.title, b.author, b.edition, b.isbn, b.course_code, b.category,
         b.description, b.image_path, b.department_id,
         d.department_code, d.department_name,
         u.full_name AS owner_name
  FROM book_listings l
  JOIN books b ON b.id = l.book_id
  LEFT JOIN departments d ON d.id = b.department_id
  JOIN users u ON u.id = l.owner_user_id
`;

// ---------------------------------------------------------------
// POST /api/books - upload a book listing
// ---------------------------------------------------------------
async function createBook(req, res, next) {
  try {
    await assertCanList(req);

    const {
      title, author, edition, isbn, course_code, department_id,
      category, description, book_condition, listing_type,
      max_borrow_days, price, stock_quantity,
    } = req.body;

    if (!['borrow', 'sell', 'both'].includes(listing_type)) {
      throw ApiError.validationError('listing_type must be borrow, sell or both');
    }
    if (['student', 'faculty'].includes(req.user.role) && listing_type !== 'sell') {
      if (!max_borrow_days || Number(max_borrow_days) < 1) {
        throw ApiError.validationError('max_borrow_days is required for borrowable listings');
      }
      if (Number(max_borrow_days) > 90) {
        throw ApiError.validationError('max_borrow_days cannot exceed 90');
      }
    }
    if ((listing_type === 'sell' || listing_type === 'both')) {
      if (price === undefined || price === '' || Number(price) < 0) {
        throw ApiError.validationError('price is required for sale listings');
      }
      if (req.user.role === 'vendor' && (stock_quantity === undefined || Number(stock_quantity) < 1)) {
        throw ApiError.validationError('stock_quantity is required for vendors');
      }
    }

    const db = getDb();
    let departmentId = null;
    if (department_id) {
      const d = db.prepare('SELECT id FROM departments WHERE id = ?').get(department_id);
      if (!d) throw ApiError.validationError('Unknown department_id');
      departmentId = department_id;
    }

    const imagePath = req.file ? req.file.filename : null;

    const result = withTransaction(() => {
      // Reuse an existing catalogue entry when the ISBN matches
      let bookId;
      if (isbn) {
        const existing = db.prepare('SELECT id FROM books WHERE isbn = ?').get(isbn);
        if (existing) bookId = existing.id;
      }
      if (!bookId) {
        const info = db
          .prepare(
            `INSERT INTO books (title, author, edition, isbn, course_code, department_id,
                                category, description, image_path, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            title.trim(), author.trim(), edition || null, isbn || null,
            course_code || null, departmentId, category || null,
            description || null, imagePath, req.user.id
          );
        bookId = info.lastInsertRowid;
      } else if (imagePath) {
        db.prepare('UPDATE books SET image_path = COALESCE(image_path, ?), updated_at = datetime(\'now\') WHERE id = ?')
          .run(imagePath, bookId);
      }

      const listingInfo = db
        .prepare(
          `INSERT INTO book_listings
             (book_id, owner_user_id, owner_type, listing_type, book_condition,
              max_borrow_days, price, stock_quantity, available)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          bookId,
          req.user.id,
          ownerTypeFor(req.user.role),
          listing_type,
          book_condition || 'good',
          listing_type === 'sell' ? null : (max_borrow_days || null),
          price !== undefined && price !== '' ? Number(price) : null,
          stock_quantity !== undefined && stock_quantity !== '' ? Number(stock_quantity) : 0
        );

      return { bookId, listingId: listingInfo.lastInsertRowid };
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'listing_created',
      entityType: 'book_listing',
      entityId: result.listingId,
      details: title,
    });

    const created = db
      .prepare(`${LISTING_SELECT} WHERE l.id = ?`)
      .get(result.listingId);

    return ok(res, decorateListing(created), 'Book uploaded successfully', 201);
  } catch (err) {
    // Clean up the uploaded file if the operation failed
    if (req.file) removeImageFile(req.file.filename);
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/books - available listings (public, optional filters)
// ---------------------------------------------------------------
async function listBooks(req, res, next) {
  try {
    const db = getDb();
    const {
      listing_type, department_id, category, condition,
      availability, sort = 'newest', page = 1, limit = 20,
    } = req.query;

    const clauses = ['l.is_active = 1'];
    const params = [];

    if (listing_type) {
      clauses.push('(l.listing_type = ?)');
      params.push(listing_type);
    }
    if (department_id) { clauses.push('b.department_id = ?'); params.push(Number(department_id)); }
    if (category) { clauses.push('b.category = ?'); params.push(category); }
    if (condition) { clauses.push('l.book_condition = ?'); params.push(condition); }
    if (availability === 'available') clauses.push('l.available = 1');

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const orderMap = {
      newest: 'l.created_at DESC',
      oldest: 'l.created_at ASC',
      title_asc: 'b.title COLLATE NOCASE ASC',
      title_desc: 'b.title COLLATE NOCASE DESC',
      price_asc: 'l.price ASC',
      price_desc: 'l.price DESC',
    };
    const orderBy = orderMap[sort] || orderMap.newest;

    const where = clauses.filter(Boolean).join(' AND ');
    const total = db
      .prepare(`SELECT COUNT(*) AS c FROM book_listings l JOIN books b ON b.id = l.book_id WHERE ${where}`)
      .get(...params).c;

    const rows = db
      .prepare(`${LISTING_SELECT} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, limitNum, offset);

    return ok(res, {
      books: rows.map(decorateListing),
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
// GET /api/books/search - full-text-ish search
// ---------------------------------------------------------------
async function searchBooks(req, res, next) {
  try {
    const db = getDb();
    const {
      title, author, course_code, department, category,
      condition, availability, listing_type, isbn,
      sort = 'relevance', page = 1, limit = 20,
    } = req.query;

    const clauses = ['l.is_active = 1'];
    const params = [];

    const like = (col, val) => {
      clauses.push(`${col} LIKE ? ESCAPE '\\'`);
      params.push(`%${sanitizeSearchTerm(val)}%`);
    };

    if (title) like('b.title', title);
    if (author) like('b.author', author);
    if (isbn) { clauses.push("b.isbn LIKE ? ESCAPE '\\'"); params.push(`%${sanitizeSearchTerm(isbn)}%`); }
    if (course_code) like('b.course_code', course_code);
    if (category) { clauses.push('b.category = ?'); params.push(category); }
    if (department) {
      // accepts department id or code or name
      if (/^\d+$/.test(department)) {
        clauses.push('b.department_id = ?');
        params.push(Number(department));
      } else {
        clauses.push('(d.department_code = ? OR d.department_name = ?)');
        params.push(department.toUpperCase(), department);
      }
    }
    if (condition) { clauses.push('l.book_condition = ?'); params.push(condition); }
    if (availability === 'available') clauses.push('l.available = 1');
    if (availability === 'unavailable') clauses.push('l.available = 0');
    if (listing_type) { clauses.push('l.listing_type = ?'); params.push(listing_type); }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const orderMap = {
      relevance: 'l.available DESC, l.created_at DESC',
      newest: 'l.created_at DESC',
      title_asc: 'b.title COLLATE NOCASE ASC',
      title_desc: 'b.title COLLATE NOCASE DESC',
      price_asc: 'l.price ASC',
      price_desc: 'l.price DESC',
    };
    const orderBy = orderMap[sort] || orderMap.relevance;

    const where = clauses.join(' AND ');
    const countSql = `
      SELECT COUNT(*) AS c
      FROM book_listings l
      JOIN books b ON b.id = l.book_id
      LEFT JOIN departments d ON d.id = b.department_id
      WHERE ${where}`;
    const total = db.prepare(countSql).get(...params).c;

    const rows = db
      .prepare(`${LISTING_SELECT} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, limitNum, offset);

    return ok(res, {
      books: rows.map(decorateListing),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum) || 1,
      },
      applied_filters: {
        title, author, course_code, department, category, condition, availability, listing_type, isbn,
      },
    }, 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/books/:id - book listing detail
// ---------------------------------------------------------------
async function getBook(req, res, next) {
  try {
    const db = getDb();
    const row = db.prepare(`${LISTING_SELECT} WHERE l.id = ?`).get(req.params.id);
    if (!row || !row.is_active) throw ApiError.notFound('Book not found');

    // Attach active borrow requests for the owner's convenience
    const listing = decorateListing(row);
    if (req.user && (req.user.id === row.owner_user_id || req.user.role === 'admin')) {
      listing.pending_requests = db
        .prepare(
          `SELECT id, borrower_user_id, requested_days, request_message, status, requested_at
           FROM borrow_requests WHERE listing_id = ? AND status = 'pending'`
        )
        .all(row.id);
    }
    return ok(res, listing, 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PUT /api/books/:id - update own listing
// ---------------------------------------------------------------
async function updateBook(req, res, next) {
  try {
    const db = getDb();
    const listing = db.prepare('SELECT * FROM book_listings WHERE id = ?').get(req.params.id);
    if (!listing || !listing.is_active) throw ApiError.notFound('Book not found');

    assertOwnerOrAdmin(listing, req.user);

    const {
      title, author, edition, isbn, course_code, department_id,
      category, description, book_condition, listing_type,
      max_borrow_days, price, stock_quantity, available,
    } = req.body;

    if (listing_type && !['borrow', 'sell', 'both'].includes(listing_type)) {
      throw ApiError.validationError('listing_type must be borrow, sell or both');
    }
    if (book_condition && !['new', 'like_new', 'good', 'fair', 'worn'].includes(book_condition)) {
      throw ApiError.validationError('Invalid book_condition');
    }
    if (max_borrow_days !== undefined && max_borrow_days !== '' && Number(max_borrow_days) < 1) {
      throw ApiError.validationError('max_borrow_days must be positive');
    }
    if (price !== undefined && price !== '' && Number(price) < 0) {
      throw ApiError.validationError('price cannot be negative');
    }
    if (stock_quantity !== undefined && Number(stock_quantity) < 0) {
      throw ApiError.validationError('stock_quantity cannot be negative');
    }

    const imagePath = req.file ? req.file.filename : null;

    const updated = withTransaction(() => {
      // Update catalogue book fields when provided
      const bookFields = [];
      const bookParams = [];
      const setIf = (field, value, target) => {
        if (value !== undefined && value !== '') {
          target.push(`${field} = ?`);
          bookParams.push(value);
        }
      };
      setIf('title', title, bookFields);
      setIf('author', author, bookFields);
      setIf('edition', edition, bookFields);
      setIf('isbn', isbn, bookFields);
      setIf('course_code', course_code, bookFields);
      setIf('category', category, bookFields);
      setIf('description', description, bookFields);
      if (department_id) {
        const d = db.prepare('SELECT id FROM departments WHERE id = ?').get(department_id);
        if (!d) throw ApiError.validationError('Unknown department_id');
        bookFields.push('department_id = ?');
        bookParams.push(department_id);
      }
      if (imagePath) {
        bookFields.push('image_path = ?');
        bookParams.push(imagePath);
      }
      if (bookFields.length) {
        bookFields.push("updated_at = datetime('now')");
        db.prepare(`UPDATE books SET ${bookFields.join(', ')} WHERE id = ?`)
          .run(...bookParams, listing.book_id);
      }

      // Update listing fields
      const listFields = [];
      const listParams = [];
      const setList = (field, value) => {
        if (value !== undefined) {
          listFields.push(`${field} = ?`);
          listParams.push(value);
        }
      };
      setList('listing_type', listing_type);
      setList('book_condition', book_condition);
      setList('max_borrow_days', max_borrow_days !== undefined && max_borrow_days !== '' ? Number(max_borrow_days) : undefined);
      setList('price', price !== undefined && price !== '' ? Number(price) : undefined);
      setList('stock_quantity', stock_quantity !== undefined && stock_quantity !== '' ? Number(stock_quantity) : undefined);
      if (available !== undefined) setList('available', available ? 1 : 0);

      if (listFields.length) {
        listFields.push("updated_at = datetime('now')");
        db.prepare(`UPDATE book_listings SET ${listFields.join(', ')} WHERE id = ?`)
          .run(...listParams, listing.id);
      }
      return true;
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'listing_updated',
      entityType: 'book_listing',
      entityId: listing.id,
      details: title || 'fields updated',
    });

    const row = db.prepare(`${LISTING_SELECT} WHERE l.id = ?`).get(listing.id);
    return ok(res, decorateListing(row), 'Book updated successfully');
  } catch (err) {
    if (req.file) removeImageFile(req.file.filename);
    next(err);
  }
}

// ---------------------------------------------------------------
// DELETE /api/books/:id - deactivate listing
// ---------------------------------------------------------------
async function deleteBook(req, res, next) {
  try {
    const db = getDb();
    const listing = db.prepare('SELECT * FROM book_listings WHERE id = ?').get(req.params.id);
    if (!listing) throw ApiError.notFound('Book not found');

    assertOwnerOrAdmin(listing, req.user);

    // Block removal while an active transaction exists
    const active = db
      .prepare(
        `SELECT t.id FROM borrow_transactions t
         JOIN borrow_requests r ON r.id = t.borrow_request_id
         WHERE r.listing_id = ? AND t.transaction_status = 'active'`
      )
      .get(listing.id);
    if (active) {
      throw ApiError.conflict('Cannot remove this book while an active borrowing transaction exists');
    }

    // Cancel pending requests too
    withTransaction(() => {
      db.prepare(
        `UPDATE borrow_requests SET status = 'cancelled'
         WHERE listing_id = ? AND status = 'pending'`
      ).run(listing.id);
      db.prepare(
        `UPDATE book_listings SET is_active = 0, available = 0, updated_at = datetime('now')
         WHERE id = ?`
      ).run(listing.id);
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'listing_removed',
      entityType: 'book_listing',
      entityId: listing.id,
      details: listing.book_id,
    });

    return ok(res, { id: listing.id, is_active: false }, 'Book listing removed');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  upload,
  createBook,
  listBooks,
  searchBooks,
  getBook,
  updateBook,
  deleteBook,
  decorateListing,
};
