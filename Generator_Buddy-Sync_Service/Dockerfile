# ===================================================================
# Dockerfile: Generator Monitoring MQTT-to-MySQL Sync Service
# Lightweight, secure, and production-optimized Node.js container
# ===================================================================

FROM node:20-alpine AS base

# Install dumb-init to properly handle process signals (SIGINT, SIGTERM)
RUN apk add --no-cache dumb-init

# Set production environment
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Copy package manifests first for efficient layer caching
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source code and default properties
COPY src/ ./src/
COPY application.properties ./

# Change ownership of /app to unprivileged node user
RUN chown -R node:node /app

# Run as non-root user for container security
USER node

# Use dumb-init as entrypoint to forward POSIX signals properly to Node.js
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Default command to run the service
CMD ["node", "src/index.js"]
