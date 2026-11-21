/**
 * Vercel serverless entry point for the MRV BookHub API.
 * SQLite lives in /tmp (Vercel's only writable path) and is seeded on cold
 * start with the project's real idempotent seed script. Data is ephemeral.
 */
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'mrv-bookhub-public-demo-jwt-secret-2026-change-me';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://mrv-deploy.vercel.app';
process.env.DATABASE_PATH = '/tmp/mrv_bookhub.db';
process.env.DEV_SIMULATE_OTP = 'true';
process.env.REMINDER_ENABLED = 'false';

let app = null;
let initError = null;
try {
  app = require('../server'); // Express app (server.js exports it)
} catch (e) {
  initError = e;
  console.error('API init error:', e);
}

let seedPromise = null;
function ensureSeed() {
  if (seedPromise) return seedPromise;
  seedPromise = new Promise((resolve) => {
    try {
      const { getDb, closeDatabase } = require('../config/database');
      const count = getDb().prepare('SELECT COUNT(*) AS c FROM users').get().c;
      if (count > 0) { resolve(); return; }
      // Run the real seed script (idempotent), then close so requests reopen.
      require('../database/seed');
      const wait = (n) => {
        try {
          if (getDb().prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) {
            closeDatabase(); resolve(); return;
          }
        } catch (e) { /* schema not ready */ }
        if (n > 200) { resolve(); return; }
        setTimeout(() => wait(n + 1), 25);
      };
      wait(0);
    } catch (e) {
      console.error('seed error', e);
      resolve();
    }
  });
  return seedPromise;
}

module.exports = async (req, res) => {
  if (initError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, message: 'API init failed', error: String(initError) }));
    return;
  }
  try {
    await ensureSeed();
    return app(req, res);
  } catch (e) {
    console.error('handler error', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, message: 'Handler error', error: String(e) }));
  }
};
