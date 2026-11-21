/**
 * Vercel serverless entry point for the MRV BookHub API.
 *
 * Vercel's filesystem is read-only except /tmp, so SQLite lives there and is
 * seeded on cold start using the project's real seed script. Data is
 * ephemeral (resets on cold start) — fine for the public demo. The full
 * persistent backend runs locally with a file-backed DB.
 */
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'mrv-bookhub-public-demo-jwt-secret-2026-change-me';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://mrv-deploy.vercel.app';
process.env.DATABASE_PATH = '/tmp/mrv_bookhub.db';
process.env.DEV_SIMULATE_OTP = 'true';
process.env.REMINDER_ENABLED = 'false';

const path = require('path');
const app = require('../server'); // Express app (server.js exports it)

let seedPromise = null;
function ensureSeed() {
  if (!seedPromise) {
    seedPromise = new Promise((resolve) => {
      try {
        // The real seed script is idempotent (skips if users already exist).
        // It runs async internally and closes the DB when done.
        const seed = require('../database/seed');
        // Wait for the seed script to finish, then reopen the DB for the app.
        const { closeDatabase, getDb } = require('../config/database');
        const waitForSeed = (tries = 0) => {
          try {
            const count = getDb().prepare('SELECT COUNT(*) AS c FROM users').get().c;
            if (count > 0) { closeDatabase(); resolve(); return; }
          } catch (e) { /* schema not ready yet */ }
          if (tries > 100) { resolve(); return; }
          setTimeout(() => waitForSeed(tries + 1), 50);
        };
        waitForSeed();
      } catch (e) {
        console.error('seed load error', e);
        resolve();
      }
    });
  }
  return seedPromise;
}

module.exports = async (req, res) => {
  await ensureSeed();
  return app(req, res);
};
