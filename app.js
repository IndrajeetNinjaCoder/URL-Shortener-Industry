const express = require('express');
const { nanoid } = require('nanoid');
const { Pool } = require('pg');
const { createClient } = require('redis');
const geoip = require('geoip-lite');
const UAParser = require('ua-parser-js');
const rateLimit = require('express-rate-limit');
const bcrypt = require("bcrypt");
const QRCode = require("qrcode");

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



// app.post('/shorten', async (req, res) => {

//   const { url, expiryType, expiresInHours, expiresInDays, password, clickLimit, oneTime } = req.body;

//   if (!url) {
//     return res.status(400).json({ error: "URL is required" });
//   }

//   const shortId = nanoid(6);

//   let expiresAt = null;
//   let ttlSeconds = null;
//   let hashedPassword = null;

//   if (expiryType === "1h") ttlSeconds = 3600;
//   else if (expiryType === "24h") ttlSeconds = 86400;
//   else if (expiryType === "7d") ttlSeconds = 604800;
//   else if (expiresInHours) ttlSeconds = expiresInHours * 3600;
//   else if (expiresInDays) ttlSeconds = expiresInDays * 86400;

//   if (ttlSeconds) {
//     expiresAt = new Date(Date.now() + ttlSeconds * 1000);
//   }

//   if (password) {
//     hashedPassword = await bcrypt.hash(password, 10);
//   }

//   try {

//     await pool.query(
//       `INSERT INTO urls 
//       (short_id, original_url, expires_at, password, click_limit, one_time)
//       VALUES ($1,$2,$3,$4,$5,$6)`,
//       [shortId, url, expiresAt, hashedPassword, clickLimit || null, oneTime || false]
//     );

//     /* QR Code generation */
//     const shortUrl = `http://localhost:3000/${shortId}`;
//     const qrCode = await QRCode.toDataURL(shortUrl);

//     /* Cache only if not password protected */
//     if (!hashedPassword) {
//       if (ttlSeconds) {
//         await redisClient.set(shortId, url, { EX: ttlSeconds });
//       } else {
//         await redisClient.set(shortId, url);
//       }
//     }

//     res.json({
//       shortUrl,
//       qrCode,
//       expiresAt,
//       clickLimit: clickLimit || null,
//       oneTime: oneTime || false,
//       passwordProtected: !!password
//     });

//   } catch (err) {

//     console.error(err);
//     res.status(500).json({ error: "Database error" });

//   }

// });


// app.post('/shorten', async (req, res) => {

//   const { url, expiryType, expiresInHours, expiresInDays, password } = req.body;

//   if (!url) {
//     return res.status(400).json({ error: "URL is required" });
//   }

//   const shortId = nanoid(6);

//   let expiresAt = null;
//   let ttlSeconds = null;
//   let hashedPassword = null;

//   if (expiryType === "1h") ttlSeconds = 3600;
//   else if (expiryType === "24h") ttlSeconds = 86400;
//   else if (expiryType === "7d") ttlSeconds = 604800;
//   else if (expiresInHours) ttlSeconds = expiresInHours * 3600;
//   else if (expiresInDays) ttlSeconds = expiresInDays * 86400;

//   if (ttlSeconds) {
//     expiresAt = new Date(Date.now() + ttlSeconds * 1000);
//   }

//   /* Hash password if provided */
//   if (password) {
//     hashedPassword = await bcrypt.hash(password, 10);
//   }

//   try {

//     await pool.query(
//       "INSERT INTO urls (short_id, original_url, expires_at, password) VALUES ($1,$2,$3,$4)",
//       [shortId, url, expiresAt, hashedPassword]
//     );

//     /* Only cache in Redis if the link is NOT password protected */
//     if (!hashedPassword) {
//       if (ttlSeconds) {
//         await redisClient.set(shortId, url, { EX: ttlSeconds });
//       } else {
//         await redisClient.set(shortId, url);
//       }
//     }

//     res.json({
//       shortUrl: `http://localhost:3000/${shortId}`,
//       expiresAt,
//       passwordProtected: !!password
//     });

//   } catch (err) {

//     console.error(err);
//     res.status(500).json({ error: "Database error" });

//   }

// });





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







// app.get('/:shortId', async (req, res) => {

//   const { shortId } = req.params;

//   try {

//     /* First check Redis — only non-password-protected links are ever cached */
//     let cachedUrl = await redisClient.get(shortId);

//     if (cachedUrl) {

//       /* Safe to redirect: password-protected links are never stored in Redis */
//       const ip = req.ip;
//       const userAgent = req.headers['user-agent'];
//       const geo = geoip.lookup(ip);
//       const country = geo ? geo.country : "Unknown";
//       const parser = new UAParser(userAgent);
//       const device = parser.getDevice().type || "desktop";
//       const browser = parser.getBrowser().name || "Unknown";

//       await pool.query(
//         `INSERT INTO click_events (short_id, ip_address, user_agent, country, device, browser) VALUES ($1,$2,$3,$4,$5,$6)`,
//         [shortId, ip, userAgent, country, device, browser]
//       );

//       return res.redirect(cachedUrl);

//     }

//     /* Fetch from database */
//     const result = await pool.query(
//       "SELECT original_url, expires_at, password, click_limit, one_time FROM urls WHERE short_id=$1",
//       [shortId]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ error: "Short URL not found" });
//     }

//     const originalUrl = result.rows[0].original_url;
//     const expiresAt = result.rows[0].expires_at;
//     const storedPassword = result.rows[0].password;

//     /* Expiry check */
//     if (expiresAt && new Date() > expiresAt) {
//       return res.status(410).json({ error: "Link has expired" });
//     }

//     /* Password protection */
//     if (storedPassword) {

//       const userPassword = req.query.password;

//       if (!userPassword) {
//         return res.status(401).json({
//           message: "Password required to access this link"
//         });
//       }

//       const valid = await bcrypt.compare(userPassword, storedPassword);

//       if (!valid) {
//         return res.status(403).json({
//           error: "Incorrect password"
//         });
//       }

//     } else {
//       /* Cache ONLY if link is NOT password protected */
//       await redisClient.set(shortId, originalUrl);
//     }

//     /* Analytics */

//     const ip = req.ip;
//     const userAgent = req.headers['user-agent'];

//     const geo = geoip.lookup(ip);
//     const country = geo ? geo.country : "Unknown";

//     const parser = new UAParser(userAgent);
//     const device = parser.getDevice().type || "desktop";
//     const browser = parser.getBrowser().name || "Unknown";

//     await pool.query(
//       `INSERT INTO click_events
//        (short_id, ip_address, user_agent, country, device, browser)
//        VALUES ($1,$2,$3,$4,$5,$6)`,
//       [shortId, ip, userAgent, country, device, browser]
//     );

//     res.redirect(originalUrl);

//   } catch (err) {

//     console.error(err);
//     res.status(500).json({ error: "Database error" });

//   }

// });




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


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


process.on("SIGINT", async () => {

  await pool.end();
  await redisClient.quit();
  process.exit();

});
