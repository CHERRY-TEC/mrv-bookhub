'use strict';

const { getDb, withTransaction } = require('../config/database');
const { ApiError, ok } = require('../utils/response');
const { upload, removeImageFile, imageUrl } = require('../utils/upload');
const notificationService = require('../services/notificationService');
const auditService = require('../services/auditService');

/**
 * Vendor marketplace - approved vendors sell books.
 * Checkout is SIMULATED: no payment data is ever collected.
 */

async function assertApprovedVendor(req) {
  const db = getDb();
  const vendor = db.prepare('SELECT * FROM vendors WHERE user_id = ?').get(req.user.id);
  if (!vendor) throw ApiError.forbidden('No vendor profile found');
  if (vendor.approval_status !== 'approved') {
    throw ApiError.forbidden('Only approved vendors can perform this action');
  }
  return vendor;
}

// ---------------------------------------------------------------
// POST /api/vendor/listings
// ---------------------------------------------------------------
async function createListing(req, res, next) {
  try {
    await assertApprovedVendor(req);
    const {
      title, author, edition, isbn, course_code, department_id,
      category, description, price, stock_quantity,
    } = req.body;

    if (price === undefined || price === '' || Number(price) < 0) {
      throw ApiError.validationError('price is required and cannot be negative');
    }
    if (stock_quantity === undefined || stock_quantity === '' || Number(stock_quantity) < 1) {
      throw ApiError.validationError('stock_quantity must be at least 1');
    }

    const db = getDb();
    const imagePath = req.file ? req.file.filename : null;

    const result = withTransaction(() => {
      let bookId = null;
      if (isbn) {
        const existing = db.prepare('SELECT id FROM books WHERE isbn = ?').get(isbn);
        if (existing) bookId = existing.id;
      }
      if (!bookId) {
        const info = db
          .prepare(
            `INSERT INTO books (title, author, edition, isbn, course_code, department_id, category, description, image_path, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            title.trim(), author.trim(), edition || null, isbn || null,
            course_code || null, department_id || null, category || null,
            description || null, imagePath, req.user.id
          );
        bookId = info.lastInsertRowid;
      } else if (imagePath) {
        db.prepare('UPDATE books SET image_path = COALESCE(image_path, ?) WHERE id = ?').run(imagePath, bookId);
      }

      const info = db
        .prepare(
          `INSERT INTO book_listings
             (book_id, owner_user_id, owner_type, listing_type, book_condition,
              price, stock_quantity, available)
           VALUES (?, ?, 'vendor', 'sell', ?, ?, ?, 1)`
        )
        .run(bookId, req.user.id, req.body.book_condition || 'new', Number(price), Number(stock_quantity));

      return { bookId, listingId: info.lastInsertRowid };
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'vendor_listing_created',
      entityType: 'book_listing',
      entityId: result.listingId,
      details: title,
    });

    const row = db.prepare('SELECT * FROM book_listings WHERE id = ?').get(result.listingId);
    return ok(res, {
      id: row.id,
      book_id: row.book_id,
      price: row.price,
      stock_quantity: row.stock_quantity,
      listing_type: row.listing_type,
    }, 'Sale listing created', 201);
  } catch (err) {
    if (req.file) removeImageFile(req.file.filename);
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/vendor/listings - vendor's own listings
// ---------------------------------------------------------------
async function myListings(req, res, next) {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT l.*, b.title, b.author, b.isbn, b.course_code, b.image_path, b.category
         FROM book_listings l
         JOIN books b ON b.id = l.book_id
         WHERE l.owner_user_id = ? AND l.is_active = 1
         ORDER BY l.created_at DESC`
      )
      .all(req.user.id);

    return ok(res, rows.map((r) => ({
      id: r.id,
      book_id: r.book_id,
      title: r.title,
      author: r.author,
      isbn: r.isbn,
      course_code: r.course_code,
      category: r.category,
      image_url: imageUrl(r.image_path),
      price: r.price,
      stock_quantity: r.stock_quantity,
      available: Boolean(r.available),
      created_at: r.created_at,
    })), 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PATCH /api/vendor/listings/:id - update price/stock
// ---------------------------------------------------------------
async function updateListing(req, res, next) {
  try {
    await assertApprovedVendor(req);
    const db = getDb();
    const listing = db.prepare('SELECT * FROM book_listings WHERE id = ?').get(req.params.id);
    if (!listing) throw ApiError.notFound('Listing not found');
    if (listing.owner_user_id !== req.user.id) {
      throw ApiError.forbidden('You can only update your own listings');
    }

    const { price, stock_quantity, available } = req.body;
    const fields = [];
    const params = [];

    if (price !== undefined) {
      if (Number(price) < 0) throw ApiError.validationError('price cannot be negative');
      fields.push('price = ?');
      params.push(Number(price));
    }
    if (stock_quantity !== undefined) {
      if (Number(stock_quantity) < 0) throw ApiError.validationError('stock_quantity cannot be negative');
      fields.push('stock_quantity = ?');
      params.push(Number(stock_quantity));
      // auto-manage availability
      fields.push('available = ?');
      params.push(Number(stock_quantity) > 0 ? 1 : 0);
    }
    if (available !== undefined) {
      fields.push('available = ?');
      params.push(available ? 1 : 0);
    }

    if (!fields.length) throw ApiError.badRequest('Nothing to update');

    fields.push("updated_at = datetime('now')");
    db.prepare(`UPDATE book_listings SET ${fields.join(', ')} WHERE id = ?`).run(...params, listing.id);

    const updated = db.prepare('SELECT * FROM book_listings WHERE id = ?').get(listing.id);
    return ok(res, {
      id: updated.id,
      price: updated.price,
      stock_quantity: updated.stock_quantity,
      available: Boolean(updated.available),
    }, 'Listing updated');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/vendor/marketplace - public sale listings (students browse)
// ---------------------------------------------------------------
async function marketplace(req, res, next) {
  try {
    const db = getDb();
    const { title, author, course_code, department, page = 1, limit = 20, sort = 'newest' } = req.query;

    const clauses = ['l.is_active = 1', "l.listing_type IN ('sell','both')", 'u.account_status = \'active\''];
    const params = [];

    if (title) { clauses.push("b.title LIKE ? ESCAPE '\\'"); params.push(`%${title.replace(/[\\%_]/g, (m) => `\\${m}`)}%`); }
    if (author) { clauses.push("b.author LIKE ? ESCAPE '\\'"); params.push(`%${author.replace(/[\\%_]/g, (m) => `\\${m}`)}%`); }
    if (course_code) { clauses.push("b.course_code LIKE ? ESCAPE '\\'"); params.push(`%${course_code}%`); }
    if (department) {
      if (/^\d+$/.test(department)) { clauses.push('b.department_id = ?'); params.push(Number(department)); }
      else { clauses.push('(d.department_code = ? OR d.department_name = ?)'); params.push(department.toUpperCase(), department); }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;
    const where = clauses.join(' AND ');

    const orderMap = {
      newest: 'l.created_at DESC',
      price_asc: 'l.price ASC',
      price_desc: 'l.price DESC',
      title_asc: 'b.title COLLATE NOCASE ASC',
    };
    const orderBy = orderMap[sort] || orderMap.newest;

    const total = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM book_listings l
         JOIN books b ON b.id = l.book_id
         JOIN users u ON u.id = l.owner_user_id
         LEFT JOIN departments d ON d.id = b.department_id
         WHERE ${where}`
      )
      .get(...params).c;

    const rows = db
      .prepare(
        `SELECT l.id, l.book_id, l.price, l.stock_quantity, l.available, l.book_condition,
                l.created_at, b.title, b.author, b.isbn, b.course_code, b.category,
                b.description, b.image_path, d.department_code,
                v.business_name, v.vendor_name
         FROM book_listings l
         JOIN books b ON b.id = l.book_id
         JOIN users u ON u.id = l.owner_user_id
         LEFT JOIN departments d ON d.id = b.department_id
         LEFT JOIN vendors v ON v.user_id = l.owner_user_id
         WHERE ${where}
         ORDER BY ${orderBy}
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
        course_code: r.course_code,
        category: r.category,
        description: r.description,
        image_url: imageUrl(r.image_path),
        department_code: r.department_code,
        price: r.price,
        stock_quantity: r.stock_quantity,
        in_stock: r.stock_quantity > 0 && r.available,
        book_condition: r.book_condition,
        seller: r.business_name || r.vendor_name || 'Approved Vendor',
        created_at: r.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) || 1 },
      note: 'Checkout is simulated - no payment information is collected.',
    }, 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// POST /api/vendor/orders - student places an order (simulated)
// ---------------------------------------------------------------
async function placeOrder(req, res, next) {
  try {
    const { listing_id, quantity } = req.body;
    const qty = Number(quantity);
    if (!qty || qty < 1) throw ApiError.validationError('quantity must be at least 1');

    const db = getDb();
    const listing = db
      .prepare(
        `SELECT l.*, b.title FROM book_listings l
         JOIN books b ON b.id = l.book_id WHERE l.id = ?`
      )
      .get(listing_id);

    if (!listing || !listing.is_active) throw ApiError.notFound('Listing not found');
    if (!['sell', 'both'].includes(listing.listing_type)) {
      throw ApiError.badRequest('This listing is not for sale');
    }
    if (listing.stock_quantity < qty) {
      throw ApiError.conflict(`Only ${listing.stock_quantity} copy/copies left in stock`);
    }
    if (listing.owner_user_id === req.user.id) {
      throw ApiError.badRequest('You cannot order your own listing');
    }

    // Backend-calculated total - never trust the client
    const unitPrice = Number(listing.price);
    const totalAmount = Number((unitPrice * qty).toFixed(2));

    const order = withTransaction(() => {
      // Lock-ish check: re-verify stock inside the transaction
      const fresh = db.prepare('SELECT stock_quantity FROM book_listings WHERE id = ?').get(listing_id);
      if (fresh.stock_quantity < qty) {
        throw ApiError.conflict('Not enough stock remaining');
      }

      const info = db
        .prepare(
          `INSERT INTO orders (student_user_id, vendor_user_id, listing_id, quantity, unit_price, total_amount)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(req.user.id, listing.owner_user_id, listing_id, qty, unitPrice, totalAmount);

      const newStock = fresh.stock_quantity - qty;
      db.prepare(
        `UPDATE book_listings
         SET stock_quantity = ?, available = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(newStock, newStock > 0 ? 1 : 0, listing_id);

      return { id: info.lastInsertRowid };
    });

    notificationService.createNotification({
      userId: listing.owner_user_id,
      title: `New order: "${listing.title}" x${qty}`,
      message: `${req.user.full_name} ordered ${qty} copy/copies of "${listing.title}" (₹${totalAmount.toFixed(2)}). Simulated checkout - confirm to process.`,
      type: 'order_update',
    });
    notificationService.createNotification({
      userId: req.user.id,
      title: `Order placed: "${listing.title}"`,
      message: `Your simulated order for ${qty} x "${listing.title}" (₹${totalAmount.toFixed(2)}) was placed. No payment was collected.`,
      type: 'order_update',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'order_placed',
      entityType: 'order',
      entityId: order.id,
      details: `${listing.title} x${qty} = ${totalAmount}`,
    });

    const created = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    return ok(res, {
      ...created,
      title: listing.title,
      payment: 'simulated_no_payment_collected',
    }, 'Order placed successfully (simulated checkout)', 201);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/vendor/orders - vendor's orders
// ---------------------------------------------------------------
async function vendorOrders(req, res, next) {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT o.*, b.title, b.author, u.full_name AS student_name, u.email AS student_email
         FROM orders o
         JOIN book_listings l ON l.id = o.listing_id
         JOIN books b ON b.id = l.book_id
         JOIN users u ON u.id = o.student_user_id
         WHERE o.vendor_user_id = ?
         ORDER BY o.created_at DESC`
      )
      .all(req.user.id);
    return ok(res, rows, 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// GET /api/orders/my - student's own orders
// ---------------------------------------------------------------
async function myOrders(req, res, next) {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT o.*, b.title, b.author, v.business_name, v.vendor_name
         FROM orders o
         JOIN book_listings l ON l.id = o.listing_id
         JOIN books b ON b.id = l.book_id
         LEFT JOIN vendors v ON v.user_id = o.vendor_user_id
         WHERE o.student_user_id = ?
         ORDER BY o.created_at DESC`
      )
      .all(req.user.id);
    return ok(res, rows, 'OK');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// PATCH /api/vendor/orders/:id/status
// ---------------------------------------------------------------
async function updateOrderStatus(req, res, next) {
  try {
    const { order_status } = req.body;
    const allowed = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!allowed.includes(order_status)) {
      throw ApiError.validationError(`order_status must be one of: ${allowed.join(', ')}`);
    }

    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) throw ApiError.notFound('Order not found');
    if (order.vendor_user_id !== req.user.id && req.user.role !== 'admin') {
      throw ApiError.forbidden('Only the vendor or admin can update this order');
    }

    // Cancelling restores stock
    const wasCancelled = order.order_status === 'cancelled';
    const willCancel = order_status === 'cancelled';

    withTransaction(() => {
      db.prepare('UPDATE orders SET order_status = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(order_status, order.id);

      if (willCancel && !wasCancelled) {
        db.prepare(
          `UPDATE book_listings
           SET stock_quantity = stock_quantity + ?, available = 1, updated_at = datetime('now')
           WHERE id = ?`
        ).run(order.quantity, order.listing_id);
      }
    });

    notificationService.createNotification({
      userId: order.student_user_id,
      title: `Order ${order_status}: #${order.id}`,
      message: `Your order #${order.id} is now "${order_status}".`,
      type: 'order_update',
    });

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'order_status_changed',
      entityType: 'order',
      entityId: order.id,
      details: `${order.order_status} -> ${order_status}`,
    });

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    return ok(res, updated, 'Order status updated');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  upload,
  createListing,
  myListings,
  updateListing,
  marketplace,
  placeOrder,
  vendorOrders,
  myOrders,
  updateOrderStatus,
};
