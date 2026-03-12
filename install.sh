#!/bin/bash

# AetherOS Fresh Install Script
# Supported: Ubuntu / Debian

set -e

echo "--- Starfleet Command: Initializing AetherOS Installation ---"

# 1. Update System
sudo apt-get update

# 2. Install Docker if missing
if ! [ -x "$(command -v docker)" ]; then
    echo "--- Installing Docker Engine ---"
    sudo apt-get install -y ca-certificates curl gnupg lsb-release
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
else
    echo "--- Docker already installed ---"
fi

# 3. Clone / Setup AetherOS (Assuming we're in the project dir or cloning it)
# For the purpose of this script, we assume the user has cloned the repo.
echo "--- Finalizing AetherOS Deployment ---"

# Ensure docker.sock is accessible
sudo chmod 666 /var/run/docker.sock

# Build and Start AetherOS
sudo docker compose up -d

echo ""
echo "--- Installation Complete! ---"
echo "AetherOS Dashboard is now running at: http://localhost:5175"
echo "--- Subspace Transmission Ends ---"
