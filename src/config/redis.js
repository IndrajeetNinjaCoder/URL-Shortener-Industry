const { createClient } = require('redis');

const redisClient = createClient({ url: process.env.REDIS_URL });

redisClient.on('error', (err) => console.error('Redis Error', err));

async function initRedis() {
  await redisClient.connect();
  console.log('Connected to Redis');
}

initRedis();

module.exports = { redisClient };
