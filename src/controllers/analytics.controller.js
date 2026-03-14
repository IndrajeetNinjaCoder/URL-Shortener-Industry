const { pool } = require('../config/db');

async function getAnalytics(req, res) {
  const { shortId } = req.params;

  try {
    /* ── Ownership check ── */
    const link = await pool.query('SELECT user_id FROM urls WHERE short_id=$1', [shortId]);

    if (link.rows.length === 0)
      return res.status(404).json({ error: 'Short URL not found' });

    if (link.rows[0].user_id !== req.user.id)
      return res.status(403).json({ error: 'You do not have permission to view analytics for this link' });

    /* ── Run all analytics queries in parallel ── */
    const [clicks, countries, devices, browsers] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM click_events WHERE short_id=$1', [shortId]),
      pool.query('SELECT country, COUNT(*) FROM click_events WHERE short_id=$1 GROUP BY country', [shortId]),
      pool.query('SELECT device,  COUNT(*) FROM click_events WHERE short_id=$1 GROUP BY device',  [shortId]),
      pool.query('SELECT browser, COUNT(*) FROM click_events WHERE short_id=$1 GROUP BY browser', [shortId])
    ]);

    res.json({
      shortId,
      totalClicks: clicks.rows[0].count,
      countries:   countries.rows,
      devices:     devices.rows,
      browsers:    browsers.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
}






// const { pool } = require('../config/db');

// async function getAnalytics(req, res) {
//   const { shortId } = req.params;

//   try {
//     const [clicks, countries, devices, browsers] = await Promise.all([
//       pool.query('SELECT COUNT(*) FROM click_events WHERE short_id=$1', [shortId]),
//       pool.query('SELECT country, COUNT(*) FROM click_events WHERE short_id=$1 GROUP BY country', [shortId]),
//       pool.query('SELECT device,  COUNT(*) FROM click_events WHERE short_id=$1 GROUP BY device',  [shortId]),
//       pool.query('SELECT browser, COUNT(*) FROM click_events WHERE short_id=$1 GROUP BY browser', [shortId])
//     ]);

//     res.json({
//       shortId,
//       totalClicks: clicks.rows[0].count,
//       countries:   countries.rows,
//       devices:     devices.rows,
//       browsers:    browsers.rows
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Database error' });
//   }
// }

module.exports = { getAnalytics };



