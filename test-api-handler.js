process.chdir('C:/Users/HANMANTH/MRV-BookHub/backend');
process.env.JWT_SECRET = 'mrv-bookhub-public-demo-jwt-secret-2026-change-me';
process.env.FRONTEND_URL = 'https://mrv-deploy.vercel.app';
process.env.DATABASE_PATH = '/tmp/mrv_bookhub.db';
process.env.DEV_SIMULATE_OTP = 'true';
process.env.REMINDER_ENABLED = 'false';

const app = require('C:/Users/HANMANTH/MRV-BookHub/backend/server');
const { initDatabase, getDb, closeDatabase } = require('C:/Users/HANMANTH/MRV-BookHub/backend/config/database');

const server = app.listen(5099, async () => {
  initDatabase();
  const count = getDb().prepare('SELECT COUNT(*) AS c FROM users').get().c;
  console.log('USERS SEEDED:', count);
  if (count === 0) {
    await new Promise((resolve) => {
      require('C:/Users/HANMANTH/MRV-BookHub/backend/database/seed');
      const wait = (n) => {
        try {
          if (getDb().prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) { closeDatabase(); return resolve(); }
        } catch {}
        if (n > 100) return resolve();
        setTimeout(() => wait(n + 1), 50);
      };
      wait(0);
    });
  }
  closeDatabase();

  const calls = [
    ['GET', '/api/health'],
    ['GET', '/api/books?limit=3&availability=available'],
    ['POST', '/api/auth/login/student', { hall_ticket_number: '22B81A0501', password: 'Student@123' }],
  ];
  for (const [method, path, body] of calls) {
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch('http://localhost:5099' + path, opts);
      const text = await res.text();
      console.log(method, path, '->', res.status, text.slice(0, 250));
    } catch (e) { console.log('ERR', path, e.message); }
  }
  server.close();
});
