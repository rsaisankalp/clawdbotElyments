#!/bin/bash
# Clawdbot + Elyments Plugin Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/install.sh | bash

set -e

INSTALL_DIR="$HOME/.clawdbot-app"
ELYMENTS_REPO="https://github.com/rsaisankalp/clawdbotElyments.git"
CLAWDBOT_REPO="https://github.com/clawdbot/clawdbot.git"
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

# Check for pnpm or npm
if command -v pnpm &> /dev/null; then
    PKG_MGR="pnpm"
elif command -v npm &> /dev/null; then
    PKG_MGR="npm"
else
    echo "Error: pnpm or npm is required."
    exit 1
fi

echo "Using: $PKG_MGR"
echo ""

# Clone or update clawdbot
if [ -d "$INSTALL_DIR" ]; then
    echo "Updating clawdbot..."
    cd "$INSTALL_DIR"
    git fetch origin
    git reset --hard origin/main
else
    echo "Cloning clawdbot..."
    git clone --depth 1 "$CLAWDBOT_REPO" "$INSTALL_DIR"
fi

# Install clawdbot dependencies
cd "$INSTALL_DIR"
echo "Installing dependencies..."
$PKG_MGR install

# Clone or update elyments plugin
ELYMENTS_DIR="$INSTALL_DIR/extensions/elyments"
if [ -d "$ELYMENTS_DIR" ]; then
    echo "Updating elyments plugin..."
    cd "$ELYMENTS_DIR"
    git fetch origin
    git reset --hard origin/main
else
    echo "Cloning elyments plugin..."
    git clone --depth 1 "$ELYMENTS_REPO" "$ELYMENTS_DIR"
fi

# Install elyments dependencies
cd "$ELYMENTS_DIR"
$PKG_MGR install

# Create config with elyments enabled
mkdir -p "$HOME/.clawdbot"
cat > "$CONFIG_FILE" << EOF
{
  "plugins": {
    "enabled": true,
    "load": {
      "paths": ["$ELYMENTS_DIR"]
    }
  },
  "channels": {
    "elyments": {
      "enabled": true
    }
  }
}
EOF

# Create command wrapper
CLAWDBOT_CMD="$HOME/.clawdbot/clawdbot"
cat > "$CLAWDBOT_CMD" << EOF
#!/bin/bash
cd "$INSTALL_DIR" && $PKG_MGR clawdbot "\$@"
EOF
chmod +x "$CLAWDBOT_CMD"

echo ""
echo "Installation complete!"
echo ""
echo "Starting Elyments login..."
echo ""

# Login to Elyments directly
cd "$INSTALL_DIR"
$PKG_MGR clawdbot channels login --channel elyments

echo ""
echo "Starting gateway..."
$PKG_MGR clawdbot gateway
