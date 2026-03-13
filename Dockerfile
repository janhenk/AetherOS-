FROM node:20-slim
WORKDIR /app

# Install dependencies first for caching purposes
COPY package*.json ./
RUN npm install

# Copy application code (excluding .dockerignore items)
COPY . .

# Build Vite frontend production files
RUN npm run build

# Prune development dependencies to shrink image size
RUN npm prune --omit=dev

# Change permissions for safety
RUN chown -R node:node /app
USER node

# Expose the dashboard port
EXPOSE 5175

# Start the standalone server
CMD ["npm", "start"]
