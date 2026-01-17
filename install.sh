#!/bin/bash
# Clawdbot + Elyments Plugin Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/install.sh | bash

set -e

INSTALL_DIR="${CLAWDBOT_DIR:-$HOME/.clawdbot-dev}"
ELYMENTS_REPO="https://github.com/rsaisankalp/clawdbotElyments.git"
CLAWDBOT_REPO="https://github.com/clawdbot/clawdbot.git"

echo "🦞 Installing Clawdbot with Elyments plugin..."
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

# Create config if not exists
CONFIG_FILE="$HOME/.clawdbot/clawdbot.json"
mkdir -p "$HOME/.clawdbot"

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
    echo "Config exists at $CONFIG_FILE"
    echo "Add this to enable elyments plugin:"
    echo ""
    echo '  "plugins": {'
    echo '    "enabled": true,'
    echo '    "load": {'
    echo "      \"paths\": [\"$ELYMENTS_DIR\"]"
    echo '    }'
    echo '  }'
fi

# Create alias script
ALIAS_SCRIPT="$INSTALL_DIR/clawdbot.sh"
cat > "$ALIAS_SCRIPT" << EOF
#!/bin/bash
cd "$INSTALL_DIR" && pnpm clawdbot "\$@"
EOF
chmod +x "$ALIAS_SCRIPT"

echo ""
echo "✅ Installation complete!"
echo ""
echo "To run clawdbot:"
echo "  $ALIAS_SCRIPT"
echo ""
echo "Or add alias to your shell:"
echo "  echo 'alias clawdbot-dev=\"$ALIAS_SCRIPT\"' >> ~/.zshrc"
echo ""
echo "Next steps:"
echo "  1. Run: $ALIAS_SCRIPT configure"
echo "  2. Select Channels → Elyments"
echo "  3. Login with OTP"
echo "  4. Run: $ALIAS_SCRIPT gateway"
echo ""
