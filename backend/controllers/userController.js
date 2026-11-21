'use strict';

const { getDb } = require('../config/database');
const { ApiError, ok } = require('../utils/response');
const { loadProfile, safeUser } = require('./authController');
const auditService = require('../services/auditService');

/** GET /api/users/profile */
async function getProfile(req, res, next) {
  try {
    return ok(res, { profile: loadProfile(req.user.id) }, 'OK');
  } catch (err) {
    next(err);
  }
}

/** PUT /api/users/profile - update safe profile fields */
async function updateProfile(req, res, next) {
  try {
    const db = getDb();
    const { full_name, mobile_number, department_id, academic_year, semester, designation } = req.body;

    if (mobile_number !== undefined) {
      if (!/^\d{10,15}$/.test(String(mobile_number).replace(/\D/g, ''))) {
        throw ApiError.validationError('mobile_number must be a valid phone number');
      }
      const dup = db
        .prepare('SELECT id FROM users WHERE mobile_number = ? AND id != ?')
        .get(mobile_number, req.user.id);
      if (dup) throw ApiError.conflict('That mobile number is already in use');
    }

    const userFields = [];
    const userParams = [];
    if (full_name) { userFields.push('full_name = ?'); userParams.push(full_name.trim()); }
    if (mobile_number) { userFields.push('mobile_number = ?'); userParams.push(mobile_number); }
    if (userFields.length) {
      userFields.push("updated_at = datetime('now')");
      db.prepare(`UPDATE users SET ${userFields.join(', ')} WHERE id = ?`).run(...userParams, req.user.id);
    }

    if (req.user.role === 'student') {
      const fields = [];
      const params = [];
      if (department_id !== undefined) {
        const d = db.prepare('SELECT id FROM departments WHERE id = ?').get(department_id);
        if (!d) throw ApiError.validationError('Unknown department_id');
        fields.push('department_id = ?'); params.push(department_id);
      }
      if (academic_year !== undefined) { fields.push('academic_year = ?'); params.push(academic_year); }
      if (semester !== undefined) { fields.push('semester = ?'); params.push(Number(semester)); }
      if (fields.length) {
        db.prepare(`UPDATE students SET ${fields.join(', ')} WHERE user_id = ?`).run(...params, req.user.id);
      }
    } else if (req.user.role === 'faculty' && designation !== undefined) {
      db.prepare('UPDATE faculty SET designation = ? WHERE user_id = ?').run(designation, req.user.id);
    }

    auditService.logAudit({
      actorUserId: req.user.id,
      action: 'profile_updated',
      entityType: 'user',
      entityId: req.user.id,
      details: Object.keys(req.body).join(','),
    });

    return ok(res, { profile: loadProfile(req.user.id) }, 'Profile updated');
  } catch (err) {
    next(err);
  }
}

/** GET /api/users/departments - shared reference data */
async function listDepartments(_req, res, next) {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT id, department_name, department_code FROM departments ORDER BY department_name').all();
    return ok(res, rows, 'OK');
  } catch (err) {
    next(err);
  }
}

/** GET /api/users/:id - public profile summary (for request lists) */
async function getUserById(req, res, next) {
  try {
    const db = getDb();
    const user = db
      .prepare(
        `SELECT id, full_name, email, mobile_number, role, account_status, created_at
         FROM users WHERE id = ?`
      )
      .get(req.params.id);
    if (!user) throw ApiError.notFound('User not found');
    return ok(res, { user }, 'OK');
  } catch (err) {
    next(err);
  }
}

module.exports = { getProfile, updateProfile, listDepartments, getUserById, safeUser };
