# Production Dockerfile for LinguistIQ Node.js Server
FROM node:20-alpine

# Set production environment
ENV NODE_ENV=production
ENV PORT=8081

# Create and define app directory
WORKDIR /usr/src/app

# Install dependencies using clean install
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy application source
COPY index.js ./

# Run with non-privileged user for security
USER node

# Expose internal application port
EXPOSE 8081

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8081) + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

# Start the application
CMD ["node", "index.js"]
