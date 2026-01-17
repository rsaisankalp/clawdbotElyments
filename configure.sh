#!/bin/bash
# Clawdbot Configuration Utility
# Usage: curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/configure.sh | bash
# Or run directly: ./configure.sh

set -e

INSTALL_DIR="$HOME/.clawdbot-app"
ELYMENTS_DIR="$INSTALL_DIR/extensions/elyments"

# Check if clawdbot is installed
if [ ! -d "$INSTALL_DIR" ]; then
    echo "Error: Clawdbot not installed. Run the install script first:"
    echo "  curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/install.sh | bash"
    exit 1
fi

# Update elyments plugin to get latest scripts
if [ -d "$ELYMENTS_DIR" ]; then
    echo "Updating elyments plugin..."
    cd "$ELYMENTS_DIR"
    git fetch origin 2>/dev/null || true
    git reset --hard origin/main 2>/dev/null || true
fi

# Run the configuration script
cd "$ELYMENTS_DIR"
exec npx tsx scripts/configure.ts </dev/tty
