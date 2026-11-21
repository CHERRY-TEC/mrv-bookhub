'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const env = require('./environment');

let db = null;

/**
 * Open the SQLite database, apply schema, enable integrity pragmas.
 * The schema file is idempotent (CREATE TABLE IF NOT EXISTS).
 */
function initDatabase() {
  if (db) return db;

  const dbPath = env.DATABASE_PATH_ABS;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  return db;
}

function getDb() {
  if (!db) return initDatabase();
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run a function inside a better-sqlite3 transaction.
 * Rolls back automatically on any thrown error.
 */
function withTransaction(fn) {
  const database = getDb();
  return database.transaction(fn)();
}

module.exports = { initDatabase, getDb, closeDatabase, withTransaction };
