'use strict';

const { ApiError } = require('../utils/response');

/**
 * Tiny declarative request validator (no external dependency).
 *
 * Usage:
 *   validate({
 *     body: {
 *       title: { required: true, type: 'string', minLength: 2, maxLength: 200 },
 *       email: { required: true, type: 'email' },
 *       role:  { required: true, enum: ['student', 'faculty'] },
 *       age:   { type: 'integer', min: 1 }
 *     },
 *     query: { page: { type: 'integer', min: 1 } }
 *   })
 *
 * Supported rules: required, type (string|integer|number|boolean|email|array|object),
 * minLength, maxLength, min, max, enum, pattern, custom(value)
 */
function checkValue(value, rules, label) {
  if (value === undefined || value === null || value === '') {
    if (rules.required) throw ApiError.validationError(`${label} is required`);
    return; // optional and absent
  }

  switch (rules.type) {
    case 'string':
      if (typeof value !== 'string') throw ApiError.validationError(`${label} must be a string`);
      if (rules.minLength && value.trim().length < rules.minLength) {
        throw ApiError.validationError(`${label} must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength && value.length > rules.maxLength) {
        throw ApiError.validationError(`${label} must be at most ${rules.maxLength} characters`);
      }
      break;
    case 'integer': {
      const n = Number(value);
      if (!Number.isInteger(n)) throw ApiError.validationError(`${label} must be an integer`);
      if (rules.min !== undefined && n < rules.min) throw ApiError.validationError(`${label} must be at least ${rules.min}`);
      if (rules.max !== undefined && n > rules.max) throw ApiError.validationError(`${label} must be at most ${rules.max}`);
      break;
    }
    case 'number': {
      const n = Number(value);
      if (Number.isNaN(n)) throw ApiError.validationError(`${label} must be a number`);
      if (rules.min !== undefined && n < rules.min) throw ApiError.validationError(`${label} must be at least ${rules.min}`);
      if (rules.max !== undefined && n > rules.max) throw ApiError.validationError(`${label} must be at most ${rules.max}`);
      break;
    }
    case 'boolean':
      if (!['true', 'false', true, false, 0, 1, '0', '1'].includes(value)) {
        throw ApiError.validationError(`${label} must be a boolean`);
      }
      break;
    case 'email':
      if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        throw ApiError.validationError(`${label} must be a valid email address`);
      }
      break;
    case 'array':
      if (!Array.isArray(value)) throw ApiError.validationError(`${label} must be an array`);
      break;
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        throw ApiError.validationError(`${label} must be an object`);
      }
      break;
    default:
      break;
  }

  if (rules.enum && !rules.enum.includes(value)) {
    throw ApiError.validationError(`${label} must be one of: ${rules.enum.join(', ')}`);
  }
  if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
    throw ApiError.validationError(rules.patternMessage || `${label} has an invalid format`);
  }
  if (typeof rules.custom === 'function') {
    const result = rules.custom(value);
    if (result !== true) throw ApiError.validationError(result || `${label} is invalid`);
  }
}

function validate(sources = {}) {
  return (req, _res, next) => {
    try {
      for (const [source, rules] of Object.entries(sources)) {
        const bag = req[source] || {};
        for (const [field, rule] of Object.entries(rules)) {
          checkValue(bag[field], rule, `${source}.${field}`);
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Strip SQL wildcards that could be abused; escape LIKE special chars. */
function sanitizeSearchTerm(term) {
  if (typeof term !== 'string') return '';
  return term.replace(/[\\%_]/g, (m) => `\\${m}`).trim();
}

module.exports = { validate, sanitizeSearchTerm };
