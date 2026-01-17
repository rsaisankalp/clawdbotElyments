# Clawdbot Elyments Plugin

Elyments channel plugin for [Clawdbot](https://github.com/clawdbot/clawdbot) - enables AI-powered messaging on the Elyments platform.

## Features

- **OTP Authentication** - Login via phone number and OTP verification
- **Direct Messages** - Send and receive DMs with configurable access policies
- **Group Chats** - Support for group messaging with mention detection
- **Typing Indicators** - Shows typing status while generating responses
- **Media Support** - Send and receive images/media
- **Easy Configuration** - Select from recent chats when configuring allowlist

## Quick Install (Recommended)

One command to install Clawdbot + Elyments:

```bash
curl -fsSL https://raw.githubusercontent.com/rsaisankalp/clawdbotElyments/main/install.sh | bash
```

This will:
- Clone clawdbot to `~/.clawdbot-dev`
- Clone elyments plugin into extensions
- Install all dependencies
- Create config with plugin enabled

Then run:
```bash
~/.clawdbot-dev/clawdbot.sh configure
# Select Channels → Elyments → Login with OTP

~/.clawdbot-dev/clawdbot.sh gateway
```

## Manual Installation

If you prefer manual setup:

1. Clone clawdbot:
   ```bash
   git clone https://github.com/clawdbot/clawdbot.git ~/.clawdbot-dev
   cd ~/.clawdbot-dev
   pnpm install
   ```

2. Clone elyments plugin:
   ```bash
   git clone https://github.com/rsaisankalp/clawdbotElyments.git extensions/elyments
   cd extensions/elyments
   pnpm install
   ```

3. Add to `~/.clawdbot/clawdbot.json`:
   ```json
   {
     "plugins": {
       "enabled": true,
       "load": {
         "paths": ["~/.clawdbot-dev/extensions/elyments"]
       }
     }
   }
   ```

4. Configure and run:
   ```bash
   cd ~/.clawdbot-dev
   pnpm clawdbot configure  # Select Channels → Elyments
   pnpm clawdbot gateway
   ```

## Configuration

```json
{
  "channels": {
    "elyments": {
      "enabled": true,
      "senderName": "Clawdbot",
      "dm": {
        "enabled": true,
        "policy": "allowlist",
        "allowFrom": ["user-uuid@localhost"]
      },
      "groupPolicy": "disabled"
    }
  }
}
```

### DM Policies

- `pairing` - Unknown senders receive a pairing code (default)
- `allowlist` - Only allow users in the allowFrom list
- `open` - Allow all DMs
- `disabled` - Ignore all DMs

## Commands

```bash
# Login to Elyments
clawdbot channels login elyments

# Check status
clawdbot status --all

# Configure settings
clawdbot configure
```

## Development

```bash
# Build
pnpm build

# Run with Clawdbot
pnpm clawdbot gateway
```

## Credits

- Built for [Clawdbot](https://github.com/clawdbot/clawdbot)
- Based on [elymentsApi](https://github.com/rsaisankalp/elymentsApi) SDK

## License

MIT
