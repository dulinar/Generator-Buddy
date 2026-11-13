const config = require('./config');
const logger = require('./logger');
const { pool, testConnection, closePool } = require('./db');
const { createMqttClient, disconnectMqttClient } = require('./mqttClient');
const { handleIncomingReading, checkOfflineGenerators } = require('./readingsHandler');

logger.info(`Starting ${config.app.name}...`);
logger.info(`MQTT Broker : ${config.mqtt.brokerUrl}`);
logger.info(`Database    : ${config.db.database} at ${config.db.host}:${config.db.port}`);

async function main() {
  // 1. Test database connection
  await testConnection();

  // 2. Start MQTT client and message subscriber
  const mqttClient = createMqttClient(async (topic, message) => {
    await handleIncomingReading(pool, topic, message);
  });

  // 3. Start background monitor to mark inactive generators as offline
  const offlineTimeoutSec = config.generator.offlineTimeoutSeconds || 60;
  const checkIntervalMs = (config.generator.offlineCheckIntervalSeconds || 15) * 1000;
  logger.info(`Offline Monitor: Active (threshold: ${offlineTimeoutSec}s, interval: ${checkIntervalMs / 1000}s)`);

  const offlineTimer = setInterval(async () => {
    await checkOfflineGenerators(pool, offlineTimeoutSec);
  }, checkIntervalMs);

  // 4. Graceful shutdown handling
  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    logger.info(`Received ${signal}. Stopping sync service...`);
    clearInterval(offlineTimer);
    await disconnectMqttClient(mqttClient);
    await closePool();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error(`Startup error: ${err.message}`, err);
  process.exit(1);
});
