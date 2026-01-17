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

# Create config with elyments, google-antigravity, and default model
mkdir -p "$HOME/.clawdbot"
cat > "$CONFIG_FILE" << EOF
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "google-antigravity/gemini-3-flash"
      }
    }
  },
  "plugins": {
    "enabled": true,
    "load": {
      "paths": ["$ELYMENTS_DIR"]
    },
    "entries": {
      "google-antigravity-auth": {
        "enabled": true
      }
    }
  },
  "channels": {
    "elyments": {
      "enabled": true,
      "dm": {
        "enabled": true,
        "policy": "open",
        "allowFrom": ["*"]
      }
    }
  },
  "gateway": {
    "mode": "local"
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

# Enable google-antigravity-auth plugin (for Antigravity model option)
echo "Enabling Google Antigravity plugin..."
cd "$INSTALL_DIR"
$PKG_MGR clawdbot plugins enable google-antigravity-auth 2>/dev/null || true

echo ""
echo "Reconnecting to terminal for interactive setup..."

# Reconnect stdin to terminal for interactive prompts
if [ -t 0 ] || exec < /dev/tty 2>/dev/null; then
    echo "Terminal connected."
else
    echo "Warning: Could not connect to terminal. Running in non-interactive mode."
    echo ""
    echo "To complete setup manually, run:"
    echo "  cd ~/.clawdbot-app && pnpm clawdbot models auth login --provider google-antigravity"
    echo "  cd ~/.clawdbot-app && pnpm clawdbot channels login --channel elyments"
    echo "  cd ~/.clawdbot-app && pnpm clawdbot gateway"
    exit 0
fi

# Check if Google Antigravity is already configured
echo ""
echo "Checking existing auth..."
ANTIGRAVITY_AUTH="no"
if [ -f "$HOME/.clawdbot/agents/main/agent/auth-profiles.json" ]; then
    if grep -q "google-antigravity" "$HOME/.clawdbot/agents/main/agent/auth-profiles.json" 2>/dev/null; then
        ANTIGRAVITY_AUTH="yes"
    fi
fi

if [ "$ANTIGRAVITY_AUTH" = "no" ]; then
    echo ""
    echo "Step 1: Setting up AI model (Google Antigravity)..."
    echo ""
    $PKG_MGR clawdbot models auth login --provider google-antigravity
else
    echo ""
    echo "Step 1: Google Antigravity already configured, skipping..."
fi

# Set default model to gemini-3-flash
echo ""
echo "Setting default model to gemini-3-flash..."
$PKG_MGR clawdbot config set agents.defaults.model.primary google-antigravity/gemini-3-flash 2>/dev/null || true

# Check if Elyments is already logged in
echo ""
echo "Checking Elyments credentials..."
ELYMENTS_CREDS=""
if ls "$HOME/.clawdbot/credentials/elyments"* >/dev/null 2>&1; then
    ELYMENTS_CREDS="exists"
fi

if [ -z "$ELYMENTS_CREDS" ]; then
    echo ""
    echo "Step 2: Logging into Elyments..."
    echo ""
    $PKG_MGR clawdbot channels login --channel elyments
else
    echo ""
    echo "Step 2: Elyments already logged in, skipping..."
fi

echo ""
echo "Step 3: Ensuring DM policy is set to 'open'..."

# Force DM policy to open
$PKG_MGR clawdbot config set channels.elyments.dm.policy open 2>/dev/null || true
$PKG_MGR clawdbot config set channels.elyments.dm.enabled true 2>/dev/null || true

echo ""
echo "Step 4: Starting gateway..."
echo ""

# Start gateway directly in background
cd "$INSTALL_DIR"
nohup $PKG_MGR clawdbot gateway > /tmp/clawdbot-gateway.log 2>&1 &
GATEWAY_PID=$!
sleep 5

# Check if gateway started
if ps -p $GATEWAY_PID > /dev/null 2>&1; then
    echo "Gateway started successfully (PID: $GATEWAY_PID)"
else
    echo "Gateway may have failed to start. Check /tmp/clawdbot-gateway.log"
fi

echo ""
echo "Done! Gateway is running in the background."

echo ""
echo "Commands:"
echo "  ~/.clawdbot/clawdbot daemon status"
echo "  ~/.clawdbot/clawdbot daemon stop"
echo "  ~/.clawdbot/clawdbot daemon start"
echo ""
