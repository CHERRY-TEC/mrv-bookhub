'use strict';

const express = require('express');
const controller = require('../controllers/adminController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');

const router = express.Router();

// Everything in this router is admin-only
router.use(requireAuth, requireRole('admin'));

// Users
router.get('/users', controller.listUsers);
router.patch(
  '/users/:id/approve',
  validate({ params: { id: { required: true, type: 'integer', min: 1 } } }),
  controller.approveUser
);
router.patch(
  '/users/:id/suspend',
  validate({ params: { id: { required: true, type: 'integer', min: 1 } } }),
  controller.suspendUser
);

// Listings / books
router.get('/books', controller.listAllListings);
router.delete('/books/:id', controller.removeListing);

// Departments
router.post(
  '/departments',
  validate({
    body: {
      department_name: { required: true, type: 'string', minLength: 2, maxLength: 80 },
      department_code: { required: true, type: 'string', minLength: 2, maxLength: 20 },
    },
  }),
  controller.createDepartment
);
router.delete('/departments/:id', controller.deleteDepartment);

// Reports & audit
router.get('/reports', controller.reports);
router.get('/audit-logs', controller.auditLogs);

// System broadcast
router.post(
  '/broadcast',
  validate({
    body: {
      title: { required: true, type: 'string', minLength: 2, maxLength: 120 },
      message: { required: true, type: 'string', minLength: 2, maxLength: 500 },
    },
  }),
  controller.broadcast
);

module.exports = router;
