const express = require('express');
const router  = express.Router();
const { signup, login, getMe } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

router.post('/signup', signup);
router.post('/login',  login);
router.get( '/me',     authenticate, getMe);   // protected — returns current user

module.exports = router;