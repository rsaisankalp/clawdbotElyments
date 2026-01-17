#!/usr/bin/env tsx
/**
 * Interactive configuration script for Clawdbot
 * Similar to `clawdbot configure` but with additional options for auth rotation
 * Usage: pnpm tsx extensions/elyments/scripts/configure.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { spawn, execSync } from "node:child_process";

const HOME = process.env.HOME || "";
const CONFIG_FILE = path.join(HOME, ".clawdbot/clawdbot.json");
const AUTH_FILE = path.join(HOME, ".clawdbot/agents/main/agent/auth-profiles.json");
const INSTALL_DIR = path.join(HOME, ".clawdbot-app");

// Available providers that support OAuth/login
const AUTH_PROVIDERS = [
  { id: "google-antigravity", name: "Google Antigravity (Gemini)", plugin: true },
  { id: "anthropic", name: "Anthropic (Claude)", plugin: false },
  { id: "openai-codex", name: "OpenAI Codex", plugin: false },
  { id: "github-copilot", name: "GitHub Copilot", plugin: false },
];

// Available channels
const CHANNELS = [
  { id: "whatsapp", name: "WhatsApp", requiresLink: true },
  { id: "telegram", name: "Telegram", requiresToken: true },
  { id: "discord", name: "Discord", requiresToken: true },
  { id: "slack", name: "Slack", requiresToken: true },
  { id: "signal", name: "Signal", requiresSetup: true },
  { id: "imessage", name: "iMessage", macOnly: true },
  { id: "elyments", name: "Elyments", requiresOtp: true },
];

interface AuthProfile {
  type: string;
  provider: string;
  email?: string;
  access?: string;
  refresh?: string;
  expires?: number;
}

interface AuthProfileStore {
  version: number;
  profiles: Record<string, AuthProfile>;
  lastGood?: Record<string, string>;
  usageStats?: Record<string, unknown>;
  order?: Record<string, string[]>;
}

function loadAuthProfiles(): AuthProfileStore | null {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function loadConfig(): Record<string, unknown> {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg: Record<string, unknown>): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}

function getProfilesForProvider(store: AuthProfileStore, providerId: string): Array<{ id: string; email: string }> {
  const profiles: Array<{ id: string; email: string }> = [];
  for (const [id, profile] of Object.entries(store.profiles)) {
    if (profile.provider === providerId || id.startsWith(`${providerId}:`)) {
      profiles.push({
        id,
        email: profile.email || id.replace(`${providerId}:`, ""),
      });
    }
  }
  return profiles;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function runCommand(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["clawdbot", ...args], {
      cwd: INSTALL_DIR,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });

    child.on("error", () => {
      resolve(false);
    });
  });
}

function getChannelStatus(channelId: string): { configured: boolean; enabled: boolean } {
  const cfg = loadConfig() as Record<string, unknown>;
  const channels = (cfg.channels ?? {}) as Record<string, unknown>;
  const channelCfg = (channels[channelId] ?? {}) as Record<string, unknown>;

  // Check if credentials exist
  let configured = false;
  if (channelId === "whatsapp") {
    configured = fs.existsSync(path.join(HOME, ".clawdbot/credentials/whatsapp"));
  } else if (channelId === "elyments") {
    configured = fs.existsSync(path.join(HOME, ".clawdbot/credentials/elyments/session.json"));
  } else if (channelId === "telegram") {
    configured = Boolean((channelCfg as Record<string, unknown>).token);
  } else if (channelId === "discord") {
    configured = Boolean((channelCfg as Record<string, unknown>).token);
  } else if (channelId === "slack") {
    configured = Boolean((channelCfg as Record<string, unknown>).botToken);
  }

  const enabled = channelCfg.enabled !== false;
  return { configured, enabled };
}

async function showMainMenu(): Promise<string> {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║        Clawdbot Configuration Menu           ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  console.log("  1. Configure Auth Providers (API keys, OAuth)");
  console.log("  2. Configure Channels (WhatsApp, Telegram, etc.)");
  console.log("  3. View Current Status");
  console.log("  4. Set Default Model");
  console.log("  5. Configure DM Policies");
  console.log("  6. Manage Gateway");
  console.log("  0. Exit\n");

  return await prompt("Select option: ");
}

async function configureAuthProviders(): Promise<void> {
  const store = loadAuthProfiles();

  console.log("\n=== Auth Providers Configuration ===\n");
  console.log("Available providers:\n");

  AUTH_PROVIDERS.forEach((provider, i) => {
    const profiles = store ? getProfilesForProvider(store, provider.id) : [];
    const status = profiles.length > 0
      ? `✓ ${profiles.length} account(s): ${profiles.map(p => p.email).join(", ")}`
      : "○ not configured";
    console.log(`  ${i + 1}. ${provider.name}`);
    console.log(`     ${status}`);
  });

  console.log("\n  0. Back to main menu\n");

  const choice = await prompt("Select provider to configure: ");
  const idx = parseInt(choice, 10) - 1;

  if (choice === "0" || isNaN(idx) || idx < 0 || idx >= AUTH_PROVIDERS.length) {
    return;
  }

  const provider = AUTH_PROVIDERS[idx];
  await configureProvider(provider);
}

async function configureProvider(provider: { id: string; name: string; plugin: boolean }): Promise<void> {
  const store = loadAuthProfiles();
  const profiles = store ? getProfilesForProvider(store, provider.id) : [];

  console.log(`\n=== ${provider.name} Configuration ===\n`);

  if (profiles.length > 0) {
    console.log("Current accounts:");
    profiles.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.email}`);
    });
    console.log("");
  }

  console.log("Options:");
  console.log("  1. Add new account");
  if (profiles.length > 1) {
    console.log("  2. Configure auth order (rotation priority)");
  }
  console.log("  0. Back\n");

  const action = await prompt("Select action: ");

  if (action === "1") {
    console.log(`\nStarting ${provider.name} login...\n`);

    if (provider.id === "github-copilot") {
      await runCommand(["models", "auth", "login-github-copilot"]);
    } else if (provider.plugin) {
      await runCommand(["models", "auth", "login", "--provider", provider.id]);
    } else {
      await runCommand(["models", "auth", "add"]);
    }

    // Ask if they want to add more
    const addMore = await prompt("\nAdd another account? (y/N): ");
    if (addMore.toLowerCase() === "y") {
      await configureProvider(provider);
    }
  } else if (action === "2" && profiles.length > 1) {
    await configureAuthOrder(provider.id, profiles);
  }
}

async function configureAuthOrder(providerId: string, profiles: Array<{ id: string; email: string }>): Promise<void> {
  console.log("\n=== Configure Auth Rotation Order ===\n");
  console.log("Current accounts:");
  profiles.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.email}`);
  });

  console.log("\nEnter the order as comma-separated numbers (e.g., '2,1' to prioritize second account)");
  console.log("Or press Enter to use automatic round-robin:\n");

  const orderInput = await prompt("> ");

  if (orderInput.trim()) {
    const indices = orderInput.split(/[,\s]+/).map((s) => parseInt(s.trim(), 10) - 1);
    const orderedIds = indices
      .filter((i) => i >= 0 && i < profiles.length)
      .map((i) => profiles[i].id);

    if (orderedIds.length > 0) {
      const cfg = loadConfig() as Record<string, unknown>;
      const auth = (cfg.auth ?? {}) as Record<string, unknown>;
      const order = (auth.order ?? {}) as Record<string, string[]>;

      order[providerId] = orderedIds;

      cfg.auth = { ...auth, order };
      saveConfig(cfg);

      console.log("\n✓ Auth order configured:");
      orderedIds.forEach((id, i) => {
        const profile = profiles.find((p) => p.id === id);
        console.log(`  ${i + 1}. ${profile?.email || id}`);
      });
    }
  } else {
    // Clear explicit order to use round-robin
    const cfg = loadConfig() as Record<string, unknown>;
    const auth = (cfg.auth ?? {}) as Record<string, unknown>;
    const order = (auth.order ?? {}) as Record<string, string[]>;

    delete order[providerId];

    cfg.auth = { ...auth, order };
    saveConfig(cfg);

    console.log("\n✓ Using automatic round-robin rotation.");
  }
}

async function configureChannels(): Promise<void> {
  console.log("\n=== Channels Configuration ===\n");
  console.log("Available channels:\n");

  CHANNELS.forEach((channel, i) => {
    const status = getChannelStatus(channel.id);
    const statusIcon = status.configured ? "✓" : "○";
    const enabledStr = status.enabled ? "enabled" : "disabled";
    const configuredStr = status.configured ? "configured" : "not configured";
    console.log(`  ${i + 1}. ${channel.name}`);
    console.log(`     ${statusIcon} ${configuredStr}, ${enabledStr}`);
  });

  console.log("\n  0. Back to main menu\n");

  const choice = await prompt("Select channel to configure: ");
  const idx = parseInt(choice, 10) - 1;

  if (choice === "0" || isNaN(idx) || idx < 0 || idx >= CHANNELS.length) {
    return;
  }

  const channel = CHANNELS[idx];
  await configureChannel(channel);
}

async function configureChannel(channel: { id: string; name: string }): Promise<void> {
  const status = getChannelStatus(channel.id);

  console.log(`\n=== ${channel.name} Configuration ===\n`);
  console.log(`Status: ${status.configured ? "configured" : "not configured"}, ${status.enabled ? "enabled" : "disabled"}\n`);

  console.log("Options:");
  console.log("  1. Login / Link account");
  console.log("  2. " + (status.enabled ? "Disable" : "Enable") + " channel");
  console.log("  3. Configure DM policy");
  console.log("  0. Back\n");

  const action = await prompt("Select action: ");

  if (action === "1") {
    console.log(`\nStarting ${channel.name} login...\n`);
    await runCommand(["channels", "login", "--channel", channel.id]);
  } else if (action === "2") {
    const newState = !status.enabled;
    await runCommand(["config", "set", `channels.${channel.id}.enabled`, String(newState)]);
    console.log(`\n✓ ${channel.name} ${newState ? "enabled" : "disabled"}.`);
  } else if (action === "3") {
    await configureDmPolicy(channel.id);
  }
}

async function configureDmPolicy(channelId: string): Promise<void> {
  console.log("\n=== DM Policy Configuration ===\n");
  console.log("Policies:");
  console.log("  1. open - Accept all DMs");
  console.log("  2. pairing - Require pairing code for unknown senders");
  console.log("  3. allowlist - Only accept from allowed list");
  console.log("  4. disabled - Ignore all DMs\n");

  const choice = await prompt("Select policy (1-4): ");

  const policies = ["open", "pairing", "allowlist", "disabled"];
  const idx = parseInt(choice, 10) - 1;

  if (idx >= 0 && idx < policies.length) {
    await runCommand(["config", "set", `channels.${channelId}.dm.policy`, policies[idx]]);
    await runCommand(["config", "set", `channels.${channelId}.dm.enabled`, "true"]);
    console.log(`\n✓ DM policy set to "${policies[idx]}".`);
  }
}

async function viewStatus(): Promise<void> {
  console.log("\n=== Current Status ===\n");
  await runCommand(["channels", "list"]);
  await prompt("\nPress Enter to continue...");
}

async function setDefaultModel(): Promise<void> {
  console.log("\n=== Set Default Model ===\n");
  console.log("Common models:");
  console.log("  1. google-antigravity/gemini-3-flash (fast, recommended)");
  console.log("  2. google-antigravity/gemini-3-pro (powerful)");
  console.log("  3. google-antigravity/claude-opus-4-5-thinking (best reasoning)");
  console.log("  4. anthropic/claude-sonnet-4 (balanced)");
  console.log("  5. anthropic/claude-opus-4 (most capable)");
  console.log("  6. Custom model ID\n");

  const choice = await prompt("Select model (1-6): ");

  const models = [
    "google-antigravity/gemini-3-flash",
    "google-antigravity/gemini-3-pro",
    "google-antigravity/claude-opus-4-5-thinking",
    "anthropic/claude-sonnet-4",
    "anthropic/claude-opus-4",
  ];

  let model = "";
  const idx = parseInt(choice, 10) - 1;

  if (idx >= 0 && idx < models.length) {
    model = models[idx];
  } else if (choice === "6") {
    model = await prompt("Enter model ID: ");
  }

  if (model) {
    await runCommand(["config", "set", "agents.defaults.model.primary", model]);
    console.log(`\n✓ Default model set to "${model}".`);
  }
}

async function manageGateway(): Promise<void> {
  console.log("\n=== Gateway Management ===\n");
  console.log("Options:");
  console.log("  1. Start gateway");
  console.log("  2. Stop gateway");
  console.log("  3. Restart gateway");
  console.log("  4. View gateway status");
  console.log("  5. View gateway logs");
  console.log("  0. Back\n");

  const choice = await prompt("Select action: ");

  if (choice === "1") {
    console.log("\nStarting gateway...\n");
    execSync("lsof -ti:18789 | xargs kill -9 2>/dev/null || true", { stdio: "ignore" });
    execSync(`cd "${INSTALL_DIR}" && nohup pnpm clawdbot gateway > /tmp/clawdbot-gateway.log 2>&1 &`, { shell: "/bin/bash" });
    console.log("✓ Gateway started. Logs: tail -f /tmp/clawdbot-gateway.log");
  } else if (choice === "2") {
    console.log("\nStopping gateway...\n");
    await runCommand(["daemon", "stop"]);
    execSync("pkill -f clawdbot-gateway 2>/dev/null || true", { stdio: "ignore" });
    execSync("lsof -ti:18789 | xargs kill -9 2>/dev/null || true", { stdio: "ignore" });
    console.log("✓ Gateway stopped.");
  } else if (choice === "3") {
    console.log("\nRestarting gateway...\n");
    await runCommand(["daemon", "stop"]);
    execSync("pkill -f clawdbot-gateway 2>/dev/null || true", { stdio: "ignore" });
    execSync("lsof -ti:18789 | xargs kill -9 2>/dev/null || true", { stdio: "ignore" });
    await new Promise(r => setTimeout(r, 2000));
    execSync(`cd "${INSTALL_DIR}" && nohup pnpm clawdbot gateway > /tmp/clawdbot-gateway.log 2>&1 &`, { shell: "/bin/bash" });
    console.log("✓ Gateway restarted. Logs: tail -f /tmp/clawdbot-gateway.log");
  } else if (choice === "4") {
    await runCommand(["status"]);
  } else if (choice === "5") {
    console.log("\nRecent gateway logs:\n");
    try {
      const logs = execSync("tail -30 /tmp/clawdbot-gateway.log 2>/dev/null || echo 'No logs found'", { encoding: "utf-8" });
      console.log(logs);
    } catch {
      console.log("No logs found.");
    }
  }

  await prompt("\nPress Enter to continue...");
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║     🦞 Clawdbot Configuration Utility 🦞      ║");
  console.log("╚══════════════════════════════════════════════╝");

  while (true) {
    const choice = await showMainMenu();

    switch (choice) {
      case "1":
        await configureAuthProviders();
        break;
      case "2":
        await configureChannels();
        break;
      case "3":
        await viewStatus();
        break;
      case "4":
        await setDefaultModel();
        break;
      case "5":
        console.log("\n=== DM Policy Configuration ===\n");
        console.log("Select a channel first to configure its DM policy.\n");
        await configureChannels();
        break;
      case "6":
        await manageGateway();
        break;
      case "0":
      case "":
        console.log("\nGoodbye! 🦞\n");
        process.exit(0);
      default:
        console.log("\nInvalid option. Please try again.");
    }
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
