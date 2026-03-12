const geoip    = require('geoip-lite');
const UAParser = require('ua-parser-js');
const { pool } = require('../config/db');

/**
 * Convert expiry options to seconds.
 * Supports: expiryType ("1h"|"24h"|"7d"), expiresInHours, expiresInDays
 */
function parseTTL({ expiryType, expiresInHours, expiresInDays }) {
  if (expiryType === '1h')  return 3600;
  if (expiryType === '24h') return 86400;
  if (expiryType === '7d')  return 604800;
  if (expiresInHours)       return expiresInHours * 3600;
  if (expiresInDays)        return expiresInDays  * 86400;
  return null;
}

/**
 * Log a click event to the database.
 */
async function logClick(shortId, req) {
  const ip        = req.ip;
  const userAgent = req.headers['user-agent'];

  const geo     = geoip.lookup(ip);
  const country = geo ? geo.country : 'Unknown';

  const parser  = new UAParser(userAgent);
  const device  = parser.getDevice().type  || 'desktop';
  const browser = parser.getBrowser().name || 'Unknown';

  await pool.query(
    `INSERT INTO click_events (short_id, ip_address, user_agent, country, device, browser)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [shortId, ip, userAgent, country, device, browser]
  );
}

module.exports = { parseTTL, logClick };
