'use strict';

/**
 * Initialize the database schema.
 * Usage:  node database/init.js [--fresh]
 *   --fresh deletes the existing database file first.
 */

const fs = require('fs');
const path = require('path');
const { initDatabase, closeDatabase, getDb } = require('../config/database');

if (process.argv.includes('--fresh')) {
  const dbPath = require('../config/environment').DATABASE_PATH_ABS;
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath + suffix;
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      console.log(`Removed ${path.basename(f)}`);
    }
  }
}

initDatabase();
const db = getDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);

console.log(`Database initialized with ${tables.length} tables:`);
console.log('  ' + tables.join(', '));
closeDatabase();
