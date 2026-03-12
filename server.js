require('dotenv').config();
const app = require('./src/app');
const { pool } = require('./src/config/db');
const { redisClient } = require('./src/config/redis');


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGINT', async () => {
  await pool.end();
  await redisClient.quit();
  process.exit();
});
