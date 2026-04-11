const express = require('express');
const router  = express.Router();
const { signup, login, getMe, googleLogin } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

router.post('/google', googleLogin);
router.post('/signup', signup);
router.post('/login',  login);
router.get( '/me',     authenticate, getMe);   // protected — returns current user

module.exports = router;