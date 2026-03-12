#!/bin/bash

# AetherOS ISO Build Script
# This MUST be run on a Debian/Ubuntu system with root privileges.

set -e

echo "--- Initializing AetherOS ISO Build ---"

# 1. Install build dependencies
sudo apt-get update
sudo apt-get install -y simple-cdd

# 2. Prepare the build directory
BUILD_DIR="iso-build"
mkdir -p $BUILD_DIR
cp preseed.cfg $BUILD_DIR/aetheros.preseed
cp post-install.sh $BUILD_DIR/post-install.sh

# 3. Run simple-cdd
# This will download the Debian 12 base and package our custom configuration.
cd $BUILD_DIR
build-simple-cdd --profiles aetheros --dist bookworm --force-mirror

echo "--- Build Complete ---"
echo "Your custom ISO is located in $BUILD_DIR/images/"
