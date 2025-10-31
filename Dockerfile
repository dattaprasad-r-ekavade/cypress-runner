FROM cypress/included:13.13.2

# Set working directory
WORKDIR /app

# Set environment variables for Cypress (suppress warnings)
ENV CYPRESS_CACHE_FOLDER=/root/.cache/Cypress \
    DBUS_SESSION_BUS_ADDRESS=/dev/null \
    QT_QPA_PLATFORM=offscreen

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code
COPY server ./server
COPY public ./public

# Create necessary directories
RUN mkdir -p /app/runs /app/logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Override the default Cypress entrypoint and start our Node server
ENTRYPOINT []
CMD ["node", "server/index.js"]
