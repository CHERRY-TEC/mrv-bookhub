'use strict';

/**
 * Central API error type. Controllers throw ApiError and the
 * error middleware maps it to the correct HTTP status.
 */
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg = 'Invalid input') { return new ApiError(400, msg); }
  static unauthorized(msg = 'Not authenticated') { return new ApiError(401, msg); }
  static forbidden(msg = 'Permission denied') { return new ApiError(403, msg); }
  static notFound(msg = 'Resource not found') { return new ApiError(404, msg); }
  static conflict(msg = 'Conflict') { return new ApiError(409, msg); }
  static validationError(msg = 'Validation error') { return new ApiError(422, msg); }
  static internal(msg = 'Internal server error') { return new ApiError(500, msg); }
}

/** Standard success envelope. */
function ok(res, data = null, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}

/** Standard error envelope. */
function fail(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

module.exports = { ApiError, ok, fail };
