'use strict';

const express = require('express');
const controller = require('../controllers/bookController');
const { requireAuth, optionalAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');

const router = express.Router();

const listableRoles = requireRole('student', 'faculty', 'vendor', 'admin');

// IMPORTANT: /search must be registered before /:id
router.get('/search', optionalAuth, controller.searchBooks);

router.get('/', optionalAuth, controller.listBooks);

router.post(
  '/',
  requireAuth,
  listableRoles,
  controller.upload.single('image'),
  validate({
    body: {
      title: { required: true, type: 'string', minLength: 2, maxLength: 200 },
      author: { required: true, type: 'string', minLength: 2, maxLength: 150 },
      listing_type: { required: true, type: 'string', enum: ['borrow', 'sell', 'both'] },
    },
  }),
  controller.createBook
);

router.get('/:id', optionalAuth, controller.getBook);

router.put(
  '/:id',
  requireAuth,
  listableRoles,
  controller.upload.single('image'),
  controller.updateBook
);

router.delete('/:id', requireAuth, listableRoles, controller.deleteBook);

module.exports = router;
