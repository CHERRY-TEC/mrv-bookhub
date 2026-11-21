'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/authController');
const { validate } = require('../middleware/validationMiddleware');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// Stricter limiter for OTP request endpoints
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification code requests. Please wait 15 minutes.' },
});

// --- Registration (public) ---
router.post(
  '/register/student',
  controller.loginLimiter,
  validate({
    body: {
      full_name: { required: true, type: 'string', minLength: 3, maxLength: 120 },
      hall_ticket_number: { required: true, type: 'string', minLength: 4, maxLength: 30 },
      email: { required: true, type: 'email' },
      mobile_number: { required: true, type: 'string', minLength: 10, maxLength: 15 },
      password: { required: true, type: 'string', minLength: 8, maxLength: 72 },
      confirm_password: { required: true, type: 'string', minLength: 8, maxLength: 72 },
    },
  }),
  controller.registerStudent
);

// --- Role-specific logins (public) ---
router.post(
  '/login/student',
  controller.loginLimiter,
  validate({ body: { hall_ticket_number: { required: true, type: 'string' }, password: { required: true, type: 'string' } } }),
  controller.loginStudent
);

router.post(
  '/login/faculty',
  controller.loginLimiter,
  validate({ body: { faculty_id: { required: true, type: 'string' }, password: { required: true, type: 'string' } } }),
  controller.loginFaculty
);

router.post(
  '/login/librarian',
  controller.loginLimiter,
  validate({ body: { staff_id: { required: true, type: 'string' }, password: { required: true, type: 'string' } } }),
  controller.loginLibrarian
);

router.post(
  '/login/vendor',
  controller.loginLimiter,
  validate({ body: { email: { required: true, type: 'email' }, password: { required: true, type: 'string' } } }),
  controller.loginVendor
);

router.post(
  '/login/admin',
  controller.loginLimiter,
  validate({ body: { email: { required: true, type: 'email' }, password: { required: true, type: 'string' } } }),
  controller.loginAdmin
);

// --- Forgot password flow ---
router.post(
  '/forgot-password',
  otpRequestLimiter,
  validate({ body: { identifier: { required: true, type: 'string', minLength: 3, maxLength: 120 } } }),
  controller.forgotPassword
);

router.post(
  '/verify-reset-code',
  controller.otpLimiter,
  validate({
    body: {
      identifier: { required: true, type: 'string', minLength: 3, maxLength: 120 },
      code: { required: true, type: 'string', minLength: 4, maxLength: 10 },
    },
  }),
  controller.verifyResetCode
);

router.post(
  '/reset-password',
  controller.otpLimiter,
  validate({
    body: {
      identifier: { required: true, type: 'string' },
      code: { required: true, type: 'string', minLength: 4, maxLength: 10 },
      new_password: { required: true, type: 'string', minLength: 8, maxLength: 72 },
      confirm_password: { required: true, type: 'string', minLength: 8, maxLength: 72 },
    },
  }),
  controller.resetPassword
);

// --- Session ---
router.get('/me', requireAuth, controller.me);

router.post(
  '/change-password',
  requireAuth,
  validate({
    body: {
      current_password: { required: true, type: 'string' },
      new_password: { required: true, type: 'string', minLength: 8 },
      confirm_password: { required: true, type: 'string', minLength: 8 },
    },
  }),
  controller.changePassword
);

module.exports = router;
