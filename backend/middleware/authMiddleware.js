'use strict';

const { verifyToken } = require('../utils/generateToken');
const { ApiError } = require('../utils/response');
const { getDb } = require('../config/database');

/**
 * Require a valid JWT in the Authorization: Bearer header.
 * Loads the fresh user row onto req.user (never exposes password_hash).
 */
function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw ApiError.unauthorized('Authentication token missing');
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') throw ApiError.unauthorized('Session expired, please log in again');
      throw ApiError.unauthorized('Invalid authentication token');
    }

    const db = getDb();
    const user = db
      .prepare(
        `SELECT id, full_name, email, mobile_number, role, account_status,
                email_verified, mobile_verified, created_at, updated_at
         FROM users WHERE id = ?`
      )
      .get(decoded.sub);

    if (!user) throw ApiError.unauthorized('Account no longer exists');
    if (user.account_status === 'suspended') throw ApiError.forbidden('Account is suspended');
    if (user.account_status === 'rejected') throw ApiError.forbidden('Account application was rejected');
    if (user.account_status === 'pending') {
      throw ApiError.forbidden('Account is pending approval');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth: attaches req.user when a valid token is present,
 * but does not fail otherwise. Used for endpoints where login
 * changes the response (e.g. book listings the user owns).
 */
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const decoded = verifyToken(token);
      const db = getDb();
      const user = db
        .prepare(
          `SELECT id, full_name, email, mobile_number, role, account_status,
                  email_verified, mobile_verified, created_at, updated_at
           FROM users WHERE id = ? AND account_status = 'active'`
        )
        .get(decoded.sub);
      if (user) req.user = user;
    } catch (_err) {
      // ignore - optional auth never rejects
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
