FROM node:18-alpine

# Install curl for healthchecks
RUN apk --no-cache add curl

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies (npm install instead of npm ci)
RUN npm install --omit=dev

# Copy app source
COPY . .

# Create uploads and public directories if they don't exist
RUN mkdir -p uploads public

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the app
CMD ["node", "app.js"]
