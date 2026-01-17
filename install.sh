#!/bin/bash
# Clawdbot + Elyments Plugin Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/install.sh | bash

set -e

INSTALL_DIR="$HOME/.clawdbot-app"
ELYMENTS_REPO="https://github.com/rsaisankalp/clawdbotElyments.git"
CLAWDBOT_REPO="https://github.com/clawdbot/clawdbot.git"
CONFIG_FILE="$HOME/.clawdbot/clawdbot.json"
AUTH_FILE="$HOME/.clawdbot/agents/main/agent/auth-profiles.json"

echo "Installing Clawdbot with Elyments plugin..."
echo ""

# Check for required tools
command -v git &> /dev/null || { echo "Error: git is required."; exit 1; }
command -v node &> /dev/null || { echo "Error: Node.js 22+ is required."; exit 1; }

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

# Create config only if it doesn't exist
mkdir -p "$HOME/.clawdbot"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Creating initial config..."
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
else
    echo "Config exists, updating plugin paths..."
    cd "$INSTALL_DIR"
    $PKG_MGR clawdbot config set plugins.enabled true 2>/dev/null || true
    $PKG_MGR clawdbot config set channels.elyments.enabled true 2>/dev/null || true
    $PKG_MGR clawdbot config set channels.elyments.dm.policy open 2>/dev/null || true
    $PKG_MGR clawdbot config set channels.elyments.dm.enabled true 2>/dev/null || true
fi

# Create command wrapper
CLAWDBOT_CMD="$HOME/.clawdbot/clawdbot"
cat > "$CLAWDBOT_CMD" << 'WRAPPER'
#!/bin/bash
cd "$HOME/.clawdbot-app" && pnpm clawdbot "$@"
WRAPPER
chmod +x "$CLAWDBOT_CMD"

echo ""
echo "Installation complete!"
echo ""

# Enable google-antigravity-auth plugin
echo "Enabling Google Antigravity plugin..."
cd "$INSTALL_DIR"
$PKG_MGR clawdbot plugins enable google-antigravity-auth 2>/dev/null || true

# Check if Google Antigravity is already configured
echo ""
echo "=== Step 1: Google Antigravity Login ==="
if [ -f "$AUTH_FILE" ] && grep -q "google-antigravity" "$AUTH_FILE" 2>/dev/null; then
    echo "Google Antigravity already configured, skipping..."
else
    echo ""
    $PKG_MGR clawdbot models auth login --provider google-antigravity </dev/tty || {
        echo "Error: Google Antigravity login failed."
        exit 1
    }
fi

echo ""
echo "=== Step 2: Setting default model ==="
$PKG_MGR clawdbot config set agents.defaults.model.primary google-antigravity/gemini-3-flash || {
    echo "Error: Failed to set default model."
    exit 1
}

# Check if Elyments is already logged in
echo ""
echo "=== Step 3: Elyments Login ==="
if ls "$HOME/.clawdbot/credentials/elyments"* &>/dev/null; then
    echo "Elyments already logged in, skipping..."
else
    echo ""
    $PKG_MGR clawdbot channels login --channel elyments </dev/tty || {
        echo "Error: Elyments login failed."
        exit 1
    }
fi

echo ""
echo "=== Step 4: Select contacts for allowlist ==="
echo ""
# Run the allowlist configuration script
cd "$ELYMENTS_DIR"
npx tsx scripts/configure-allowlist.ts </dev/tty || {
    echo "Note: Allowlist configuration skipped or failed. You can configure later."
}

echo ""
echo "=== Step 5: Configuring DM policy ==="
$PKG_MGR clawdbot config set channels.elyments.dm.policy open || true
$PKG_MGR clawdbot config set channels.elyments.dm.enabled true || true

echo ""
echo "=== Step 6: Starting Gateway ==="
echo ""

# Kill any existing gateway (multiple methods for reliability)
cd "$INSTALL_DIR"
$PKG_MGR clawdbot daemon stop 2>/dev/null || true
pkill -f "clawdbot-gateway" 2>/dev/null || true
pkill -f "tsx.*gateway" 2>/dev/null || true
# Kill any process on port 18789
lsof -ti:18789 | xargs kill -9 2>/dev/null || true
sleep 3

nohup $PKG_MGR clawdbot gateway > /tmp/clawdbot-gateway.log 2>&1 &
GATEWAY_PID=$!
sleep 5

# Check if gateway started
if ps -p $GATEWAY_PID > /dev/null 2>&1; then
    echo "Gateway started successfully (PID: $GATEWAY_PID)"
else
    echo "Error: Gateway failed to start. Check /tmp/clawdbot-gateway.log"
    tail -20 /tmp/clawdbot-gateway.log 2>/dev/null || true
    exit 1
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Gateway is running. Check logs: tail -f /tmp/clawdbot-gateway.log"
echo ""
echo "Commands:"
echo "  ~/.clawdbot/clawdbot gateway   # Start gateway"
echo "  ~/.clawdbot/clawdbot status    # Check status"
echo ""
