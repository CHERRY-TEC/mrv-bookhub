'use strict';

const { ApiError } = require('../utils/response');

/**
 * Restrict a route to the listed roles.
 * Must run after requireAuth.
 *
 * Usage: router.patch('/x', requireAuth, requireRole('librarian'), handler)
 */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    next();
  };
}

/**
 * Assert that the acting user owns the resource or is an admin.
 * @param {{ownerUserId:number}} resource
 * @param {object} user authenticated user from req.user
 * @param {string} [message]
 */
function assertOwnerOrAdmin(resource, user, message = 'You can only modify your own records') {
  if (!user) throw ApiError.unauthorized();
  if (user.role === 'admin') return;
  if (resource.owner_user_id !== user.id && resource.ownerUser !== user.id) {
    throw ApiError.forbidden(message);
  }
}

module.exports = { requireRole, assertOwnerOrAdmin };
