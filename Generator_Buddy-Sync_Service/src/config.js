const fs = require('fs');
const path = require('path');

/**
 * Industry-standard properties file parser
 * Parses Java/Spring-style application.properties files
 * Supports comments (#, !), trims whitespace, and parses booleans and numbers.
 */
function parsePropertiesFile(filePath) {
  const properties = {};
  if (!fs.existsSync(filePath)) {
    return properties;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Skip empty lines and comments
    if (!line || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }

    const delimiterIdx = line.search(/[:=]/);
    if (delimiterIdx === -1) {
      continue;
    }

    const key = line.substring(0, delimiterIdx).trim();
    const rawVal = line.substring(delimiterIdx + 1).trim();

    // Type coercion for boolean, number, or string
    let parsedVal = rawVal;
    if (rawVal.toLowerCase() === 'true') {
      parsedVal = true;
    } else if (rawVal.toLowerCase() === 'false') {
      parsedVal = false;
    } else if (/^-?\d+(\.\d+)?$/.test(rawVal) && !isNaN(Number(rawVal))) {
      parsedVal = Number(rawVal);
    }

    properties[key] = parsedVal;
  }

  return properties;
}

// 1. Load application.properties
const propertiesPath = path.resolve(process.cwd(), 'application.properties');
const props = parsePropertiesFile(propertiesPath);

// 2. Allow environment variable overrides (12-Factor App principle)
function getProp(propKey, envKey, fallback) {
  if (process.env[envKey] !== undefined && process.env[envKey] !== '') {
    const envVal = process.env[envKey];
    if (envVal.toLowerCase() === 'true') return true;
    if (envVal.toLowerCase() === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(envVal) && !isNaN(Number(envVal))) return Number(envVal);
    return envVal;
  }
  if (props[propKey] !== undefined && props[propKey] !== '') {
    return props[propKey];
  }
  return fallback;
}

const config = {
  app: {
    name: getProp('app.name', 'APP_NAME', 'generator-sync-service'),
    env: getProp('app.env', 'NODE_ENV', 'production'),
    logLevel: getProp('app.log.level', 'LOG_LEVEL', 'INFO')
  },
  mqtt: {
    brokerUrl: getProp('mqtt.broker.url', 'MQTT_BROKER_URL', 'mqtt://localhost:1883'),
    host: getProp('mqtt.host', 'MQTT_HOST', 'localhost'),
    port: getProp('mqtt.port', 'MQTT_PORT', 1883),
    clientId: getProp('mqtt.client.id', 'MQTT_CLIENT_ID', 'generator_mysql_sync_service'),
    username: getProp('mqtt.username', 'MQTT_USERNAME', ''),
    password: getProp('mqtt.password', 'MQTT_PASSWORD', ''),
    topic: getProp('mqtt.topic', 'MQTT_TOPIC', 'generator/+/readings'),
    qos: getProp('mqtt.qos', 'MQTT_QOS', 1),
    reconnectPeriodMs: getProp('mqtt.reconnect.period.ms', 'MQTT_RECONNECT_PERIOD_MS', 5000),
    connectTimeoutMs: getProp('mqtt.connect.timeout.ms', 'MQTT_CONNECT_TIMEOUT_MS', 30000)
  },
  db: {
    host: getProp('db.host', 'DB_HOST', 'localhost'),
    port: getProp('db.port', 'DB_PORT', 3306),
    user: getProp('db.user', 'DB_USER', 'root'),
    password: getProp('db.password', 'DB_PASSWORD', ''),
    database: getProp('db.name', 'DB_NAME', 'generator_monitoring'),
    connectionLimit: getProp('db.pool.connection.limit', 'DB_CONNECTION_LIMIT', 10),
    queueLimit: getProp('db.pool.queue.limit', 'DB_QUEUE_LIMIT', 0),
    waitForConnections: getProp('db.pool.wait.for.connections', 'DB_WAIT_FOR_CONNECTIONS', true),
    enableKeepAlive: getProp('db.pool.enable.keep.alive', 'DB_ENABLE_KEEP_ALIVE', true),
    keepAliveInitialDelay: getProp('db.pool.keep.alive.initial.delay', 'DB_KEEP_ALIVE_INITIAL_DELAY', 10000)
  },
  generator: {
    offlineTimeoutSeconds: getProp('generator.offline.timeout.seconds', 'GENERATOR_OFFLINE_TIMEOUT_SECONDS', 60),
    offlineCheckIntervalSeconds: getProp('generator.offline.check.interval.seconds', 'GENERATOR_OFFLINE_CHECK_INTERVAL_SECONDS', 15)
  }
};

module.exports = Object.freeze(config);
