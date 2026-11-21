'use strict';

const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { getDb, withTransaction } = require('../config/database');
const env = require('../config/environment');
const { ApiError, ok } = require('../utils/response');
const { generateToken } = require('../utils/generateToken');
const { generateNumericCode, hashVerificationCode } = require('../utils/generateReservationId');
const { addMinutes, now, isPast } = require('../utils/dateUtils');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const auditService = require('../services/auditService');

// ---------------------------------------------------------------
// Rate limiters (auth endpoints)
// ---------------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, try again after 15 minutes' },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification requests, try again later' },
});

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/** Strip sensitive fields before returning a user object. */
function safeUser(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

function hashPassword(plain) {
  return bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
}

function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * Assert the account is allowed to log in and return the profile payload.
 */
function buildLoginResponse(user, extra = {}) {
  if (user.account_status === 'suspended') throw ApiError.forbidden('Account is suspended. Contact the administrator.');
  if (user.account_status === 'rejected') throw ApiError.forbidden('Account application was rejected.');
  if (user.account_status === 'pending') throw ApiError.forbidden('Account is pending approval by an administrator.');

  const token = generateToken({ id: user.id, role: user.role });
  return {
    token,
    user: safeUser(user),
    ...extra,
  };
}

/** Fetch the full profile (student/faculty/vendor/librarian details). */
function loadProfile(userId) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  const profile = { ...safeUser(user) };

  if (user.role === 'student') {
    profile.student = db
      .prepare(
        `SELECT s.id, s.hall_ticket_number, s.academic_year, s.semester,
                s.department_id, d.department_name, d.department_code
         FROM students s
         LEFT JOIN departments d ON d.id = s.department_id
         WHERE s.user_id = ?`
      )
      .get(userId);
  } else if (user.role === 'faculty') {
    profile.faculty = db
      .prepare(
        `SELECT f.id, f.faculty_id, f.designation, f.department_id,
                d.department_name, d.department_code
         FROM faculty f
         LEFT JOIN departments d ON d.id = f.department_id
         WHERE f.user_id = ?`
      )
      .get(userId);
  } else if (user.role === 'vendor') {
    profile.vendor = db.prepare('SELECT * FROM vendors WHERE user_id = ?').get(userId);
  } else if (user.role === 'librarian') {
    profile.librarian = db.prepare('SELECT * FROM librarians WHERE user_id = ?').get(userId);
  }

  return profile;
}

// ---------------------------------------------------------------
// STUDENT REGISTRATION
// ---------------------------------------------------------------
async function registerStudent(req, res, next) {
  try {
    const {
      full_name, hall_ticket_number, email, mobile_number,
      department_id, academic_year, semester, password, confirm_password,
    } = req.body;

    if (password !== confirm_password) {
      throw ApiError.validationError('Password and confirm password do not match');
    }
    if (!/^\d{6,15}$/.test(String(mobile_number).replace(/\D/g, ''))) {
      throw ApiError.validationError('mobile_number must be a valid phone number');
    }

    const db = getDb();

    // Uniqueness checks
    if (db.prepare('SELECT id FROM students WHERE hall_ticket_number = ?').get(hall_ticket_number)) {
      throw ApiError.conflict('A student with this hall ticket number already exists');
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      throw ApiError.conflict('An account with this email already exists');
    }
    if (db.prepare('SELECT id FROM users WHERE mobile_number = ?').get(mobile_number)) {
      throw ApiError.conflict('An account with this mobile number already exists');
    }

    // Department validation (optional field, but must exist when provided)
    let deptId = null;
    if (department_id) {
      const dept = db.prepare('SELECT id FROM departments WHERE id = ?').get(department_id);
      if (!dept) throw ApiError.validationError('Unknown department_id');
      deptId = department_id;
    }

    // -------------------------------------------------------
    // Official student-list verification integration point.
    // When the college provides an authorized student list API/table,
    // verify hall_ticket_number against it here. With no official
    // system available, accounts are queued for admin approval.
    // -------------------------------------------------------
    const requiresApproval = true; // demonstration policy: admin approves
    const accountStatus = requiresApproval ? 'pending' : 'active';

    const passwordHash = await hashPassword(password);

    const userId = withTransaction(() => {
      const info = db
        .prepare(
          `INSERT INTO users (full_name, email, mobile_number, password_hash, role, account_status)
           VALUES (?, ?, ?, ?, 'student', ?)`
        )
        .run(full_name.trim(), email.toLowerCase().trim(), mobile_number, passwordHash, accountStatus);

      db.prepare(
        `INSERT INTO students (user_id, hall_ticket_number, department_id, academic_year, semester)
         VALUES (?, ?, ?, ?, ?)`
      ).run(info.lastInsertRowid, hall_ticket_number.trim().toUpperCase(), deptId, academic_year || null, semester || null);

      return info.lastInsertRowid;
    });

    auditService.logAudit({
      actorUserId: userId,
      action: 'student_registered',
      entityType: 'user',
      entityId: userId,
      details: `Hall ticket ${hall_ticket_number}`,
    });

    notificationService.createNotification({
      userId,
      title: 'Welcome to MRV BookHub',
      message: requiresApproval
        ? 'Your registration was received. An administrator will verify your account shortly.'
        : 'Your account is active. Happy borrowing!',
      type: 'system_alert',
    });

    return ok(
      res,
      {
        id: userId,
        full_name,
        hall_ticket_number: hall_ticket_number.toUpperCase(),
        account_status: accountStatus,
        approval_required: requiresApproval,
      },
      requiresApproval
        ? 'Registration successful. Your account is pending administrator approval.'
        : 'Registration successful.',
      201
    );
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// Generic credential resolver for role-specific logins
// ---------------------------------------------------------------

/**
 * @param {'student'|'faculty'|'librarian'|'vendor'|'admin'} role
 * @param {string} identifierValue hall ticket / faculty id / staff id / email
 */
async function roleLogin(role, identifierValue, password) {
  if (!identifierValue || !password) {
    throw ApiError.validationError('Credentials are required');
  }

  const db = getDb();
  const id = String(identifierValue).trim();

  let user = null;

  if (role === 'student') {
    const row = db
      .prepare(
        `SELECT u.* FROM users u
         JOIN students s ON s.user_id = u.id
         WHERE UPPER(s.hall_ticket_number) = UPPER(?)`
      )
      .get(id);
    user = row;
  } else if (role === 'faculty') {
    user = db
      .prepare(
        `SELECT u.* FROM users u
         JOIN faculty f ON f.user_id = u.id
         WHERE UPPER(f.faculty_id) = UPPER(?)`
      )
      .get(id);
  } else if (role === 'librarian') {
    user = db
      .prepare(
        `SELECT u.* FROM users u
         JOIN librarians l ON l.user_id = u.id
         WHERE UPPER(l.staff_id) = UPPER(?)`
      )
      .get(id);
  } else if (role === 'vendor') {
    user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND role = ?').get(id, 'vendor');
  } else if (role === 'admin') {
    user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND role = ?').get(id, 'admin');
  }

  if (!user) throw ApiError.unauthorized('Invalid credentials');
  if (user.role !== role) throw ApiError.unauthorized('Invalid credentials');

  const match = await comparePassword(password, user.password_hash);
  if (!match) throw ApiError.unauthorized('Invalid credentials');

  auditService.logAudit({
    actorUserId: user.id,
    action: 'login',
    entityType: 'user',
    entityId: user.id,
    details: `${role} login`,
  });

  return buildLoginResponse(user, { profile: loadProfile(user.id) });
}

async function loginStudent(req, res, next) {
  try {
    const data = await roleLogin('student', req.body.hall_ticket_number, req.body.password);
    return ok(res, data, 'Login successful');
  } catch (err) { next(err); }
}

async function loginFaculty(req, res, next) {
  try {
    const data = await roleLogin('faculty', req.body.faculty_id, req.body.password);
    return ok(res, data, 'Login successful');
  } catch (err) { next(err); }
}

async function loginLibrarian(req, res, next) {
  try {
    const data = await roleLogin('librarian', req.body.staff_id, req.body.password);
    return ok(res, data, 'Login successful');
  } catch (err) { next(err); }
}

async function loginVendor(req, res, next) {
  try {
    const data = await roleLogin('vendor', req.body.email, req.body.password);
    // Only approved vendors may operate
    const db = getDb();
    const vendor = db.prepare('SELECT approval_status FROM vendors WHERE user_id = ?').get(data.user.id);
    if (vendor && vendor.approval_status !== 'approved') {
      throw ApiError.forbidden('Vendor account is not approved yet');
    }
    return ok(res, data, 'Login successful');
  } catch (err) { next(err); }
}

async function loginAdmin(req, res, next) {
  try {
    const data = await roleLogin('admin', req.body.email, req.body.password);
    return ok(res, data, 'Login successful');
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------
// FORGOT PASSWORD / OTP RESET
// ---------------------------------------------------------------

/** Count resend attempts inside the configured window. */
function resendWindowCount(userId) {
  const db = getDb();
  const windowStart = addMinutes(now(), -env.OTP_RESEND_WINDOW_MINUTES);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM password_resets
       WHERE user_id = ? AND created_at >= ?`
    )
    .get(userId, windowStart);
  return row.c;
}

async function forgotPassword(req, res, next) {
  try {
    const { identifier } = req.body; // email or mobile number
    const db = getDb();

    const user = db
      .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR mobile_number = ?')
      .get(String(identifier).trim(), String(identifier).trim());

    // Always answer the same way to avoid account enumeration.
    const genericMsg =
      'If an account exists for that email or mobile number, a verification code has been sent.';

    if (!user) return ok(res, { delivered: false }, genericMsg);

    if (resendWindowCount(user.id) >= env.OTP_RESEND_LIMIT) {
      throw new ApiError(429, `Too many codes requested. Please wait ${env.OTP_RESEND_WINDOW_MINUTES} minutes and try again.`);
    }

    // Invalidate previous unused codes
    db.prepare(
      'UPDATE password_resets SET used_at = datetime(\'now\') WHERE user_id = ? AND used_at IS NULL'
    ).run(user.id);

    const code = generateNumericCode(6);
    const expiresAt = addMinutes(now(), env.OTP_EXPIRY_MINUTES);

    db.prepare(
      `INSERT INTO password_resets (user_id, verification_code_hash, expires_at)
       VALUES (?, ?, ?)`
    ).run(user.id, hashVerificationCode(code), expiresAt);

    const delivery = await emailService.deliverOtp({
      email: user.email,
      mobile: user.mobile_number,
      code,
      purpose: 'password reset',
    });

    const payload = { delivered: true, channel: delivery.mode || 'email' };

    // DEVELOPMENT ONLY: surface the OTP so the flow can be tested without SMTP.
    if (env.isDevelopment && env.DEV_SIMULATE_OTP && !emailService.isConfigured()) {
      payload.dev_simulated_otp = code;
      payload.dev_warning = 'Development-only simulated OTP. Never returned in production.';
    }

    return ok(res, payload, genericMsg);
  } catch (err) {
    next(err);
  }
}

async function verifyResetCode(req, res, next) {
  try {
    const { identifier, code } = req.body;
    const db = getDb();

    const user = db
      .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR mobile_number = ?')
      .get(String(identifier).trim(), String(identifier).trim());

    if (!user) throw ApiError.badRequest('Invalid verification code');

    const record = db
      .prepare(
        `SELECT * FROM password_resets
         WHERE user_id = ? AND used_at IS NULL AND verified_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(user.id);

    if (!record) throw ApiError.badRequest('No pending verification code. Request a new one.');

    if (isPast(record.expires_at)) {
      throw ApiError.badRequest('Verification code has expired. Request a new one.');
    }
    if (record.attempts >= 5) {
      throw ApiError.badRequest('Too many failed attempts. Request a new code.');
    }

    const hash = hashVerificationCode(code);
    if (hash !== record.verification_code_hash) {
      db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(record.id);
      throw ApiError.badRequest('Invalid verification code');
    }

    db.prepare('UPDATE password_resets SET verified_at = datetime(\'now\') WHERE id = ?').run(record.id);

    return ok(res, { verified: true, reset_token: null }, 'Code verified. You can now set a new password.');
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { identifier, code, new_password, confirm_password } = req.body;

    if (new_password !== confirm_password) {
      throw ApiError.validationError('Password and confirm password do not match');
    }
    if (String(new_password).length < 8) {
      throw ApiError.validationError('Password must be at least 8 characters');
    }

    const db = getDb();
    const user = db
      .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR mobile_number = ?')
      .get(String(identifier).trim(), String(identifier).trim());

    if (!user) throw ApiError.badRequest('Invalid verification code');

    const record = db
      .prepare(
        `SELECT * FROM password_resets
         WHERE user_id = ? AND verified_at IS NOT NULL AND used_at IS NULL
         ORDER BY verified_at DESC LIMIT 1`
      )
      .get(user.id);

    if (!record) throw ApiError.badRequest('Verify your code first (or request a new one).');
    if (isPast(record.expires_at)) throw ApiError.badRequest('Verification code has expired. Request a new one.');
    if (record.verification_code_hash !== hashVerificationCode(code)) {
      throw ApiError.badRequest('Invalid verification code');
    }

    const newHash = await hashPassword(new_password);

    withTransaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(newHash, user.id);
      db.prepare('UPDATE password_resets SET used_at = datetime(\'now\') WHERE user_id = ? AND used_at IS NULL')
        .run(user.id);
      // Invalidate sessions: since we use stateless JWTs, bump a token
      // invalidation marker by rotating updated_at (JWT contains only id/role,
      // so we also clear any outstanding codes).
    });

    auditService.logAudit({
      actorUserId: user.id,
      action: 'password_reset',
      entityType: 'user',
      entityId: user.id,
      details: 'Password reset via OTP',
    });

    notificationService.createNotification({
      userId: user.id,
      title: 'Password changed',
      message: 'Your MRV BookHub password was just reset. If this was not you, contact the administrator immediately.',
      type: 'system_alert',
    });

    return ok(res, null, 'Password reset successful. You can now log in.');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// Current session
// ---------------------------------------------------------------
async function me(req, res, next) {
  try {
    return ok(res, { profile: loadProfile(req.user.id) }, 'OK');
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    if (new_password !== confirm_password) {
      throw ApiError.validationError('Password and confirm password do not match');
    }
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!(await comparePassword(current_password, user.password_hash))) {
      throw ApiError.badRequest('Current password is incorrect');
    }
    const hash = await hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(hash, req.user.id);

    return ok(res, null, 'Password changed successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  loginLimiter,
  otpLimiter,
  registerStudent,
  loginStudent,
  loginFaculty,
  loginLibrarian,
  loginVendor,
  loginAdmin,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  changePassword,
  me,
  loadProfile,
  safeUser,
};
