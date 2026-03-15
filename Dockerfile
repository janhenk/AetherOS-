FROM node:20-slim
WORKDIR /app

# Install OS dependencies required by the App Store (child_process curl/unzip calls)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl unzip ca-certificates && \
    rm -rf /var/lib/apt/lists/*


# Install dependencies first for caching purposes
COPY package*.json ./
RUN npm install

# Copy application code (excluding .dockerignore items)
COPY . .

# Build Vite frontend production files
RUN npm run build

# Prune development dependencies to shrink image size
RUN npm prune --omit=dev

# Expose the dashboard port
EXPOSE 5175

# Start the standalone server
CMD ["npm", "start"]
