#!/bin/bash
# Clawdbot + Elyments Plugin Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/install.sh | bash

set -e

ELYMENTS_DIR="$HOME/.clawdbot/extensions/elyments"
ELYMENTS_REPO="https://github.com/rsaisankalp/clawdbotElyments.git"
CONFIG_FILE="$HOME/.clawdbot/clawdbot.json"

echo "Installing Clawdbot with Elyments plugin..."
echo ""

# Check for required tools
if ! command -v git &> /dev/null; then
    echo "Error: git is required. Install it first."
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required. Install Node.js 22+ first."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "Error: npm is required."
    exit 1
fi

# Install clawdbot globally via npm
echo "Installing clawdbot..."
npm i -g clawdbot

# Create extensions directory
mkdir -p "$HOME/.clawdbot/extensions"

# Clone or update elyments plugin
if [ -d "$ELYMENTS_DIR" ]; then
    echo "Updating elyments plugin..."
    cd "$ELYMENTS_DIR"
    git pull --rebase || true
else
    echo "Cloning elyments plugin..."
    git clone --depth 1 "$ELYMENTS_REPO" "$ELYMENTS_DIR"
    cd "$ELYMENTS_DIR"
fi

# Install elyments dependencies
echo "Installing elyments dependencies..."
npm install

# Create or update config to include elyments plugin
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Creating config..."
    cat > "$CONFIG_FILE" << EOF
{
  "plugins": {
    "enabled": true,
    "load": {
      "paths": ["$ELYMENTS_DIR"]
    }
  }
}
EOF
else
    # Check if elyments is already in config
    if ! grep -q "elyments" "$CONFIG_FILE" 2>/dev/null; then
        echo ""
        echo "Note: Config exists at $CONFIG_FILE"
        echo "Please add elyments plugin path to plugins.load.paths:"
        echo "  $ELYMENTS_DIR"
        echo ""
    fi
fi

echo ""
echo "Installation complete!"
echo ""

# Run configure
echo "Starting configuration..."
echo ""
clawdbot configure

# Start gateway
echo ""
echo "Starting gateway..."
clawdbot gateway
