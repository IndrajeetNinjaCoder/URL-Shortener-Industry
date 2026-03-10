const express = require('express');
const { nanoid } = require('nanoid');
const { Client } = require('pg');
const { createClient } = require('redis');
const geoip = require('geoip-lite');
const UAParser = require('ua-parser-js');

const app = express();
app.use(express.json());

/* PostgreSQL Client */
const client = new Client({
  connectionString:
    "postgresql://neondb_owner:npg_IoF81ULAxrSf@ep-young-wave-ady3pltq-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  ssl: {
    rejectUnauthorized: false
  }
});

/* Redis Client */
const redisClient = createClient();

redisClient.on('error', (err) => console.error('Redis Error', err));

async function initRedis() {
  await redisClient.connect();
  console.log("Connected to Redis");
}

/* Connect Database */
client.connect()
  .then(() => console.log("Connected to PostgreSQL"))
  .catch(err => console.error("Connection error", err));

initRedis();

/* Create Short URL */
app.post('/shorten', async (req, res) => {

  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const shortId = nanoid(6);

  try {

    await client.query(
      'INSERT INTO urls (short_id, original_url) VALUES ($1, $2)',
      [shortId, url]
    );

    /* Cache in Redis immediately */
    await redisClient.set(shortId, url);

    res.json({
      shortUrl: `http://localhost:3000/${shortId}`
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: 'Database error' });

  }

});


/* Redirect Short URL + Redis Cache + Analytics */
app.get('/:shortId', async (req, res) => {

  const { shortId } = req.params;

  try {

    /* 1️⃣ Check Redis first */
    let originalUrl = await redisClient.get(shortId);

    /* 2️⃣ If not found in Redis → fetch from DB */
    if (!originalUrl) {

      const result = await client.query(
        'SELECT original_url FROM urls WHERE short_id = $1',
        [shortId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Short URL not found' });
      }

      originalUrl = result.rows[0].original_url;

      /* Save to Redis for future requests */
      await redisClient.set(shortId, originalUrl);

    }

    /* 3️⃣ Analytics Data */
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];

    const geo = geoip.lookup(ip);
    const country = geo ? geo.country : "Unknown";

    const parser = new UAParser(userAgent);
    const device = parser.getDevice().type || "desktop";
    const browser = parser.getBrowser().name || "Unknown";

    /* Store analytics */
    await client.query(
      `INSERT INTO click_events 
      (short_id, ip_address, user_agent, country, device, browser)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [shortId, ip, userAgent, country, device, browser]
    );

    res.redirect(originalUrl);

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: 'Database error' });

  }

});


/* Analytics API */
app.get('/analytics/:shortId', async (req, res) => {

  const { shortId } = req.params;

  try {

    const clicks = await client.query(
      'SELECT COUNT(*) FROM click_events WHERE short_id=$1',
      [shortId]
    );

    const countries = await client.query(
      `SELECT country, COUNT(*) 
       FROM click_events 
       WHERE short_id=$1 
       GROUP BY country`,
      [shortId]
    );

    const devices = await client.query(
      `SELECT device, COUNT(*) 
       FROM click_events 
       WHERE short_id=$1 
       GROUP BY device`,
      [shortId]
    );

    const browsers = await client.query(
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
    res.status(500).json({ error: 'Database error' });

  }

});


const PORT = process.env.PORT || 3000;

/* Start Server */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


/* Graceful Shutdown */
process.on('SIGINT', async () => {

  await client.end();
  await redisClient.quit();
  process.exit();

});









// const express = require('express');
// const { nanoid } = require('nanoid');
// const { Client } = require('pg');

// const app = express();
// app.use(express.json());

// /* PostgreSQL Client */
// const client = new Client({
//   connectionString:
//     "postgresql://neondb_owner:npg_IoF81ULAxrSf@ep-young-wave-ady3pltq-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
//   ssl: {
//     rejectUnauthorized: false
//   }
// });

// /* Connect Database */
// client.connect()
//   .then(() => console.log("Connected to Neon PostgreSQL"))
//   .catch(err => console.error("Connection error", err));

// /* Create Short URL */
// app.post('/shorten', async (req, res) => {
//   const { url } = req.body;

//   if (!url) {
//     return res.status(400).json({ error: 'URL is required' });
//   }

//   const shortId = nanoid(6);

//   try {
//     await client.query(
//       'INSERT INTO urls (short_id, original_url) VALUES ($1, $2)',
//       [shortId, url]
//     );

//     res.json({
//       shortUrl: `http://localhost:3000/${shortId}`
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Database error' });
//   }
// });

// /* Redirect Short URL + Track Analytics */
// app.get('/:shortId', async (req, res) => {
//   const { shortId } = req.params;

//   try {
//     const result = await client.query(
//       'SELECT original_url FROM urls WHERE short_id = $1',
//       [shortId]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ error: 'Short URL not found' });
//     }

//     const originalUrl = result.rows[0].original_url;

//     /* Track click analytics */
//     const ip = req.ip;
//     const userAgent = req.headers['user-agent'];

//     await client.query(
//       'INSERT INTO click_events (short_id, ip_address, user_agent) VALUES ($1, $2, $3)',
//       [shortId, ip, userAgent]
//     );

//     res.redirect(originalUrl);

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Database error' });
//   }
// });

// /* Analytics API */
// app.get('/analytics/:shortId', async (req, res) => {
//   const { shortId } = req.params;

//   try {
//     const result = await client.query(
//       'SELECT COUNT(*) FROM click_events WHERE short_id=$1',
//       [shortId]
//     );

//     res.json({
//       shortId,
//       totalClicks: result.rows[0].count
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Database error' });
//   }
// });

// const PORT = process.env.PORT || 3000;

// /* Start Server */
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });

// /* Graceful Shutdown */
// process.on('SIGINT', async () => {
//   await client.end();
//   process.exit();
// });








// const express = require('express');
// const { nanoid } = require('nanoid');
// const { Client } = require('pg');

// const app = express();
// app.use(express.json());

// /* PostgreSQL Client */
// const client = new Client({
//   connectionString: "postgresql://neondb_owner:npg_IoF81ULAxrSf@ep-young-wave-ady3pltq-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
//   ssl: {
//     rejectUnauthorized: false
//   }
// });

// /* Connect Database */
// client.connect()
//   .then(() => console.log("Connected to Neon PostgreSQL"))
//   .catch(err => console.error("Connection error", err));

// /* Create Short URL */
// app.post('/shorten', async (req, res) => {
//   const { url } = req.body;

//   if (!url) {
//     return res.status(400).json({ error: 'URL is required' });
//   }

//   const shortId = nanoid(6);

//   try {
//     await client.query(
//       'INSERT INTO urls (short_id, original_url) VALUES ($1, $2)',
//       [shortId, url]
//     );

//     res.json({
//       shortUrl: `http://localhost:3000/${shortId}`
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Database error' });
//   }
// });

// /* Redirect Short URL */
// app.get('/:shortId', async (req, res) => {
//   const { shortId } = req.params;

//   try {
//     const result = await client.query(
//       'SELECT original_url FROM urls WHERE short_id = $1',
//       [shortId]
//     );

//     if (result.rows.length > 0) {
//       res.redirect(result.rows[0].original_url);
//     } else {
//       res.status(404).json({ error: 'Short URL not found' });
//     }

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Database error' });
//   }
// });

// const PORT = 3000;

// /* Start Server */
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });

// /* Graceful Shutdown */
// process.on('SIGINT', async () => {
//   await client.end();
//   process.exit();
// });









// const express = require('express');
// const { nanoid } = require('nanoid');
// const { Client } = require('pg');

// const app = express();
// app.use(express.json());

// const client = new Client({
//   connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/url_shortener'
// });

// client.connect((err) => {
//   if (err) {
//     console.error('Connection error', err.stack);
//   } else {
//     console.log('Connected to database');
//   }
// });

// app.post('/shorten', async (req, res) => {
//   const { url } = req.body;
//   if (!url) {
//     return res.status(400).json({ error: 'URL is required' });
//   }
//   const shortId = nanoid(6);
//   try {
//     await client.query('INSERT INTO urls (short_id, original_url) VALUES ($1, $2)', [shortId, url]);
//     res.json({ shortUrl: `http://localhost:3000/${shortId}` });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Database error' });
//   }
// });

// app.get('/:shortId', async (req, res) => {
//   const { shortId } = req.params;
//   try {
//     const result = await client.query('SELECT original_url FROM urls WHERE short_id = $1', [shortId]);
//     if (result.rows.length > 0) {
//       res.redirect(result.rows[0].original_url);
//     } else {
//       res.status(404).json({ error: 'Short URL not found' });
//     }
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Database error' });
//   }
// });

// const PORT = 3000;
// app.listen(PORT, () => {``
//   console.log(`Server running on port ${PORT}`);
// });

// process.on('SIGINT', async () => {
//   await client.end();
//   process.exit();
// });