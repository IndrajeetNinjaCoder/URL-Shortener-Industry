const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { pool }       = require('../config/db');
const { secret, expiresIn } = require('../config/jwt');

/* ── POST /auth/signup ───────────────────────────────────── */
async function signup(req, res) {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email and password are required' });

  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password)
       VALUES ($1, $2, $3) RETURNING id, name, email, created_at`,
      [name, email, hashedPassword]
    );

    const user  = result.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      secret,
      { expiresIn }
    );

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: user.id, name: user.name, email: user.email, createdAt: user.created_at }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
}

/* ── POST /auth/login ────────────────────────────────────── */
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'email and password are required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);

    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Invalid email or password' });

    const user  = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);

    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      secret,
      { expiresIn }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email, createdAt: user.created_at }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
}

/* ── GET /auth/me ────────────────────────────────────────── */
async function getMe(req, res) {
  try {
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id=$1',
      [req.user.id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'User not found' });

    const user = result.rows[0];
    res.json({ id: user.id, name: user.name, email: user.email, createdAt: user.created_at });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
}

module.exports = { signup, login, getMe };