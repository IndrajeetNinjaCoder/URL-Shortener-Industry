const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');

const { getAnalytics } = require('../controllers/analytics.controller');

// router.get('/:shortId', getAnalytics);
router.get('/:shortId', authenticate, getAnalytics); 

module.exports = router;
