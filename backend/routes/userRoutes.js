'use strict';

const express = require('express');
const controller = require('../controllers/userController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(requireAuth);

// Reference data (needed by registration/profile screens)
router.get('/departments', controller.listDepartments);

router.get('/profile', controller.getProfile);
router.put('/profile', controller.updateProfile);
router.get('/:id', controller.getUserById);

module.exports = router;
