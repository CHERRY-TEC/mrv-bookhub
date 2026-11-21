'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/environment');

/**
 * Sign a JWT carrying only non-sensitive identity data.
 * @param {{id:number, role:string}} payload
 * @returns {string} signed token
 */
function generateToken(payload) {
  return jwt.sign(
    { sub: payload.id, role: payload.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

/**
 * Verify a JWT. Throws on invalid/expired token.
 * @param {string} token
 * @returns {{sub:number, role:string, iat:number, exp:number}}
 */
function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

module.exports = { generateToken, verifyToken };
