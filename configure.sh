#!/bin/bash
# Clawdbot Configuration Utility
# Runs the official clawdbot configure wizard
# Usage: curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/configure.sh | bash

set -e

INSTALL_DIR="$HOME/.clawdbot-app"

# Check if clawdbot is installed
if [ ! -d "$INSTALL_DIR" ]; then
    echo "Error: Clawdbot not installed. Run the install script first:"
    echo "  curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/install.sh | bash"
    exit 1
fi

# Run clawdbot configure
cd "$INSTALL_DIR"
exec pnpm clawdbot configure </dev/tty
