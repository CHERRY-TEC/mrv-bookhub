'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const env = require('./config/environment');
const { initDatabase, closeDatabase } = require('./config/database');
const { notFoundHandler, errorHandler } = require('./middleware/errorMiddleware');
const reminderService = require('./services/reminderService');

// --- Initialize database (creates tables if missing) ---
initDatabase();

// --- Express app ---
const app = express();

// Security headers
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // API serves JSON, not HTML
}));

// CORS - only configured frontend origins
const allowedOrigins = env.FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    // Allow non-browser tools (curl, server-to-server) and configured origins
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Global rate limit (generous - auth endpoints have their own stricter limits)
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down' },
}));

// Static serving of uploaded book images
app.use('/uploads/book-images', express.static(env.UPLOAD_DIR_ABS, {
  maxAge: '7d',
  dotfiles: 'deny',
  index: false,
}));

// --- Health check ---
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'MRV BookHub API is running', data: { status: 'ok', time: new Date().toISOString() } });
});

// --- API routes ---
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/books', require('./routes/bookRoutes'));
app.use('/api/borrow', require('./routes/borrowRoutes'));
app.use('/api/library', require('./routes/libraryRoutes'));
app.use('/api/vendor', require('./routes/vendorRoutes'));
app.use('/api/orders', require('./routes/vendorRoutes')); // student order views share the vendor router
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// --- 404 + error handling ---
app.use(notFoundHandler);
app.use(errorHandler);

// --- Start ---
let server = null;
if (require.main === module) {
  server = app.listen(env.PORT, () => {
    console.log(`\n  MRV BookHub API listening on http://localhost:${env.PORT}/api`);
    console.log(`  Environment: ${env.NODE_ENV}`);
    console.log(`  Database:    ${env.DATABASE_PATH_ABS}`);
    console.log(`  CORS origin: ${allowedOrigins.join(', ') || '(none configured)'}\n`);
    reminderService.startReminderScheduler();
  });
}

function shutdown() {
  console.log('\nShutting down...');
  closeDatabase();
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
