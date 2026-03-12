const express = require('express');
const { rateLimiter } = require('./middleware/rateLimiter');
const authRoutes      = require('./routes/auth.routes');
const urlRoutes      = require('./routes/url.routes');
const analyticsRoutes = require('./routes/analytics.routes');

const app = express();

app.use(express.json());
app.use(rateLimiter);

app.use('/auth',       authRoutes);
app.use('/', urlRoutes);
app.use('/analytics', analyticsRoutes);

module.exports = app;
