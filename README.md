# Clawdbot Elyments Plugin

AI-powered messaging bot for [Elyments](https://elyments.com) using [Clawdbot](https://github.com/clawdbot/clawdbot).

---

## Quick Start (Elyments + Free AI)

```bash
curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/install.sh | bash
```

This sets up everything automatically:
- ✅ Clawdbot + Elyments plugin
- ✅ Google Antigravity (free Gemini API)
- ✅ Elyments login via OTP
- ✅ Starts gateway immediately

**Perfect for:** Getting started quickly with Elyments and free AI.

---

## Advanced Setup (All Providers & Channels)

```bash
curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/configure.sh | bash
```

Full configuration wizard with all options:

**AI Providers:**
- Anthropic (Claude Opus, Sonnet, Haiku)
- OpenAI (GPT-4, Codex)
- Google Antigravity (Gemini)
- GitHub Copilot
- And more...

**Channels:**
- WhatsApp
- Telegram
- Discord
- Slack
- Signal
- iMessage
- Elyments

**Features:**
- Multiple accounts per provider (auto-rotation on rate limits)
- Custom model selection
- DM policies per channel
- Gateway management

**Perfect for:** Power users, multiple providers, complex setups.

---

## After Installation

```bash
# Start gateway
~/.clawdbot/clawdbot gateway

# Check status
~/.clawdbot/clawdbot status

# View logs
tail -f /tmp/clawdbot-gateway.log
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Free AI** | Google Antigravity = free Gemini access |
| **Auto-rotation** | Multiple accounts rotate on rate limits |
| **Multi-channel** | WhatsApp, Telegram, Discord, Slack, etc. |
| **DM Control** | open, pairing, allowlist, or disabled |
| **Media** | Send and receive images |
| **Groups** | Respond when mentioned |

---

## DM Policies

```bash
~/.clawdbot/clawdbot config set channels.elyments.dm.policy <policy>
```

| Policy | Description |
|--------|-------------|
| `open` | Accept all messages |
| `pairing` | Unknown senders get pairing code |
| `allowlist` | Only specific contacts |
| `disabled` | Ignore all DMs |

---

## Configuration File

`~/.clawdbot/clawdbot.json`

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
        "policy": "open"
      }
    }
  }
}
```

---

## Troubleshooting

```bash
# Gateway port in use
lsof -ti:18789 | xargs kill -9
~/.clawdbot/clawdbot gateway

# Re-login Elyments
~/.clawdbot/clawdbot channels login --channel elyments

# Re-auth Google Antigravity
cd ~/.clawdbot-app && pnpm clawdbot models auth login --provider google-antigravity

# Full reconfigure
curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/configure.sh | bash
```

---

## Requirements

- Node.js 22+
- pnpm or npm
- Git

---

## Credits

- [Clawdbot](https://github.com/clawdbot/clawdbot)
- [elymentsApi](https://github.com/rsaisankalp/elymentsApi)

## License

MIT
