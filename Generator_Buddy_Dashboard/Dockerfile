# Multi-arch Dockerfile for Generator Buddy (Supports linux/arm64 and linux/amd64)
FROM node:20-alpine

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Set working directory
WORKDIR /app

# Install dependencies using lockfile for reproducible builds
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source code
COPY server.js ./
COPY lib/ ./lib/
COPY routes/ ./routes/
COPY public/ ./public/

# Run as non-root node user for container security
USER node

# Expose internal dashboard port
EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/session > /dev/null || exit 1

# Start Generator Buddy server
CMD ["node", "server.js"]
