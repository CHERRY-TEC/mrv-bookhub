'use strict';

const express = require('express');
const controller = require('../controllers/borrowController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');

const router = express.Router();

// All borrow routes require authentication
router.use(requireAuth);

// Request a book (students + faculty borrow; admins can too)
router.post(
  '/request',
  requireRole('student', 'faculty', 'admin'),
  validate({
    body: {
      listing_id: { required: true, type: 'integer', min: 1 },
      requested_days: { required: true, type: 'integer', min: 1, max: 90 },
    },
  }),
  controller.createRequest
);

// Views
router.get('/my-requests', controller.myRequests);
router.get('/received-requests', controller.receivedRequests);
router.get('/history', controller.history);

// Owner/admin decisions
router.patch('/:id/approve', controller.approveRequest);
router.patch('/:id/reject', controller.rejectRequest);
router.post('/:id/cancel', controller.cancelRequest);

// Physical handover + return (owner, borrower or admin - enforced in controller)
router.post('/:id/issue', controller.issueBook);
router.patch('/:id/return', controller.returnBook);

// Extension workflow
router.post(
  '/:id/extension-request',
  validate({ body: { extension_days: { required: true, type: 'integer', min: 1, max: 60 } } }),
  controller.extensionRequest
);
router.patch('/:id/extension-approve', controller.extensionApprove);
router.patch('/:id/extension-reject', controller.extensionReject);

module.exports = router;
