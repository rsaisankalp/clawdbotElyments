# Clawdbot Elyments Plugin

AI-powered messaging bot for [Elyments](https://elyments.com) using [Clawdbot](https://github.com/clawdbot/clawdbot).

## One-Command Install

```bash
curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/install.sh | bash
```

**What it does:**
1. Installs Clawdbot + Elyments plugin
2. Sets up Google Antigravity (free Gemini API access)
3. Logs you into Elyments via OTP
4. Lets you select contacts from recent conversations
5. Starts the gateway - ready to receive messages!

## After Installation

**Start gateway:**
```bash
~/.clawdbot/clawdbot gateway
```

**Check status:**
```bash
~/.clawdbot/clawdbot status
```

**View logs:**
```bash
tail -f /tmp/clawdbot-gateway.log
```

## Configuration Utility

For additional setup (more auth accounts, other channels, model changes):

```bash
curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/configure.sh | bash
```

**Options available:**
- Add multiple Google Antigravity accounts (auto-rotation on rate limits)
- Configure other channels (WhatsApp, Telegram, Discord, Slack)
- Set default AI model
- Configure DM policies
- Manage gateway (start/stop/restart)

## Features

- **Free AI** - Uses Google Antigravity (Gemini) - no API costs
- **Auto-rotation** - Multiple accounts rotate automatically on rate limits
- **Direct Messages** - Configurable access (open, allowlist, pairing)
- **Group Chats** - Respond when mentioned
- **Media Support** - Send and receive images
- **Typing Indicators** - Shows typing while generating response

## DM Policies

| Policy | Description |
|--------|-------------|
| `open` | Accept messages from everyone |
| `pairing` | Unknown senders get a pairing code (default) |
| `allowlist` | Only accept from specific contacts |
| `disabled` | Ignore all DMs |

Set via configure utility or:
```bash
~/.clawdbot/clawdbot config set channels.elyments.dm.policy open
```

## Configuration File

Location: `~/.clawdbot/clawdbot.json`

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "google-antigravity/gemini-3-flash"
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
  }
}
```

## Auth Rotation (Multiple Accounts)

Add multiple Google accounts for automatic failover:

1. Run configure utility
2. Select "Configure Auth Providers"
3. Add accounts via OAuth
4. Set rotation order (optional)

When one account hits rate limits, Clawdbot automatically switches to the next.

## Manual Installation

<details>
<summary>Click to expand</summary>

1. **Clone Clawdbot:**
   ```bash
   git clone https://github.com/clawdbot/clawdbot.git ~/.clawdbot-app
   cd ~/.clawdbot-app && pnpm install
   ```

2. **Clone Elyments plugin:**
   ```bash
   git clone https://github.com/rsaisankalp/clawdbotElyments.git ~/.clawdbot-app/extensions/elyments
   cd ~/.clawdbot-app/extensions/elyments && pnpm install
   ```

3. **Enable plugin in `~/.clawdbot/clawdbot.json`:**
   ```json
   {
     "plugins": {
       "enabled": true,
       "load": {
         "paths": ["~/.clawdbot-app/extensions/elyments"]
       },
       "entries": {
         "google-antigravity-auth": {
           "enabled": true
         }
       }
     }
   }
   ```

4. **Configure and run:**
   ```bash
   cd ~/.clawdbot-app
   pnpm clawdbot plugins enable google-antigravity-auth
   pnpm clawdbot models auth login --provider google-antigravity
   pnpm clawdbot channels login --channel elyments
   pnpm clawdbot gateway
   ```

</details>

## Troubleshooting

**Gateway won't start (port in use):**
```bash
lsof -ti:18789 | xargs kill -9
~/.clawdbot/clawdbot gateway
```

**Re-login to Elyments:**
```bash
~/.clawdbot/clawdbot channels login --channel elyments
```

**Re-authenticate Google Antigravity:**
```bash
cd ~/.clawdbot-app && pnpm clawdbot models auth login --provider google-antigravity
```

## Requirements

- Node.js 22+
- pnpm or npm
- Git

## Credits

- [Clawdbot](https://github.com/clawdbot/clawdbot) - The bot framework
- [elymentsApi](https://github.com/rsaisankalp/elymentsApi) - Elyments SDK

## License

MIT
