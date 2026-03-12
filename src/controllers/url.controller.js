const { nanoid }      = require('nanoid');
const bcrypt          = require('bcrypt');
const QRCode          = require('qrcode');
const axios           = require('axios');
const { pool }        = require('../config/db');
const { redisClient } = require('../config/redis');
const { parseTTL, logClick } = require('../utils/helpers');

/* ── Helpers ─────────────────────────────────────────────────── */

async function cacheUrl(shortId, url, ttlSeconds) {
  if (ttlSeconds) {
    await redisClient.set(shortId, url, { EX: ttlSeconds });
  } else {
    await redisClient.set(shortId, url);
  }
}

/* ── POST /shorten ───────────────────────────────────────────── */

async function createShortUrl(req, res) {
  const { url, customAlias, password, clickLimit, oneTime, ...expiryOpts } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required' });

  const shortId    = customAlias || nanoid(6);
  const ttlSeconds = parseTTL(expiryOpts);
  const expiresAt  = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
  const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

  try {
    const existing = await pool.query('SELECT short_id FROM urls WHERE short_id=$1', [shortId]);
    if (existing.rows.length > 0)
      return res.status(400).json({ error: 'Custom alias already taken' });

    await pool.query(
      `INSERT INTO urls (short_id, original_url, expires_at, password, click_limit, one_time)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [shortId, url, expiresAt, hashedPassword, clickLimit || null, oneTime || false]
    );

    const shortUrl = `http://localhost:3000/${shortId}`;
    const qrCode   = await QRCode.toDataURL(shortUrl);

    if (!hashedPassword) await cacheUrl(shortId, url, ttlSeconds);

    res.json({ shortUrl, qrCode, expiresAt, clickLimit, oneTime,
               customAlias: customAlias || null, passwordProtected: !!password });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
}

/* ── GET /:shortId ───────────────────────────────────────────── */

async function redirectUrl(req, res) {
  const { shortId } = req.params;

  try {
    /* Redis cache hit */
    const cachedUrl = await redisClient.get(shortId);
    if (cachedUrl) {
      await logClick(shortId, req);
      return res.redirect(cachedUrl);
    }

    /* DB lookup */
    const result = await pool.query(
      `SELECT original_url, expires_at, password, click_limit, one_time
       FROM urls WHERE short_id=$1`,
      [shortId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Short URL not found' });

    const { original_url, expires_at, password: storedPassword, click_limit, one_time } = result.rows[0];

    /* Expiry */
    if (expires_at && new Date() > expires_at)
      return res.status(410).json({ error: 'Link has expired' });

    /* Password */
    if (storedPassword) {
      const userPassword = req.query.password;
      if (!userPassword)
        return res.status(401).json({ message: 'Password required to access this link' });
      const valid = await bcrypt.compare(userPassword, storedPassword);
      if (!valid)
        return res.status(403).json({ error: 'Incorrect password' });
    }

    /* Click limit & one-time checks share the same COUNT query */
    if (click_limit || one_time) {
      const { rows } = await pool.query(
        'SELECT COUNT(*) FROM click_events WHERE short_id=$1', [shortId]
      );
      const count = parseInt(rows[0].count);

      if (click_limit && count >= click_limit)
        return res.status(410).json({ error: 'Click limit reached' });
      if (one_time && count >= 1)
        return res.status(410).json({ error: 'This was a one-time link and has already been used' });
    }

    if (!storedPassword) await redisClient.set(shortId, original_url);

    await logClick(shortId, req);
    return res.redirect(original_url);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
}

/* ── GET /preview/:shortId ───────────────────────────────────── */

async function previewUrl(req, res) {
  const { shortId } = req.params;

  try {
    const result = await pool.query(
      `SELECT original_url, expires_at, click_limit, one_time, created_at
       FROM urls WHERE short_id=$1`,
      [shortId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Short URL not found' });

    const { original_url, expires_at, click_limit, one_time, created_at } = result.rows[0];

    /* OG metadata — best-effort */
    let meta = { title: null, description: null, image: null };
    try {
      const { data: html } = await axios.get(original_url, {
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)' }
      });

      const og = (prop) => html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'));

      meta.title       = (og('title')       || html.match(/<title[^>]*>([^<]+)<\/title>/i))?.[1]?.trim() || null;
      meta.description = (og('description') || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i))?.[1]?.trim() || null;
      meta.image       = og('image')?.[1]?.trim() || null;
    } catch (_) { /* silent */ }

    const { rows } = await pool.query('SELECT COUNT(*) FROM click_events WHERE short_id=$1', [shortId]);

    res.json({
      shortId,
      shortUrl:    `http://localhost:3000/${shortId}`,
      originalUrl: original_url,
      createdAt:   created_at,
      expiresAt:   expires_at,
      clickLimit:  click_limit,
      oneTime:     one_time,
      totalClicks: parseInt(rows[0].count),
      preview:     meta
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
}

/* ── PUT /edit/:shortId ──────────────────────────────────────── */

async function editUrl(req, res) {
  const { shortId } = req.params;
  const { url, password, clickLimit, oneTime, newAlias, ...expiryOpts } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM urls WHERE short_id=$1', [shortId]);
    if (existing.rows.length === 0)
      return res.status(404).json({ error: 'Short URL not found' });

    const fields = [], values = [];
    let idx = 1;

    if (url)               { fields.push(`original_url = $${idx++}`); values.push(url); }

    const ttlSeconds = parseTTL(expiryOpts);
    if (ttlSeconds !== null) {
      fields.push(`expires_at = $${idx++}`);
      values.push(new Date(Date.now() + ttlSeconds * 1000));
    }

    if (password !== undefined) {
      fields.push(`password = $${idx++}`);
      values.push(password ? await bcrypt.hash(password, 10) : null);
    }
    if (clickLimit !== undefined) { fields.push(`click_limit = $${idx++}`); values.push(clickLimit || null); }
    if (oneTime    !== undefined) { fields.push(`one_time = $${idx++}`);    values.push(oneTime); }

    let finalShortId = shortId;
    if (newAlias && newAlias !== shortId) {
      const taken = await pool.query('SELECT short_id FROM urls WHERE short_id=$1', [newAlias]);
      if (taken.rows.length > 0)
        return res.status(400).json({ error: 'New alias already taken' });
      fields.push(`short_id = $${idx++}`);
      values.push(newAlias);
      finalShortId = newAlias;
    }

    if (fields.length === 0)
      return res.status(400).json({ error: 'No fields to update' });

    values.push(shortId);
    await pool.query(`UPDATE urls SET ${fields.join(', ')} WHERE short_id = $${idx}`, values);

    /* Invalidate + re-cache */
    await redisClient.del(shortId);
    const { rows } = await pool.query('SELECT * FROM urls WHERE short_id=$1', [finalShortId]);
    const row = rows[0];

    if (!row.password) {
      const newTtl = row.expires_at
        ? Math.floor((new Date(row.expires_at) - Date.now()) / 1000)
        : null;
      if (newTtl && newTtl > 0) await redisClient.set(finalShortId, row.original_url, { EX: newTtl });
      else if (!row.expires_at) await redisClient.set(finalShortId, row.original_url);
    }

    res.json({
      message:       'Link updated successfully',
      shortId:       finalShortId,
      shortUrl:      `http://localhost:3000/${finalShortId}`,
      updatedFields: fields.map(f => f.split(' ')[0])
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
}

/* ── DELETE /delete/:shortId ─────────────────────────────────── */

async function deleteUrl(req, res) {
  const { shortId } = req.params;

  try {
    const result = await pool.query('SELECT short_id FROM urls WHERE short_id=$1', [shortId]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Short URL not found' });

    await pool.query('DELETE FROM click_events WHERE short_id=$1', [shortId]);
    await pool.query('DELETE FROM urls WHERE short_id=$1', [shortId]);
    await redisClient.del(shortId);

    res.json({ message: `Short URL '${shortId}' deleted successfully` });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
}

/* ── POST /shorten/bulk ──────────────────────────────────────── */

async function bulkCreate(req, res) {
  const { links } = req.body;

  if (!Array.isArray(links) || links.length === 0)
    return res.status(400).json({ error: 'links array is required' });
  if (links.length > 50)
    return res.status(400).json({ error: 'Maximum 50 links per bulk request' });

  const results = [], errors = [];

  await Promise.all(links.map(async (item, index) => {
    const { url, customAlias, password, clickLimit, oneTime, ...expiryOpts } = item;

    if (!url) { errors.push({ index, error: 'URL is required' }); return; }

    const shortId        = customAlias || nanoid(6);
    const ttlSeconds     = parseTTL(expiryOpts);
    const expiresAt      = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
    const hashedPassword = password   ? await bcrypt.hash(password, 10)          : null;

    try {
      const existing = await pool.query('SELECT short_id FROM urls WHERE short_id=$1', [shortId]);
      if (existing.rows.length > 0) {
        errors.push({ index, url, error: `Alias '${shortId}' already taken` });
        return;
      }

      await pool.query(
        `INSERT INTO urls (short_id, original_url, expires_at, password, click_limit, one_time)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [shortId, url, expiresAt, hashedPassword, clickLimit || null, oneTime || false]
      );

      const shortUrl = `http://localhost:3000/${shortId}`;
      const qrCode   = await QRCode.toDataURL(shortUrl);

      if (!hashedPassword) await cacheUrl(shortId, url, ttlSeconds);

      results.push({ index, shortId, shortUrl, qrCode, originalUrl: url,
                     expiresAt, clickLimit: clickLimit || null,
                     oneTime: oneTime || false, passwordProtected: !!password });

    } catch (err) {
      console.error(`Bulk error at index ${index}:`, err.message);
      errors.push({ index, url, error: 'Database error' });
    }
  }));

  res.status(errors.length && !results.length ? 400 : 207).json({
    total: links.length, succeeded: results.length, failed: errors.length, results, errors
  });
}

module.exports = { createShortUrl, redirectUrl, previewUrl, editUrl, deleteUrl, bulkCreate };
