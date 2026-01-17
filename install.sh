#!/bin/bash
# Clawdbot + Elyments Plugin Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/install.sh | bash

set -e

INSTALL_DIR="${CLAWDBOT_DIR:-$HOME/.clawdbot-src}"
ELYMENTS_REPO="https://github.com/rsaisankalp/clawdbotElyments.git"
CLAWDBOT_REPO="https://github.com/clawdbot/clawdbot.git"
CONFIG_DIR="$HOME/.clawdbot"

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

echo "Using package manager: $PKG_MGR"
echo "Install directory: $INSTALL_DIR"
echo ""

# Clone or update clawdbot
if [ -d "$INSTALL_DIR" ]; then
    echo "Updating existing clawdbot installation..."
    cd "$INSTALL_DIR"
    git pull --rebase || true
else
    echo "Cloning clawdbot..."
    git clone --depth 1 "$CLAWDBOT_REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install clawdbot dependencies
echo "Installing clawdbot dependencies..."
$PKG_MGR install

# Clone or update elyments plugin
ELYMENTS_DIR="$INSTALL_DIR/extensions/elyments"
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
$PKG_MGR install

# Create config directory
mkdir -p "$CONFIG_DIR"

# Create or update config to include elyments plugin
CONFIG_FILE="$CONFIG_DIR/clawdbot.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Creating default config..."
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
        echo "Add elyments plugin path to plugins.load.paths:"
        echo "  $ELYMENTS_DIR"
        echo ""
    fi
fi

# Create clawdbot command wrapper
CLAWDBOT_CMD="$CONFIG_DIR/clawdbot"
cat > "$CLAWDBOT_CMD" << EOF
#!/bin/bash
cd "$INSTALL_DIR" && pnpm clawdbot "\$@"
EOF
chmod +x "$CLAWDBOT_CMD"

echo ""
echo "Installation complete!"
echo ""

# Add to PATH hint
if [[ ":$PATH:" != *":$CONFIG_DIR:"* ]]; then
    echo "Add to your PATH (add to ~/.zshrc or ~/.bashrc):"
    echo "  export PATH=\"\$HOME/.clawdbot:\$PATH\""
    echo ""
fi

# Run configure
echo "Starting Elyments configuration..."
echo ""
cd "$INSTALL_DIR" && $PKG_MGR clawdbot configure

# Ask if user wants to start gateway
echo ""
echo "Configuration complete!"
echo ""
read -p "Start gateway now? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Starting gateway..."
    cd "$INSTALL_DIR" && $PKG_MGR clawdbot gateway
else
    echo ""
    echo "To start gateway later, run:"
    echo "  ~/.clawdbot/clawdbot gateway"
    echo ""
fi
