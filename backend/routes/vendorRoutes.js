'use strict';

const express = require('express');
const controller = require('../controllers/vendorController');
const { requireAuth, optionalAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');

const router = express.Router();

// Public marketplace (students browse sale listings)
router.get('/marketplace', optionalAuth, controller.marketplace);

// Vendor-only management
router.post(
  '/listings',
  requireAuth,
  requireRole('vendor', 'admin'),
  controller.upload.single('image'),
  validate({
    body: {
      title: { required: true, type: 'string', minLength: 2, maxLength: 200 },
      author: { required: true, type: 'string', minLength: 2, maxLength: 150 },
      price: { required: true, type: 'number', min: 0 },
      stock_quantity: { required: true, type: 'integer', min: 1 },
    },
  }),
  controller.createListing
);

router.get('/listings', requireAuth, requireRole('vendor', 'admin'), controller.myListings);
router.patch('/listings/:id', requireAuth, requireRole('vendor', 'admin'), controller.updateListing);

// Orders
router.post(
  '/orders',
  requireAuth,
  requireRole('student', 'faculty', 'admin'),
  validate({
    body: {
      listing_id: { required: true, type: 'integer', min: 1 },
      quantity: { required: true, type: 'integer', min: 1, max: 20 },
    },
  }),
  controller.placeOrder
);

router.get('/orders', requireAuth, requireRole('vendor', 'admin'), controller.vendorOrders);
router.patch('/orders/:id/status', requireAuth, requireRole('vendor', 'admin'), controller.updateOrderStatus);

module.exports = router;
