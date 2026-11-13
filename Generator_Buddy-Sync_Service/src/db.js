const mysql = require('mysql2/promise');
const config = require('./config');
const logger = require('./logger');

// Configure MySQL connection pool using mysql2/promise
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: config.db.waitForConnections,
  connectionLimit: config.db.connectionLimit,
  queueLimit: config.db.queueLimit,
  enableKeepAlive: config.db.enableKeepAlive,
  keepAliveInitialDelay: config.db.keepAliveInitialDelay
});

/**
 * Tests database connectivity by executing a lightweight query.
 * Verifies that the generator_monitoring database is reachable.
 */
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    logger.info(`Successfully connected to MySQL database: "${config.db.database}" at ${config.db.host}:${config.db.port}`);
    connection.release();
    return true;
  } catch (error) {
    logger.error(`Failed to connect to MySQL database "${config.db.database}": ${error.message}`, {
      code: error.code,
      host: config.db.host,
      port: config.db.port,
      database: config.db.database
    });
    return false;
  }
}

/**
 * Gracefully closes the connection pool
 */
async function closePool() {
  try {
    await pool.end();
    logger.info('MySQL connection pool closed.');
  } catch (error) {
    logger.error(`Error closing MySQL pool: ${error.message}`);
  }
}

module.exports = {
  pool,
  testConnection,
  closePool
};
