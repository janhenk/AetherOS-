FROM node:20-slim
WORKDIR /app

# Install OS dependencies required by the App Store and Docker management
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl unzip ca-certificates gnupg lsb-release && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    apt-get update && \
    apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin && \
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
