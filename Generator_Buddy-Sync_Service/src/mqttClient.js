const mqtt = require('mqtt');
const config = require('./config');
const logger = require('./logger');

/**
 * Initializes and connects the MQTT client to the Mosquitto broker
 * @param {Function} onMessageCallback - Callback invoked when a reading is received (topic, messageBuffer)
 * @returns {mqtt.MqttClient}
 */
function createMqttClient(onMessageCallback) {
  const mqttConf = config.mqtt;

  const connectionOptions = {
    host: mqttConf.host,
    port: mqttConf.port,
    clientId: mqttConf.clientId || `generator_sync_${Math.random().toString(16).substring(2, 8)}`,
    clean: true,
    connectTimeout: mqttConf.connectTimeoutMs || 30000,
    reconnectPeriod: mqttConf.reconnectPeriodMs || 5000
  };

  if (mqttConf.username) {
    connectionOptions.username = mqttConf.username;
  }
  if (mqttConf.password) {
    connectionOptions.password = mqttConf.password;
  }

  const clientTarget = mqttConf.brokerUrl || `mqtt://${mqttConf.host}:${mqttConf.port}`;
  logger.info(`Initiating connection to MQTT broker at ${clientTarget}...`);

  const client = mqttConf.brokerUrl 
    ? mqtt.connect(mqttConf.brokerUrl, connectionOptions) 
    : mqtt.connect(connectionOptions);

  // Event: Connected
  client.on('connect', (connack) => {
    logger.info(`[MQTT_CONNECT] Successfully connected to MQTT broker (${clientTarget})`, {
      sessionPresent: connack ? connack.sessionPresent : false
    });

    // Subscribe to the wildcard topic pattern
    client.subscribe(mqttConf.topic, { qos: mqttConf.qos }, (err, granted) => {
      if (err) {
        logger.error(`[MQTT_ERROR] Failed to subscribe to topic "${mqttConf.topic}": ${err.message}`);
      } else {
        const grantedQos = granted && granted[0] ? granted[0].qos : mqttConf.qos;
        logger.info(`Subscribed to wildcard topic pattern "${mqttConf.topic}" (QoS: ${grantedQos})`);
      }
    });
  });

  // Event: Reconnect attempt
  client.on('reconnect', () => {
    logger.info('[MQTT_RECONNECT] Attempting reconnection to MQTT broker...');
  });

  // Event: Disconnected / Closed
  client.on('close', () => {
    logger.warn('[MQTT_DISCONNECT] MQTT broker connection closed');
  });

  // Event: Client went offline
  client.on('offline', () => {
    logger.warn('[MQTT_DISCONNECT] MQTT client went offline');
  });

  // Event: Client error
  client.on('error', (err) => {
    logger.error(`[MQTT_ERROR] MQTT client error: ${err.message}`, {
      code: err.code
    });
  });

  // Event: Incoming Message
  client.on('message', async (topic, payloadBuffer) => {
    logger.info(`[MESSAGE_RECEIVED] Received message on topic: "${topic}"`);
    try {
      if (typeof onMessageCallback === 'function') {
        await onMessageCallback(topic, payloadBuffer);
      }
    } catch (unhandledErr) {
      logger.error(`Unhandled error during message processing for topic "${topic}": ${unhandledErr.message}`, {
        error: unhandledErr.stack
      });
    }
  });

  return client;
}

/**
 * Gracefully disconnects the MQTT client
 * @param {mqtt.MqttClient} client 
 * @returns {Promise<void>}
 */
function disconnectMqttClient(client) {
  return new Promise((resolve) => {
    if (!client) return resolve();
    logger.info('Disconnecting from MQTT broker...');
    client.end(false, {}, () => {
      logger.info('MQTT client disconnected.');
      resolve();
    });
  });
}

module.exports = {
  createMqttClient,
  disconnectMqttClient
};
