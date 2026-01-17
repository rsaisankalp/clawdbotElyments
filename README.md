# Clawdbot Elyments Plugin

Elyments channel plugin for [Clawdbot](https://github.com/clawdbot/clawdbot) - enables AI-powered messaging on the Elyments platform.

## Features

- **OTP Authentication** - Login via phone number and OTP verification
- **Direct Messages** - Send and receive DMs with configurable access policies
- **Group Chats** - Support for group messaging with mention detection
- **Typing Indicators** - Shows typing status while generating responses
- **Media Support** - Send and receive images/media
- **Easy Configuration** - Select from recent chats when configuring allowlist

## Installation

1. Clone this repo into your Clawdbot extensions directory:
   ```bash
   cd ~/.clawdbot/extensions  # or your preferred location
   git clone https://github.com/rsaisankalp/clawdbotElyments.git elyments
   cd elyments
   pnpm install
   ```

2. Add to your `clawdbot.json`:
   ```json
   {
     "plugins": {
       "enabled": true,
       "load": {
         "paths": ["/path/to/elyments"]
       }
     }
   }
   ```

3. Run the configuration wizard:
   ```bash
   clawdbot configure
   ```
   Select "Channels" → "Elyments" to login with OTP and configure settings.

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
