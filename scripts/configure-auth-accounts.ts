#!/usr/bin/env tsx
/**
 * Interactive script to add multiple Google Antigravity accounts and configure auth order
 * Usage: pnpm tsx extensions/elyments/scripts/configure-auth-accounts.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { spawn } from "node:child_process";

const HOME = process.env.HOME || "";
const CONFIG_FILE = path.join(HOME, ".clawdbot/clawdbot.json");
const AUTH_FILE = path.join(HOME, ".clawdbot/agents/main/agent/auth-profiles.json");
const INSTALL_DIR = path.join(HOME, ".clawdbot-app");

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

function getGoogleAntigravityProfiles(store: AuthProfileStore): Array<{ id: string; email: string }> {
  const profiles: Array<{ id: string; email: string }> = [];
  for (const [id, profile] of Object.entries(store.profiles)) {
    if (profile.provider === "google-antigravity") {
      profiles.push({
        id,
        email: profile.email || id.replace("google-antigravity:", ""),
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

async function runAuthLogin(): Promise<boolean> {
  return new Promise((resolve) => {
    console.log("\nStarting Google Antigravity OAuth flow...\n");

    const child = spawn("pnpm", ["clawdbot", "models", "auth", "login", "--provider", "google-antigravity"], {
      cwd: INSTALL_DIR,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });

    child.on("error", (err) => {
      console.error("Failed to start auth login:", err);
      resolve(false);
    });
  });
}

async function main() {
  console.log("\n=== Google Antigravity Account Configuration ===\n");

  const store = loadAuthProfiles();
  const existingProfiles = store ? getGoogleAntigravityProfiles(store) : [];

  if (existingProfiles.length > 0) {
    console.log("Current Google Antigravity accounts:\n");
    existingProfiles.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.email}`);
    });
    console.log("");
  } else {
    console.log("No Google Antigravity accounts configured.\n");
  }

  // Ask if user wants to add more accounts
  const addMore = await prompt("Do you want to add another Google Antigravity account? (y/N): ");

  if (addMore.toLowerCase() === "y" || addMore.toLowerCase() === "yes") {
    let continueAdding = true;

    while (continueAdding) {
      const success = await runAuthLogin();

      if (success) {
        // Reload to see new profile
        const updatedStore = loadAuthProfiles();
        const updatedProfiles = updatedStore ? getGoogleAntigravityProfiles(updatedStore) : [];

        console.log("\nCurrent accounts after adding:");
        updatedProfiles.forEach((p, i) => {
          console.log(`  ${i + 1}. ${p.email}`);
        });
        console.log("");

        const addAnother = await prompt("Add another account? (y/N): ");
        continueAdding = addAnother.toLowerCase() === "y" || addAnother.toLowerCase() === "yes";
      } else {
        console.log("\nFailed to add account. Continuing...\n");
        continueAdding = false;
      }
    }
  }

  // Now configure auth order
  const finalStore = loadAuthProfiles();
  const finalProfiles = finalStore ? getGoogleAntigravityProfiles(finalStore) : [];

  if (finalProfiles.length > 1) {
    console.log("\n=== Configure Auth Rotation Order ===\n");
    console.log("You have multiple Google Antigravity accounts. Set the order for failover/rotation.\n");

    console.log("Current accounts:");
    finalProfiles.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.email}`);
    });

    console.log("\nEnter the order as comma-separated numbers (e.g., '2,1,3')");
    console.log("Or press Enter to keep default order (round-robin based on usage):");
    const orderInput = await prompt("> ");

    if (orderInput.trim()) {
      const indices = orderInput.split(/[,\s]+/).map((s) => parseInt(s.trim(), 10) - 1);
      const orderedIds = indices
        .filter((i) => i >= 0 && i < finalProfiles.length)
        .map((i) => finalProfiles[i].id);

      if (orderedIds.length > 0) {
        // Update config with auth.order
        const cfg = loadConfig() as Record<string, unknown>;
        const auth = (cfg.auth ?? {}) as Record<string, unknown>;
        const order = (auth.order ?? {}) as Record<string, string[]>;

        order["google-antigravity"] = orderedIds;

        cfg.auth = {
          ...auth,
          order,
        };

        saveConfig(cfg);

        console.log("\nAuth order configured:");
        orderedIds.forEach((id, i) => {
          const profile = finalProfiles.find((p) => p.id === id);
          console.log(`  ${i + 1}. ${profile?.email || id}`);
        });
        console.log("\nThis order will be used for failover when rate limits are hit.");
      }
    } else {
      console.log("\nKeeping default round-robin rotation based on usage.");
    }
  }

  console.log("\n=== Configuration Complete ===\n");

  // Show final summary
  const summaryStore = loadAuthProfiles();
  const summaryProfiles = summaryStore ? getGoogleAntigravityProfiles(summaryStore) : [];

  console.log(`Total Google Antigravity accounts: ${summaryProfiles.length}`);
  summaryProfiles.forEach((p) => {
    console.log(`  - ${p.email}`);
  });

  const cfg = loadConfig() as Record<string, unknown>;
  const authOrder = (cfg.auth as Record<string, unknown>)?.order as Record<string, string[]> | undefined;
  if (authOrder?.["google-antigravity"]) {
    console.log("\nAuth rotation order: configured (will failover in specified order)");
  } else {
    console.log("\nAuth rotation: automatic round-robin (based on usage stats)");
  }

  console.log("\nRestart gateway to apply changes.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
