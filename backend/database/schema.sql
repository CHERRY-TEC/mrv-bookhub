-- ============================================================
-- MRV BookHub - SQLite Schema
-- Applied by config/database.js on server start.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- Departments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    department_name TEXT NOT NULL UNIQUE,
    department_code TEXT NOT NULL UNIQUE,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Users (common account data for every role)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name       TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    mobile_number   TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('student','faculty','librarian','vendor','admin')),
    account_status  TEXT NOT NULL DEFAULT 'pending'
                    CHECK (account_status IN ('pending','active','suspended','rejected')),
    email_verified  INTEGER NOT NULL DEFAULT 0,
    mobile_verified INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(account_status);

-- ------------------------------------------------------------
-- Students (login via hall ticket number)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL UNIQUE,
    hall_ticket_number  TEXT NOT NULL UNIQUE,
    department_id       INTEGER,
    academic_year       TEXT,
    semester            INTEGER,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id)       REFERENCES users(id)        ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id)  ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_students_hall_ticket ON students(hall_ticket_number);
CREATE INDEX IF NOT EXISTS idx_students_department  ON students(department_id);

-- ------------------------------------------------------------
-- Faculty (login via faculty id)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS faculty (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL UNIQUE,
    faculty_id     TEXT NOT NULL UNIQUE,
    department_id  INTEGER,
    designation    TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_faculty_id ON faculty(faculty_id);

-- ------------------------------------------------------------
-- Vendors
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL UNIQUE,
    vendor_name       TEXT NOT NULL,
    business_name     TEXT,
    contact_number    TEXT,
    business_address  TEXT,
    approval_status   TEXT NOT NULL DEFAULT 'pending'
                      CHECK (approval_status IN ('pending','approved','rejected')),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vendors_approval ON vendors(approval_status);

-- ------------------------------------------------------------
-- Library staff (login via library staff id)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS librarians (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL UNIQUE,
    staff_id     TEXT NOT NULL UNIQUE,
    designation  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_librarians_staff_id ON librarians(staff_id);

-- ------------------------------------------------------------
-- Books (shared catalogue - one row per distinct work)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS books (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    author         TEXT NOT NULL,
    edition        TEXT,
    isbn           TEXT,
    course_code    TEXT,
    department_id  INTEGER,
    category       TEXT,
    description    TEXT,
    image_path     TEXT,
    created_by     INTEGER,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by)    REFERENCES users(id)       ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_books_title        ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_author       ON books(author);
CREATE INDEX IF NOT EXISTS idx_books_isbn         ON books(isbn);
CREATE INDEX IF NOT EXISTS idx_books_course_code  ON books(course_code);
CREATE INDEX IF NOT EXISTS idx_books_department   ON books(department_id);
CREATE INDEX IF NOT EXISTS idx_books_category     ON books(category);

-- ------------------------------------------------------------
-- BookListings - who offers a book and how
-- (library inventory is NOT a listing)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS book_listings (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id          INTEGER NOT NULL,
    owner_user_id    INTEGER NOT NULL,
    owner_type       TEXT NOT NULL CHECK (owner_type IN ('student','faculty','vendor','admin')),
    listing_type     TEXT NOT NULL CHECK (listing_type IN ('borrow','sell','both')),
    book_condition   TEXT NOT NULL DEFAULT 'good'
                     CHECK (book_condition IN ('new','like_new','good','fair','worn')),
    max_borrow_days  INTEGER,
    price            REAL,
    stock_quantity   INTEGER NOT NULL DEFAULT 0,
    available        INTEGER NOT NULL DEFAULT 1,
    is_active        INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (book_id)       REFERENCES books(id)  ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id) REFERENCES users(id)  ON DELETE CASCADE,
    CHECK (max_borrow_days IS NULL OR max_borrow_days > 0),
    CHECK (price IS NULL OR price >= 0),
    CHECK (stock_quantity >= 0)
);
CREATE INDEX IF NOT EXISTS idx_listings_book        ON book_listings(book_id);
CREATE INDEX IF NOT EXISTS idx_listings_owner       ON book_listings(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_listings_type        ON book_listings(listing_type);
CREATE INDEX IF NOT EXISTS idx_listings_available   ON book_listings(available);

-- ------------------------------------------------------------
-- BorrowRequests (peer to peer)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS borrow_requests (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id        INTEGER NOT NULL,
    borrower_user_id  INTEGER NOT NULL,
    requested_days    INTEGER NOT NULL CHECK (requested_days > 0),
    request_message   TEXT,
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','cancelled','returned')),
    requested_at      TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at       TEXT,
    rejected_at       TEXT,
    FOREIGN KEY (listing_id)       REFERENCES book_listings(id) ON DELETE CASCADE,
    FOREIGN KEY (borrower_user_id) REFERENCES users(id)         ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_borrow_requests_listing   ON borrow_requests(listing_id);
CREATE INDEX IF NOT EXISTS idx_borrow_requests_borrower  ON borrow_requests(borrower_user_id);
CREATE INDEX IF NOT EXISTS idx_borrow_requests_status    ON borrow_requests(status);

-- ------------------------------------------------------------
-- BorrowTransactions (physical handover + history)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS borrow_transactions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    borrow_request_id  INTEGER NOT NULL UNIQUE,
    issue_date         TEXT,
    due_date           TEXT,
    original_due_date  TEXT,
    return_date        TEXT,
    transaction_status TEXT NOT NULL DEFAULT 'active'
                       CHECK (transaction_status IN ('active','returned','overdue')),
    extension_days     INTEGER NOT NULL DEFAULT 0,
    extension_history  TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (borrow_request_id) REFERENCES borrow_requests(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON borrow_transactions(transaction_status);
CREATE INDEX IF NOT EXISTS idx_transactions_due    ON borrow_transactions(due_date);

-- ------------------------------------------------------------
-- LibraryInventory (college library copies only)
-- Invariant: total_copies = available_copies + reserved_copies + issued_copies
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_inventory (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id           INTEGER NOT NULL,
    total_copies      INTEGER NOT NULL DEFAULT 0,
    available_copies  INTEGER NOT NULL DEFAULT 0,
    reserved_copies   INTEGER NOT NULL DEFAULT 0,
    issued_copies     INTEGER NOT NULL DEFAULT 0,
    shelf_number      TEXT,
    rack_number       TEXT,
    max_issue_days    INTEGER NOT NULL DEFAULT 14,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    CHECK (total_copies >= 0 AND available_copies >= 0
           AND reserved_copies >= 0 AND issued_copies >= 0),
    CHECK (total_copies = available_copies + reserved_copies + issued_copies)
);
CREATE INDEX IF NOT EXISTS idx_inventory_book ON library_inventory(book_id);

-- ------------------------------------------------------------
-- LibraryReservations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_reservations (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_code   TEXT NOT NULL UNIQUE,
    student_user_id    INTEGER NOT NULL,
    inventory_id       INTEGER NOT NULL,
    reservation_status TEXT NOT NULL DEFAULT 'pending'
                       CHECK (reservation_status IN ('pending','confirmed','collected','cancelled','expired','rejected')),
    reservation_date   TEXT NOT NULL DEFAULT (datetime('now')),
    expiry_date        TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (student_user_id) REFERENCES users(id)              ON DELETE CASCADE,
    FOREIGN KEY (inventory_id)    REFERENCES library_inventory(id)  ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reservations_student   ON library_reservations(student_user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_inventory ON library_reservations(inventory_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status    ON library_reservations(reservation_status);

-- ------------------------------------------------------------
-- LibraryIssues (counter issue / return)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_issues (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id        INTEGER NOT NULL UNIQUE,
    inventory_id          INTEGER NOT NULL,
    student_user_id       INTEGER NOT NULL,
    issued_by_librarian_id INTEGER,
    issue_date            TEXT NOT NULL DEFAULT (datetime('now')),
    due_date              TEXT NOT NULL,
    return_date           TEXT,
    issue_status          TEXT NOT NULL DEFAULT 'issued'
                          CHECK (issue_status IN ('issued','returned','overdue')),
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (reservation_id)         REFERENCES library_reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (inventory_id)           REFERENCES library_inventory(id)    ON DELETE CASCADE,
    FOREIGN KEY (student_user_id)        REFERENCES users(id)                ON DELETE CASCADE,
    FOREIGN KEY (issued_by_librarian_id) REFERENCES users(id)                ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_issues_student ON library_issues(student_user_id);
CREATE INDEX IF NOT EXISTS idx_issues_status  ON library_issues(issue_status);
CREATE INDEX IF NOT EXISTS idx_issues_due     ON library_issues(due_date);

-- ------------------------------------------------------------
-- Notifications
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL,
    title             TEXT NOT NULL,
    message           TEXT NOT NULL,
    notification_type TEXT NOT NULL
                      CHECK (notification_type IN (
                          'borrow_request','borrow_approved','borrow_rejected',
                          'return_reminder','overdue','library_reserved',
                          'library_issued','library_returned','reservation_expired',
                          'order_update','system_alert')),
    is_read           INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- ------------------------------------------------------------
-- Orders (vendor sales - simulated checkout, no payment data)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    student_user_id   INTEGER NOT NULL,
    vendor_user_id    INTEGER NOT NULL,
    listing_id        INTEGER NOT NULL,
    quantity          INTEGER NOT NULL CHECK (quantity > 0),
    unit_price        REAL NOT NULL CHECK (unit_price >= 0),
    total_amount      REAL NOT NULL CHECK (total_amount >= 0),
    order_status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK (order_status IN ('pending','confirmed','shipped','delivered','cancelled')),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (student_user_id) REFERENCES users(id)          ON DELETE CASCADE,
    FOREIGN KEY (vendor_user_id)  REFERENCES users(id)          ON DELETE CASCADE,
    FOREIGN KEY (listing_id)      REFERENCES book_listings(id)  ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_orders_student ON orders(student_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_vendor  ON orders(vendor_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(order_status);

-- ------------------------------------------------------------
-- PasswordResets (hashed OTPs only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id              INTEGER NOT NULL,
    verification_code_hash TEXT NOT NULL,
    expires_at           TEXT NOT NULL,
    verified_at          TEXT,
    used_at              TEXT,
    attempts             INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

-- ------------------------------------------------------------
-- AuditLogs (administrative + inventory actions)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id  INTEGER,
    action         TEXT NOT NULL,
    entity_type    TEXT NOT NULL,
    entity_id      INTEGER,
    details        TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ------------------------------------------------------------
-- ReminderLogs (prevents duplicate due-date reminders)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminder_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type     TEXT NOT NULL,   -- 'library_issue' | 'borrow_transaction'
    entity_id       INTEGER NOT NULL,
    reminder_type   TEXT NOT NULL,   -- 'upcoming_2d' | 'upcoming_1d' | 'overdue'
    sent_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (entity_type, entity_id, reminder_type)
);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_entity ON reminder_logs(entity_type, entity_id);
