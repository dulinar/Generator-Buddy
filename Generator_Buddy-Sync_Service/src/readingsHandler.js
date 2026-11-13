const logger = require('./logger');

const REQUIRED_NUMERIC_FIELDS = [
  'voltage',
  'current',
  'frequency',
  'temperature',
  'fuel_level',
  'runtime_seconds'
];

const VALID_STATUSES = ['running', 'stopped', 'fault', 'maintenance'];

/**
 * Extracts and validates generator_id from topic pattern generator/{generator_id}/readings
 * Matches integer generator IDs to align with MySQL generator_id INT schema.
 * @param {string} topic 
 * @returns {number|null}
 */
function extractGeneratorId(topic) {
  if (!topic || typeof topic !== 'string') return null;
  const match = topic.match(/^generator\/([^/]+)\/readings$/);
  if (!match) return null;

  const rawId = match[1].trim();
  const parsedId = parseInt(rawId, 10);
  if (isNaN(parsedId) || parsedId <= 0 || String(parsedId) !== rawId) {
    return null;
  }
  return parsedId;
}

/**
 * Normalizes RTC timestamp to MySQL TIMESTAMP format (YYYY-MM-DD HH:MM:SS)
 * Preserves the ESP32 RTC timestamp exactly as-is without converting to server time.
 * @param {string} dateStr 
 * @returns {string}
 */
function formatRtcTimestamp(dateStr) {
  const trimmed = dateStr.trim();
  return trimmed.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}

/**
 * Validates the parsed payload against generator_readings schema requirements
 * Supports both new field names (voltage, current, temperature) and
 * legacy field names (ac_voltage, ac_current, engine_temp) for compatibility.
 * @param {any} payload 
 * @returns {{ valid: boolean, reason?: string, cleanData?: object }}
 */
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: 'Payload must be a non-null JSON object' };
  }

  // 1. Validate recorded_at
  let recordedAt = null;
  if (payload.recorded_at) {
    if (typeof payload.recorded_at !== 'string' || isNaN(Date.parse(payload.recorded_at))) {
      return { valid: false, reason: `Invalid date format for "recorded_at": "${payload.recorded_at}"` };
    }
    recordedAt = formatRtcTimestamp(payload.recorded_at);
  } else {
    return { valid: false, reason: 'Missing required "recorded_at" timestamp string' };
  }

  // 2. Validate status: enum('running','stopped','fault','maintenance')
  let status = 'running';
  if (typeof payload.status === 'string' && payload.status.trim() !== '') {
    const normalized = payload.status.trim().toLowerCase();
    status = VALID_STATUSES.includes(normalized) ? normalized : 'running';
  }

  // 3. Resolve and validate numeric fields (support both new and legacy field names)
  const voltage = payload.voltage !== undefined ? payload.voltage : payload.ac_voltage;
  const current = payload.current !== undefined ? payload.current : payload.ac_current;
  const temperature = payload.temperature !== undefined ? payload.temperature : payload.engine_temp;
  const frequency = payload.frequency;
  const fuel_level = payload.fuel_level;
  const runtime_seconds = payload.runtime_seconds;

  const valuesToCheck = {
    voltage,
    current,
    frequency,
    temperature,
    fuel_level,
    runtime_seconds
  };

  for (const field of REQUIRED_NUMERIC_FIELDS) {
    const val = valuesToCheck[field];
    if (val === undefined || val === null) {
      return { valid: false, reason: `Missing required numeric field: "${field}"` };
    }
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return { valid: false, reason: `Field "${field}" must be a valid finite number, received: ${val}` };
    }
  }

  return {
    valid: true,
    cleanData: {
      recorded_at: recordedAt,
      status,
      voltage,
      current,
      frequency,
      temperature,
      fuel_level,
      runtime_seconds: Math.floor(runtime_seconds)
    }
  };
}

/**
 * Main message handler for incoming MQTT generator readings
 * 1. Writes readings to generator_readings table
 * 2. Updates generator status and last_seen in generators table
 * @param {object} pool - MySQL connection pool
 * @param {string} topic - The MQTT topic string
 * @param {string|Buffer} message - The incoming message payload
 */
async function handleIncomingReading(pool, topic, message) {
  const startTime = Date.now();
  const rawPayloadStr = typeof message === 'string' ? message : message.toString('utf8');

  // 1. Extract generator_id from topic
  const generatorId = extractGeneratorId(topic);
  if (generatorId === null) {
    logger.warn(`[VALIDATION_FAILURE] Invalid topic or non-integer generator_id in topic: "${topic}". Expected format: "generator/{integer_id}/readings"`, {
      topic,
      payload: rawPayloadStr
    });
    return;
  }

  // 2. Parse JSON payload
  let parsedPayload;
  try {
    parsedPayload = JSON.parse(rawPayloadStr);
  } catch (parseErr) {
    logger.warn(`[VALIDATION_FAILURE] Malformed JSON payload for generator ${generatorId}: ${parseErr.message}`, {
      generatorId,
      topic,
      payload: rawPayloadStr
    });
    return;
  }

  // 3. Validate payload fields
  const validation = validatePayload(parsedPayload);
  if (!validation.valid) {
    logger.warn(`[VALIDATION_FAILURE] Payload validation failed for generator ${generatorId}: ${validation.reason}`, {
      generatorId,
      reason: validation.reason,
      payload: parsedPayload
    });
    return;
  }

  const reading = validation.cleanData;

  // 4. Queries for generator_readings and generators table
  const insertReadingSql = `
    INSERT INTO generator_readings (
      generator_id,
      status,
      voltage,
      current,
      frequency,
      temperature,
      fuel_level,
      runtime_seconds,
      recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const updateGeneratorSql = `UPDATE generators SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE generator_id = ?`;

  try {
    const executeQuery = typeof pool.execute === 'function' ? pool.execute.bind(pool) : pool.query.bind(pool);

    // Insert reading into generator_readings
    const [insertResult] = await executeQuery(insertReadingSql, [
      generatorId,
      reading.status,
      reading.voltage,
      reading.current,
      reading.frequency,
      reading.temperature,
      reading.fuel_level,
      reading.runtime_seconds,
      reading.recorded_at
    ]);

    // Update status and last_seen in generators table
    await executeQuery(updateGeneratorSql, [reading.status, generatorId]);

    const durationMs = Date.now() - startTime;
    logger.info(`[DB_WRITE_SUCCESS] Stored reading #${insertResult.insertId} in generator_readings and updated generator ${generatorId} status='${reading.status}' (RTC: ${reading.recorded_at}, Latency: ${durationMs}ms)`);
  } catch (dbError) {
    let contextualHint = '';
    if (dbError.code === 'ER_NO_REFERENCED_ROW_2' || dbError.errno === 1452) {
      contextualHint = ` (Foreign key violation: generator_id ${generatorId} does not exist in 'generators' table)`;
    }

    logger.error(`[DB_WRITE_FAILURE] Database write failed for generator ${generatorId}${contextualHint}: ${dbError.message}`, {
      generatorId,
      recorded_at: reading.recorded_at,
      errorCode: dbError.code,
      errno: dbError.errno,
      error: dbError.message,
      fullPayload: parsedPayload
    });
  }
}

/**
 * Checks for generators that have not sent data within timeoutSeconds and marks them 'offline'
 * @param {object} pool - MySQL connection pool
 * @param {number} timeoutSeconds - Inactivity limit in seconds
 */
async function checkOfflineGenerators(pool, timeoutSeconds) {
  const sql = `UPDATE generators SET status = 'offline' WHERE status != 'offline' AND (last_seen IS NULL OR last_seen < NOW() - INTERVAL ? SECOND)`;

  try {
    const executeQuery = typeof pool.execute === 'function' ? pool.execute.bind(pool) : pool.query.bind(pool);
    const [result] = await executeQuery(sql, [timeoutSeconds]);
    if (result && result.affectedRows > 0) {
      logger.info(`[OFFLINE_MONITOR] Marked ${result.affectedRows} generator(s) as 'offline' (no data received for > ${timeoutSeconds}s)`);
    }
  } catch (err) {
    logger.error(`[OFFLINE_MONITOR_ERROR] Failed to check offline generators: ${err.message}`);
  }
}

module.exports = {
  extractGeneratorId,
  formatRtcTimestamp,
  validatePayload,
  handleIncomingReading,
  checkOfflineGenerators,
  REQUIRED_NUMERIC_FIELDS,
  VALID_STATUSES
};
