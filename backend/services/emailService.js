'use strict';

const nodemailer = require('nodemailer');
const env = require('../config/environment');

let transporter = null;

function isConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER);
}

function getTransporter() {
  if (transporter) return transporter;
  if (!isConfigured()) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: Number(env.SMTP_PORT) === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });
  return transporter;
}

/**
 * Send an email. When SMTP is not configured the message is logged to the
 * console in development so the workflow can still be exercised locally.
 * @param {{to:string, subject:string, text:string, html?:string}} options
 */
async function sendEmail({ to, subject, text, html }) {
  if (!to) throw new Error('sendEmail: recipient required');

  const tx = getTransporter();
  if (!tx) {
    if (env.isDevelopment) {
      // eslint-disable-next-line no-console
      console.log(`[EMAIL:DEV-MODE] To: ${to} | Subject: ${subject}\n${text}`);
    }
    return { delivered: false, mode: 'dev-console' };
  }

  const info = await tx.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    text,
    html: html || `<pre>${text}</pre>`,
  });
  return { delivered: true, messageId: info.messageId };
}

/**
 * Deliver an OTP to the user. Uses email always; SMS only when a provider
 * is configured (see SMS_PROVIDER in .env). Returns the delivery mode so
 * the controller knows whether a dev-simulated OTP may be surfaced.
 */
async function deliverOtp({ email, mobile, code, purpose = 'password reset' }) {
  const message =
    `Your MRV BookHub ${purpose} code is: ${code}\n` +
    `It expires in ${env.OTP_EXPIRY_MINUTES} minutes. If you did not request this, ignore this message.`;

  let mode = 'none';
  try {
    if (email) {
      await sendEmail({
        to: email,
        subject: `MRV BookHub - Your ${purpose} code`,
        text: message,
      });
      mode = 'email';
    }
  } catch (err) {
    console.error('[EMAIL] OTP delivery failed:', err.message);
  }

  // Real SMS delivery requires a configured provider account.
  if (env.SMS_PROVIDER && env.SMS_API_KEY && mobile) {
    // Integration point: plug in MSG91 / Twilio / AWS SNS here.
    // We deliberately do not fake SMS delivery.
    console.warn(`[SMS] Provider "${env.SMS_PROVIDER}" configured but not wired. OTP delivered via ${mode}.`);
  }

  return { mode };
}

module.exports = { isConfigured, sendEmail, deliverOtp };
