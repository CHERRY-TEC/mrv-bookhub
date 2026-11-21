# MRV BookHub — Backend

Complete backend for **MRV BookHub**, a college book-sharing and digital library management platform. Node.js + Express + SQLite (better-sqlite3), JWT authentication, role-based access control, and a 3D React frontend.

## Features

| Module | Highlights |
|---|---|
| **Authentication** | Student (hall ticket), faculty, librarian, vendor and admin logins; bcrypt hashing; JWT in `Authorization: Bearer`; forgot-password OTP flow with hashed codes, expiry and resend limits |
| **Book catalogue** | Shared `books` table, listings with `borrow`/`sell`/`both`, image upload (Multer), search by title/author/course/department/ISBN with pagination & sorting |
| **Peer-to-peer borrowing** | Request → approve → physical handover → return, plus extension requests with owner approval; duplicate-request and self-borrow guards |
| **Digital library** | Inventory with the enforced invariant `total = available + reserved + issued`, transactional reservations with unique codes and expiry, counter issue/return, reports |
| **Vendor marketplace** | Approved vendors only, backend-calculated totals, stock checks inside transactions, simulated checkout (no payment data) |
| **Notifications** | In-app notifications for every workflow event + optional Nodemailer email when SMTP is configured |
| **Reminders** | node-cron scheduler: 2-days-before, 1-day-before and overdue notifications with duplicate suppression (`reminder_logs`) |
| **Admin** | User approval/suspension, listing moderation, departments, reports, audit logs, system broadcast |
| **Security** | helmet, CORS allow-list, rate limiting on auth/OTP, parameterized SQL, upload type/size limits with random filenames, central error handler that never leaks internals |

## Tech stack

- **Runtime:** Node.js 18+ (tested on Node 24)
- **Framework:** Express 4
- **Database:** SQLite via `better-sqlite3` (synchronous, transactional)
- **Auth:** `jsonwebtoken` + `bcrypt`
- **Other:** `multer`, `nodemailer`, `node-cron`, `helmet`, `cors`, `express-rate-limit`, `dotenv`

## Project structure

```
MRV-BookHub/
├── backend/
│   ├── config/          # database.js, environment.js
│   ├── controllers/     # auth, user, book, borrow, library, vendor, notification, admin
│   ├── routes/          # one router per module
│   ├── middleware/      # auth, role, validation, error
│   ├── services/        # notification, email, reminder, inventory, audit
│   ├── database/        # schema.sql, init.js, seed.js
│   ├── uploads/book-images/
│   ├── utils/           # token, reservation id, date, response, upload
│   ├── tests/           # run-tests.js (88 checks), test-reminders.js
│   ├── server.js
│   ├── .env / .env.example
│   └── package.json
└── frontend/            # 3D scrollable React (React Three Fiber) shelf site
```

## Installation

```bash
cd MRV-BookHub/backend
npm install
```

## Environment variables

Copy `.env.example` to `.env` and adjust:

```bash
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 5000) |
| `DATABASE_PATH` | SQLite file path |
| `JWT_SECRET` | **Must** be a long random string in production |
| `FRONTEND_URL` | CORS allow-list (comma separated) |
| `SMTP_*` | Nodemailer settings — leave blank for dev console mode |
| `DEV_SIMULATE_OTP` | `true` in dev: OTP returned in the response. **Never** `true` in production |
| `RESERVATION_EXPIRY_DAYS` | Library reservation expiry (default 3) |
| `REMINDER_CRON` | Reminder schedule (default `0 9 * * *` = daily 09:00) |
| `REMINDER_UPCOMING_DAYS` | Days-before-due reminder window (default 2) |

## Database setup & initialization

```bash
npm run db:init     # create tables (idempotent)
npm run db:seed     # load sample data (skips if users exist)
npm run db:reset    # drop + recreate + seed
```

Schema: `database/schema.sql` (18 tables with PKs, FKs, CHECK constraints, indexes and unique constraints). The inventory CHECK constraint independently guarantees `total = available + reserved + issued`, on top of transactional enforcement in `inventoryService`.

## Running

```bash
npm start           # production-style
npm run dev         # auto-restart on changes
```

API base: `http://localhost:5000/api` — health check at `GET /api/health`.

## Testing

```bash
node tests/run-tests.js       # 88 end-to-end checks across all modules
node tests/test-reminders.js  # reminder scan + duplicate suppression
```

Covered: registration/duplicate hall ticket/incorrect password/pending & suspended login, unauthorized access, book upload/search/update/delete + SQL-injection attempt, complete borrow lifecycle, library reserve/issue/return with invariant checks, vendor stock & order flows, notifications, OTP password reset, admin approval/suspension/reports/audit.

## Test accounts (development only)

| Role | Identifier | Password |
|---|---|---|
| Student | hall ticket `22B81A0501` | `Student@123` |
| Student | hall ticket `22B81A0502` | `Student@123` |
| Faculty | faculty id `FAC001` | `Faculty@123` |
| Librarian | staff id `LIB001` | `Librarian@123` |
| Vendor | `campus@vendor.com` | `Vendor@123` |
| Admin | `admin@mrvbookhub.local` | `Admin@123` |

> ⚠️ **Never ship these credentials in production.** Admin accounts must be created through a controlled process; public admin registration is intentionally not implemented.

## API reference

All responses use the envelope `{ "success": bool, "message": str, "data": ... }`.

### Auth — `/api/auth`
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/register/student` | public | Creates pending account (admin approval) |
| POST | `/login/student` | public | `{hall_ticket_number, password}` |
| POST | `/login/faculty` | public | `{faculty_id, password}` |
| POST | `/login/librarian` | public | `{staff_id, password}` |
| POST | `/login/vendor` | public | `{email, password}` (approved vendors only) |
| POST | `/login/admin` | public | `{email, password}` |
| POST | `/forgot-password` | public (rate-limited) | `{identifier}` → OTP (dev mode returns `dev_simulated_otp`) |
| POST | `/verify-reset-code` | public | `{identifier, code}` |
| POST | `/reset-password` | public | `{identifier, code, new_password, confirm_password}` |
| GET | `/me` | auth | Current profile |
| POST | `/change-password` | auth | |

### Users — `/api/users`
`GET /departments` · `GET /profile` · `PUT /profile` · `GET /:id`

### Books — `/api/books`
| Method | Path | Access |
|---|---|---|
| GET | `/search?title=&author=&course_code=&department=&category=&condition=&availability=&listing_type=&isbn=&sort=&page=&limit=` | public |
| GET | `/?listing_type=&department_id=&availability=&sort=&page=` | public |
| POST | `/` | student/faculty/vendor/admin (multipart, `image` file) |
| GET | `/:id` | public |
| PUT | `/:id` | owner or admin |
| DELETE | `/:id` | owner or admin (blocked during active transaction) |

### Borrowing — `/api/borrow`
| Method | Path | Access |
|---|---|---|
| POST | `/request` | student/faculty/admin |
| GET | `/my-requests` · `/received-requests` · `/history` | auth |
| PATCH | `/:id/approve` · `/:id/reject` | owner or admin |
| POST | `/:id/cancel` | borrower |
| POST | `/:id/issue` | owner, borrower or admin |
| PATCH | `/:id/return` | owner, borrower or admin |
| POST | `/:id/extension-request` | borrower |
| PATCH | `/:id/extension-approve` · `/:id/extension-reject` | owner or admin |

### Library — `/api/library`
| Method | Path | Access |
|---|---|---|
| POST/PUT/GET | `/inventory[/:id]` | librarian/admin |
| GET | `/books` (search) | auth |
| POST | `/reservations` | student/admin |
| GET | `/my-reservations` | auth |
| GET | `/reservations` | librarian/admin |
| PATCH | `/reservations/:id/approve` · `/reject` | librarian/admin |
| PATCH | `/reservations/:id/cancel` | owner, librarian or admin |
| POST | `/issues` (accepts `hall_ticket_number` for identity check) | librarian/admin |
| PATCH | `/issues/:id/return` | librarian/admin |
| GET | `/issues` (add `overdue=true`) | librarian/admin |
| GET | `/reports` | librarian/admin |

### Vendor — `/api/vendor`
| Method | Path | Access |
|---|---|---|
| GET | `/marketplace` | public |
| POST/GET/PATCH | `/listings[/:id]` | approved vendor/admin |
| POST | `/orders` | student/faculty/admin (simulated checkout) |
| GET | `/orders` | vendor/admin |
| PATCH | `/orders/:id/status` | vendor/admin (cancel restores stock) |

### Notifications — `/api/notifications`
`GET /` (`?unread=true`) · `PATCH /:id/read` · `PATCH /read-all` · `DELETE /:id`

### Admin — `/api/admin` (admin only)
`GET /users` · `PATCH /users/:id/approve` · `PATCH /users/:id/suspend` · `GET /books` · `DELETE /books/:id` · `POST/DELETE /departments` · `GET /reports` · `GET /audit-logs` · `POST /broadcast`

## Frontend connection

The React frontend reads the API base URL from an env variable:

```bash
# frontend/.env
VITE_API_BASE_URL=http://localhost:5000/api
```

```js
const API = import.meta.env.VITE_API_BASE_URL;
fetch(`${API}/books/search?title=python`, {
  headers: { Authorization: `Bearer ${token}` }
});
```

Set `FRONTEND_URL=http://localhost:5173` in the backend `.env` to allow the Vite dev origin (CORS is deny-by-default).

## Features requiring external services

| Feature | Status | What you need |
|---|---|---|
| **Email OTP / notifications** | Dev console mode when SMTP blank | Real SMTP credentials (Gmail app password, SendGrid, etc.) |
| **Mobile SMS OTP** | **Not wired** — integration point in `emailService.deliverOtp` | A provider account (MSG91 / Twilio / AWS SNS) + `SMS_PROVIDER`, `SMS_API_KEY` |
| **Official student-list verification** | Admin approval fallback | College API/table — hook in `authController.registerStudent` |
| **Payments** | **Simulated only** — no card/banking data is ever accepted | A payment gateway (Razorpay/Stripe) if real checkout is ever required |
| **HTTPS** | Terminate at reverse proxy (nginx/Cloudflare) in production | TLS certificate |

## Security notes

- Passwords: bcrypt (cost 12), never stored or returned in plain text
- OTP codes: HMAC-SHA256 hashed, 10-minute expiry, 3 resends / 15 min, 5 verify attempts
- All SQL uses parameterized queries; LIKE wildcards escaped
- Rate limits: 600 req/15 min global API, 30/15 min logins, 8/15 min OTP requests
- Uploads: JPEG/PNG/WEBP only, 2 MB max, random filenames, original name discarded
- Errors: `ApiError` types map to correct statuses; unexpected errors return a generic 500
- Inventory mutations are transactional with an in-database CHECK invariant
- Audit log written for logins, approvals, inventory changes, order and admin actions
