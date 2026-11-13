/**
 * Structured Logger utility
 * Formats logs with: [ISO Timestamp] [LEVEL] Message { optional metadata }
 */

function formatTimestamp() {
  return new Date().toISOString();
}

function formatMeta(meta) {
  if (meta === undefined || meta === null) {
    return '';
  }
  if (meta instanceof Error) {
    return `\n${meta.stack || meta.message}`;
  }
  if (typeof meta === 'object') {
    try {
      return ` ` + JSON.stringify(meta);
    } catch {
      return ` [Unserializable Object]`;
    }
  }
  return ` ${meta}`;
}

const logger = {
  info(message, meta) {
    console.log(`[${formatTimestamp()}] [INFO]  ${message}${formatMeta(meta)}`);
  },
  warn(message, meta) {
    console.warn(`[${formatTimestamp()}] [WARN]  ${message}${formatMeta(meta)}`);
  },
  error(message, meta) {
    console.error(`[${formatTimestamp()}] [ERROR] ${message}${formatMeta(meta)}`);
  },
  debug(message, meta) {
    if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
      console.debug(`[${formatTimestamp()}] [DEBUG] ${message}${formatMeta(meta)}`);
    }
  }
};

module.exports = logger;
