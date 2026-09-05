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

# Serve the static build on port 4173 (bind to all interfaces so the host can reach it)
EXPOSE 4173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0"]
