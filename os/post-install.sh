#!/bin/bash

# AetherOS ISO Post-Install Script
# This runs inside the 'chroot' of the newly installed system

echo "--- Starfleet Command: Provisioning AetherOS Node ---"

# 1. Update and install basic dependencies
apt-get update
apt-get install -y curl git util-linux ca-certificates gnupg lsb-release

# 2. Install Docker
if ! [ -x "$(command -v docker)" ]; then
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# 3. Clone AetherOS and run the production setup
cd /opt
# Note: In a real production ISO, we would bundle the code on the ISO and copy it here.
# For this prototype, we'll clone the current repository (assuming public or pre-authed).
# However, to be "offline friendly", simple-cdd allows you to bundle files.
git clone https://github.com/USER/aether-os.git  # Placeholder URL
cd aether-os

# 4. Standard LCARS install
chmod +x install.sh
./install.sh

echo "--- Node Provisioning Complete ---"
