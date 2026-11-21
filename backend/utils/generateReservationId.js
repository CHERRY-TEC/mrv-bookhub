'use strict';

const crypto = require('crypto');

/**
 * Generate a human-readable unique reservation code, e.g. MRV-RES-8F3K-29QZ.
 * Collision retry is handled by the caller via the UNIQUE constraint.
 * @returns {string}
 */
function generateReservationId() {
  const segment = () => crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4);
  return `MRV-RES-${segment()}-${segment()}`;
}

/**
 * Generate a short random numeric OTP (dev/demo delivery only).
 * @param {number} digits
 * @returns {string}
 */
function generateNumericCode(digits = 6) {
  const max = 10 ** digits;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(digits, '0');
}

/**
 * Hash a verification code with HMAC-SHA256 using the JWT secret as pepper.
 * Codes are never stored in plain text.
 * @param {string} code
 * @returns {string} hex digest
 */
function hashVerificationCode(code) {
  return crypto.createHmac('sha256', envSafeSecret()).update(String(code)).digest('hex');
}

function envSafeSecret() {
  // Lazy require to avoid circular imports
  return require('../config/environment').JWT_SECRET;
}

module.exports = { generateReservationId, generateNumericCode, hashVerificationCode };
