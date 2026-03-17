FROM node:22-alpine

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev

# Copy source
COPY . .

# Railway injects PORT dynamically — do not hardcode
EXPOSE ${PORT:-3117}

# Use dynamic PORT in health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3117}/api/health || exit 1

ENV NODE_ENV=production

CMD ["node", "src/server.mjs"]
