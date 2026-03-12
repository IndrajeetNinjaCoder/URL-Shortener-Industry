const express = require('express');
const router  = express.Router();

const { getAnalytics } = require('../controllers/analytics.controller');

router.get('/:shortId', getAnalytics);

module.exports = router;
