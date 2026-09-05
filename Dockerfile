FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --prefer-offline --no-audit

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose port for preview server
EXPOSE 4173

# Start preview server
CMD ["npm", "run", "preview"]
