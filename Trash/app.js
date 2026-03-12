const express = require('express');
const { nanoid } = require('nanoid');
const { Pool } = require('pg');
const { createClient } = require('redis');
const geoip = require('geoip-lite');
const UAParser = require('ua-parser-js');
const rateLimit = require('express-rate-limit');
const bcrypt = require("bcrypt");
const QRCode = require("qrcode");

const sharp = require('sharp');
const axios = require('axios');

const app = express();
app.use(express.json());

/* Rate Limiting */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP. Try again later."
});

app.use(limiter);

/* PostgreSQL Pool (FIXED) */
const pool = new Pool({
  connectionString:
    "postgresql://neondb_owner:npg_IoF81ULAxrSf@ep-young-wave-ady3pltq-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on("connect", () => {
  console.log("Connected to PostgreSQL");
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error", err);
});

/* Redis Client */
const redisClient = createClient({
  url: "rediss://default:gQAAAAAAAQZFAAIncDE3YzFiNWU5ZDI1Mzk0MTMwYjk4MDQwN2Y1YTlkMzVmOHAxNjcxNDE@teaching-filly-67141.upstash.io:6379"
});

redisClient.on("error", (err) => console.error("Redis Error", err));

async function initRedis() {
  await redisClient.connect();
  console.log("Connected to Redis");
}

initRedis();


app.post('/shorten', async (req, res) => {

  const { 
    url,
    expiryType,
    expiresInHours,
    expiresInDays,
    password,
    clickLimit,
    oneTime,
    customAlias
  } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }



  /* Use custom alias if provided */
  const shortId = customAlias || nanoid(6);

  let expiresAt = null;
  let ttlSeconds = null;
  let hashedPassword = null;

  if (expiryType === "1h") ttlSeconds = 3600;
  else if (expiryType === "24h") ttlSeconds = 86400;
  else if (expiryType === "7d") ttlSeconds = 604800;
  else if (expiresInHours) ttlSeconds = expiresInHours * 3600;
  else if (expiresInDays) ttlSeconds = expiresInDays * 86400;

  if (ttlSeconds) {
    expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  }

  if (password) {
    hashedPassword = await bcrypt.hash(password, 10);
  }

  try {

    /* Check if custom alias already exists */
    const existing = await pool.query(
      "SELECT short_id FROM urls WHERE short_id=$1",
      [shortId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        error: "Custom alias already taken"
      });
    }

    await pool.query(
      `INSERT INTO urls 
      (short_id, original_url, expires_at, password, click_limit, one_time)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [shortId, url, expiresAt, hashedPassword, clickLimit || null, oneTime || false]
    );

    const shortUrl = `http://localhost:3000/${shortId}`;

    /* Generate QR code */
    const qrCode = await QRCode.toDataURL(shortUrl);

    /* Cache only if not password protected */
    if (!hashedPassword) {

      if (ttlSeconds) {
        await redisClient.set(shortId, url, { EX: ttlSeconds });
      } else {
        await redisClient.set(shortId, url);
      }

    }

    res.json({
      shortUrl,
      qrCode,
      expiresAt,
      clickLimit,
      oneTime,
      customAlias: customAlias || null,
      passwordProtected: !!password
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "Database error" });

  }

});



app.get('/:shortId', async (req, res) => {

  const { shortId } = req.params;

  try {

    /* Check Redis cache first (only non-password links are cached) */
    let cachedUrl = await redisClient.get(shortId);

    if (cachedUrl) {

      const ip = req.ip;
      const userAgent = req.headers['user-agent'];

      const geo = geoip.lookup(ip);
      const country = geo ? geo.country : "Unknown";

      const parser = new UAParser(userAgent);
      const device = parser.getDevice().type || "desktop";
      const browser = parser.getBrowser().name || "Unknown";

      await pool.query(
        `INSERT INTO click_events 
        (short_id, ip_address, user_agent, country, device, browser)
        VALUES ($1,$2,$3,$4,$5,$6)`,
        [shortId, ip, userAgent, country, device, browser]
      );

      return res.redirect(cachedUrl);
    }

    /* Fetch link data from database */
    const result = await pool.query(
      `SELECT original_url, expires_at, password, click_limit, one_time 
       FROM urls 
       WHERE short_id=$1`,
      [shortId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Short URL not found" });
    }

    const {
      original_url: originalUrl,
      expires_at: expiresAt,
      password: storedPassword,
      click_limit: clickLimit,
      one_time: oneTime
    } = result.rows[0];

    /* Expiry check */
    if (expiresAt && new Date() > expiresAt) {
      return res.status(410).json({ error: "Link has expired" });
    }

    /* Password protection */
    if (storedPassword) {

      const userPassword = req.query.password;

      if (!userPassword) {
        return res.status(401).json({
          message: "Password required to access this link"
        });
      }

      const valid = await bcrypt.compare(userPassword, storedPassword);

      if (!valid) {
        return res.status(403).json({
          error: "Incorrect password"
        });
      }

    }

    /* Click limit check */
    if (clickLimit) {

      const clickCount = await pool.query(
        "SELECT COUNT(*) FROM click_events WHERE short_id=$1",
        [shortId]
      );

      if (parseInt(clickCount.rows[0].count) >= clickLimit) {
        return res.status(410).json({
          error: "Click limit reached"
        });
      }

    }

    /* One-time link check */
    if (oneTime) {

      const clickCount = await pool.query(
        "SELECT COUNT(*) FROM click_events WHERE short_id=$1",
        [shortId]
      );

      if (parseInt(clickCount.rows[0].count) >= 1) {
        return res.status(410).json({
          error: "This was a one-time link and has already been used"
        });
      }

    }

    /* Cache only if NOT password protected */
    if (!storedPassword) {
      await redisClient.set(shortId, originalUrl);
    }

    /* Analytics logging */

    const ip = req.ip;
    const userAgent = req.headers['user-agent'];

    const geo = geoip.lookup(ip);
    const country = geo ? geo.country : "Unknown";

    const parser = new UAParser(userAgent);
    const device = parser.getDevice().type || "desktop";
    const browser = parser.getBrowser().name || "Unknown";

    await pool.query(
      `INSERT INTO click_events
       (short_id, ip_address, user_agent, country, device, browser)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [shortId, ip, userAgent, country, device, browser]
    );

    return res.redirect(originalUrl);

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "Database error" });

  }

});








/* Analytics API */
app.get('/analytics/:shortId', async (req, res) => {

  const { shortId } = req.params;

  try {

    const clicks = await pool.query(
      "SELECT COUNT(*) FROM click_events WHERE short_id=$1",
      [shortId]
    );

    const countries = await pool.query(
      `SELECT country, COUNT(*)
       FROM click_events
       WHERE short_id=$1
       GROUP BY country`,
      [shortId]
    );

    const devices = await pool.query(
      `SELECT device, COUNT(*)
       FROM click_events
       WHERE short_id=$1
       GROUP BY device`,
      [shortId]
    );

    const browsers = await pool.query(
      `SELECT browser, COUNT(*)
       FROM click_events
       WHERE short_id=$1
       GROUP BY browser`,
      [shortId]
    );

    res.json({
      shortId,
      totalClicks: clicks.rows[0].count,
      countries: countries.rows,
      devices: devices.rows,
      browsers: browsers.rows
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "Database error" });

  }

});




/* ─────────────────────────────────────────
   1. LINK PREVIEW  GET /preview/:shortId
   Returns metadata (title, description, image) of the original URL
───────────────────────────────────────── */
app.get('/preview/:shortId', async (req, res) => {
  const { shortId } = req.params;

  try {
    const result = await pool.query(
      `SELECT original_url, expires_at, click_limit, one_time, created_at
       FROM urls WHERE short_id = $1`,
      [shortId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Short URL not found' });

    const { original_url, expires_at, click_limit, one_time, created_at } = result.rows[0];

    /* Fetch OG metadata from the original URL */
    let meta = { title: null, description: null, image: null };
    try {
      const response = await axios.get(original_url, {
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)' }
      });

      const html = response.data;

      const titleMatch     = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
                          || html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const descMatch      = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
                          || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      const imageMatch     = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);

      if (titleMatch)   meta.title       = titleMatch[1].trim();
      if (descMatch)    meta.description = descMatch[1].trim();
      if (imageMatch)   meta.image       = imageMatch[1].trim();
    } catch (_) {
      /* Metadata fetch is best-effort — don't fail the whole request */
    }

    /* Click count */
    const clickCount = await pool.query(
      'SELECT COUNT(*) FROM click_events WHERE short_id = $1',
      [shortId]
    );

    res.json({
      shortId,
      shortUrl:    `http://localhost:3000/${shortId}`,
      originalUrl: original_url,
      createdAt:   created_at,
      expiresAt:   expires_at,
      clickLimit:  click_limit,
      oneTime:     one_time,
      totalClicks: parseInt(clickCount.rows[0].count),
      preview: meta
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});


/* ─────────────────────────────────────────
   2. LINK EDITING  PUT /edit/:shortId
   Editable fields: original_url, expires_at, click_limit, one_time, password, customAlias
───────────────────────────────────────── */
app.put('/edit/:shortId', async (req, res) => {
  const { shortId } = req.params;
  const {
    url,
    expiryType,
    expiresInHours,
    expiresInDays,
    password,
    clickLimit,
    oneTime,
    newAlias
  } = req.body;

  try {
    /* Confirm the link exists */
    const existing = await pool.query(
      'SELECT * FROM urls WHERE short_id = $1',
      [shortId]
    );

    if (existing.rows.length === 0)
      return res.status(404).json({ error: 'Short URL not found' });

    /* Build update fields dynamically */
    const fields = [];
    const values = [];
    let idx = 1;

    if (url) {
      fields.push(`original_url = $${idx++}`);
      values.push(url);
    }

    /* Expiry */
    let ttlSeconds = null;
    if (expiryType === '1h')       ttlSeconds = 3600;
    else if (expiryType === '24h') ttlSeconds = 86400;
    else if (expiryType === '7d')  ttlSeconds = 604800;
    else if (expiresInHours)       ttlSeconds = expiresInHours * 3600;
    else if (expiresInDays)        ttlSeconds = expiresInDays  * 86400;

    if (ttlSeconds !== null) {
      fields.push(`expires_at = $${idx++}`);
      values.push(new Date(Date.now() + ttlSeconds * 1000));
    }

    /* Password */
    if (password !== undefined) {
      const hashed = password ? await bcrypt.hash(password, 10) : null;
      fields.push(`password = $${idx++}`);
      values.push(hashed);
    }

    if (clickLimit !== undefined) {
      fields.push(`click_limit = $${idx++}`);
      values.push(clickLimit || null);
    }

    if (oneTime !== undefined) {
      fields.push(`one_time = $${idx++}`);
      values.push(oneTime);
    }

    /* Custom alias rename */
    let finalShortId = shortId;
    if (newAlias && newAlias !== shortId) {
      const aliasCheck = await pool.query(
        'SELECT short_id FROM urls WHERE short_id = $1',
        [newAlias]
      );
      if (aliasCheck.rows.length > 0)
        return res.status(400).json({ error: 'New alias already taken' });

      fields.push(`short_id = $${idx++}`);
      values.push(newAlias);
      finalShortId = newAlias;
    }

    if (fields.length === 0)
      return res.status(400).json({ error: 'No fields to update' });

    values.push(shortId); // WHERE clause value
    await pool.query(
      `UPDATE urls SET ${fields.join(', ')} WHERE short_id = $${idx}`,
      values
    );

    /* Invalidate old Redis cache */
    await redisClient.del(shortId);

    /* Re-cache under new alias if not password-protected */
    const updated = await pool.query(
      'SELECT * FROM urls WHERE short_id = $1',
      [finalShortId]
    );
    const row = updated.rows[0];

    if (!row.password) {
      const newTtl = row.expires_at
        ? Math.floor((new Date(row.expires_at) - Date.now()) / 1000)
        : null;

      if (newTtl && newTtl > 0) {
        await redisClient.set(finalShortId, row.original_url, { EX: newTtl });
      } else if (!row.expires_at) {
        await redisClient.set(finalShortId, row.original_url);
      }
    }

    res.json({
      message:  'Link updated successfully',
      shortId:  finalShortId,
      shortUrl: `http://localhost:3000/${finalShortId}`,
      updatedFields: fields.map(f => f.split(' ')[0])
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});


/* ─────────────────────────────────────────
   3. LINK DELETION  DELETE /delete/:shortId
───────────────────────────────────────── */
app.delete('/delete/:shortId', async (req, res) => {
  const { shortId } = req.params;

  try {
    const result = await pool.query(
      'SELECT short_id FROM urls WHERE short_id = $1',
      [shortId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Short URL not found' });

    /* Delete click events first (no FK cascade assumed) */
    await pool.query(
      'DELETE FROM click_events WHERE short_id = $1',
      [shortId]
    );

    await pool.query(
      'DELETE FROM urls WHERE short_id = $1',
      [shortId]
    );

    /* Remove from Redis */
    await redisClient.del(shortId);

    res.json({ message: `Short URL '${shortId}' deleted successfully` });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});


/* ─────────────────────────────────────────
   4. BULK LINK CREATION  POST /shorten/bulk
   Body: { links: [ { url, customAlias?, expiryType?, password?, clickLimit?, oneTime? }, ... ] }
   Max 50 links per request
───────────────────────────────────────── */
app.post('/shorten/bulk', async (req, res) => {
  const { links } = req.body;

  if (!Array.isArray(links) || links.length === 0)
    return res.status(400).json({ error: 'links array is required' });

  if (links.length > 50)
    return res.status(400).json({ error: 'Maximum 50 links per bulk request' });

  const results   = [];
  const errors    = [];

  /* Process all links in parallel */
  await Promise.all(links.map(async (item, index) => {
    const {
      url,
      customAlias,
      expiryType,
      expiresInHours,
      expiresInDays,
      password,
      clickLimit,
      oneTime
    } = item;

    if (!url) {
      errors.push({ index, error: 'URL is required' });
      return;
    }

    const shortId = customAlias || nanoid(6);

    let ttlSeconds = null;
    if (expiryType === '1h')       ttlSeconds = 3600;
    else if (expiryType === '24h') ttlSeconds = 86400;
    else if (expiryType === '7d')  ttlSeconds = 604800;
    else if (expiresInHours)       ttlSeconds = expiresInHours * 3600;
    else if (expiresInDays)        ttlSeconds = expiresInDays  * 86400;

    const expiresAt      = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
    const hashedPassword = password   ? await bcrypt.hash(password, 10)          : null;

    try {
      /* Check alias collision */
      const existing = await pool.query(
        'SELECT short_id FROM urls WHERE short_id = $1',
        [shortId]
      );

      if (existing.rows.length > 0) {
        errors.push({ index, url, error: `Alias '${shortId}' already taken` });
        return;
      }

      await pool.query(
        `INSERT INTO urls (short_id, original_url, expires_at, password, click_limit, one_time)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [shortId, url, expiresAt, hashedPassword, clickLimit || null, oneTime || false]
      );

      const shortUrl = `http://localhost:3000/${shortId}`;
      const qrCode   = await QRCode.toDataURL(shortUrl);

      /* Cache if not password protected */
      if (!hashedPassword) {
        if (ttlSeconds) {
          await redisClient.set(shortId, url, { EX: ttlSeconds });
        } else {
          await redisClient.set(shortId, url);
        }
      }

      results.push({
        index,
        shortId,
        shortUrl,
        qrCode,
        originalUrl:       url,
        expiresAt,
        clickLimit:        clickLimit  || null,
        oneTime:           oneTime     || false,
        passwordProtected: !!password
      });

    } catch (err) {
      console.error(`Bulk error at index ${index}:`, err.message);
      errors.push({ index, url, error: 'Database error' });
    }
  }));

  res.status(errors.length && !results.length ? 400 : 207).json({
    total:     links.length,
    succeeded: results.length,
    failed:    errors.length,
    results,
    errors
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


process.on("SIGINT", async () => {

  await pool.end();
  await redisClient.quit();
  process.exit();

});
