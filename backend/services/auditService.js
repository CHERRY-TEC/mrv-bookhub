'use strict';

const { getDb } = require('../config/database');

/**
 * Append an audit log entry for administrative / inventory actions.
 * Failures are swallowed - auditing must never break the main operation.
 *
 * @param {{actorUserId?:number|null, action:string, entityType:string, entityId?:number|null, details?:string}} entry
 */
function logAudit({ actorUserId = null, action, entityType, entityId = null, details = null }) {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(actorUserId, action, entityType, entityId, details);
  } catch (err) {
    console.error('[AUDIT] failed to write log:', err.message);
  }
}

function getAuditLogs({ limit = 100, offset = 0, action = null, entityType = null } = {}) {
  const db = getDb();
  const clauses = [];
  const params = [];
  if (action) { clauses.push('a.action = ?'); params.push(action); }
  if (entityType) { clauses.push('a.entity_type = ?'); params.push(entityType); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  return db
    .prepare(
      `SELECT a.id, a.actor_user_id, u.full_name AS actor_name, a.action,
              a.entity_type, a.entity_id, a.details, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
}

module.exports = { logAudit, getAuditLogs };
