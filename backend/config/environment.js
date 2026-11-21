'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Load .env from the backend root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,

  DATABASE_PATH: process.env.DATABASE_PATH || './database/mrv_bookhub.db',

  JWT_SECRET: process.env.JWT_SECRET || 'dev_only_secret_change_me_in_production_32_chars',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  BCRYPT_SALT_ROUNDS: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12,

  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads/book-images',
  MAX_IMAGE_SIZE_BYTES: parseInt(process.env.MAX_IMAGE_SIZE_BYTES, 10) || 2 * 1024 * 1024,

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
  SMTP_FROM: process.env.SMTP_FROM || 'MRV BookHub <no-reply@mrvbookhub.local>',

  OTP_EXPIRY_MINUTES: parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10,
  OTP_RESEND_LIMIT: parseInt(process.env.OTP_RESEND_LIMIT, 10) || 3,
  OTP_RESEND_WINDOW_MINUTES: parseInt(process.env.OTP_RESEND_WINDOW_MINUTES, 10) || 15,
  DEV_SIMULATE_OTP: process.env.DEV_SIMULATE_OTP === 'true',

  SMS_PROVIDER: process.env.SMS_PROVIDER || '',
  SMS_API_KEY: process.env.SPI_API_KEY || process.env.SMS_API_KEY || '',
  SMS_SENDER_ID: process.env.SMS_SENDER_ID || '',

  RESERVATION_EXPIRY_DAYS: parseInt(process.env.RESERVATION_EXPIRY_DAYS, 10) || 3,
  DEFAULT_MAX_ISSUE_DAYS: parseInt(process.env.DEFAULT_MAX_ISSUE_DAYS, 10) || 14,

  REMINDER_CRON: process.env.REMINDER_CRON || '0 9 * * *',
  REMINDER_UPCOMING_DAYS: parseInt(process.env.REMINDER_UPCOMING_DAYS, 10) || 2,
  REMINDER_ENABLED: process.env.REMINDER_ENABLED !== 'false',
};

env.isProduction = env.NODE_ENV === 'production';
env.isDevelopment = !env.isProduction;

// Refuse to run production with the placeholder secret
if (env.isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('dev_only'))) {
  throw new Error('JWT_SECRET must be set to a strong random value in production.');
}

// Resolve DATABASE_PATH / UPLOAD_DIR relative to backend root
const backendRoot = path.join(__dirname, '..');
env.DATABASE_PATH_ABS = path.isAbsolute(env.DATABASE_PATH)
  ? env.DATABASE_PATH
  : path.join(backendRoot, env.DATABASE_PATH);
env.UPLOAD_DIR_ABS = path.isAbsolute(env.UPLOAD_DIR)
  ? env.UPLOAD_DIR
  : path.join(backendRoot, env.UPLOAD_DIR);

module.exports = env;
