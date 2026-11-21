'use strict';

const express = require('express');
const controller = require('../controllers/libraryController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');

const router = express.Router();

const librarianOnly = requireRole('librarian', 'admin');

// --- Inventory (librarian) ---
router.post(
  '/inventory',
  requireAuth,
  librarianOnly,
  validate({
    body: {
      title: { required: true, type: 'string', minLength: 2, maxLength: 200 },
      author: { required: true, type: 'string', minLength: 2, maxLength: 150 },
      total_copies: { required: true, type: 'integer', min: 1, max: 10000 },
    },
  }),
  controller.addInventory
);

router.put('/inventory/:id', requireAuth, librarianOnly, controller.updateInventory);
router.get('/inventory', requireAuth, librarianOnly, controller.listInventory);

// --- Search (any authenticated user) ---
router.get('/books', requireAuth, controller.searchLibraryBooks);

// --- Reservations ---
router.post(
  '/reservations',
  requireAuth,
  requireRole('student', 'admin'),
  validate({ body: { inventory_id: { required: true, type: 'integer', min: 1 } } }),
  controller.createReservation
);

router.get('/my-reservations', requireAuth, controller.myReservations);
router.get('/reservations', requireAuth, librarianOnly, controller.listReservations);

router.patch('/reservations/:id/approve', requireAuth, librarianOnly, controller.approveReservation);
router.patch('/reservations/:id/reject', requireAuth, librarianOnly, controller.rejectReservation);
// Student cancels own reservation; librarian/admin can cancel any (checked in controller)
router.patch('/reservations/:id/cancel', requireAuth, controller.cancelReservation);

// --- Counter issue / return (librarian) ---
router.post(
  '/issues',
  requireAuth,
  librarianOnly,
  validate({ body: { reservation_id: { required: true, type: 'integer', min: 1 } } }),
  controller.issueBook
);

router.patch('/issues/:id/return', requireAuth, librarianOnly, controller.returnBook);
router.get('/issues', requireAuth, librarianOnly, controller.listIssues);

// --- Reports ---
router.get('/reports', requireAuth, librarianOnly, controller.reports);

module.exports = router;
