'use strict';

const { ApiError, fail } = require('../utils/response');
const env = require('../config/environment');

/** 404 for unknown API routes. */
function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Central error handler.
 * - Maps ApiError to its status code.
 * - Maps body-parser / JSON errors to 400.
 * - Logs everything server-side but never leaks internals to the client.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  // Malformed JSON body
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return fail(res, 400, 'Malformed JSON in request body');
  }
  // Multer file size limit
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return fail(res, 400, 'Image file is too large (max 2 MB)');
  }

  if (err instanceof ApiError && err.isOperational) {
    return fail(res, err.statusCode, err.message);
  }

  // Unexpected error: log full detail, return a generic message.
  // eslint-disable-next-line no-console
  console.error(`[ERROR] ${new Date().toISOString()} ${req.method} ${req.originalUrl}:`, err);

  const message = env.isDevelopment && err && err.message
    ? err.message
    : 'Internal server error';
  return fail(res, 500, message);
}

module.exports = { notFoundHandler, errorHandler };
