#!/usr/bin/env tsx
/**
 * Interactive script to select recent Elyments chats for allowlist
 * Usage: pnpm tsx extensions/elyments/scripts/configure-allowlist.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

const HOME = process.env.HOME || "";
const CONFIG_FILE = path.join(HOME, ".clawdbot/clawdbot.json");
const SESSION_FILE = path.join(HOME, ".clawdbot/credentials/elyments/session.json");
const ELYMENTS_CHAT_API = "https://chatapi.elyments.com/api/inboxDetails/v2";

interface RecentChat {
  jid: string;
  title: string;
  isGroup: boolean;
  lastMessage?: string;
}

interface ElymentsSession {
  accessToken: string;
  userId: string;
}

function loadSession(): ElymentsSession | null {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
    return data.accessToken ? data : null;
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

async function fetchRecentChats(session: ElymentsSession, limit = 10): Promise<RecentChat[]> {
  try {
    const url = `${ELYMENTS_CHAT_API}?limit=${limit}`;
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch chats: ${response.status}`);
      return [];
    }

    const data = await response.json() as Record<string, unknown>;
    const items = Array.isArray(data)
      ? data
      : (data?.inboxDetails ?? data?.result ?? data?.data ?? data?.response ?? []) as unknown[];

    if (!Array.isArray(items)) return [];

    return items.slice(0, limit).map((item: unknown) => {
      const i = item as Record<string, unknown>;
      const jid = String(i?.remote_bare_jid ?? i?.remoteBareJid ?? i?.jid ?? "");
      const isGroup = jid.endsWith("@muclight.localhost");
      const title = String(
        i?.display_name ??
        i?.displayName ??
        i?.contact_name ??
        i?.name ??
        i?.group_name ??
        i?.remote_bare_jid_name ??
        i?.remoteBareJidName ??
        i?.remote_name ??
        jid
      );

      let lastMessage: string | undefined;
      const content = i?.content as Record<string, unknown> | undefined;
      const msg = content?.message as Record<string, unknown> | undefined;
      const body = msg?.body;
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body) as { info?: { message?: string } };
          lastMessage = parsed?.info?.message;
        } catch {
          lastMessage = body.slice(0, 50);
        }
      }

      return { jid, title, isGroup, lastMessage };
    }).filter((c) => c.jid);
  } catch (err) {
    console.error(`Error fetching chats:`, err);
    return [];
  }
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

async function main() {
  console.log("\n=== Elyments Allowlist Configuration ===\n");

  const session = loadSession();
  if (!session) {
    console.error("Error: Not logged in to Elyments. Run the login first.");
    process.exit(1);
  }

  console.log("Fetching recent conversations...\n");
  const recentChats = await fetchRecentChats(session, 10);
  const dmChats = recentChats.filter((c) => !c.isGroup);

  if (dmChats.length === 0) {
    console.log("No recent DM conversations found.");
    process.exit(0);
  }

  console.log("Recent DM conversations:\n");
  dmChats.forEach((chat, i) => {
    const preview = chat.lastMessage ? ` - "${chat.lastMessage.slice(0, 30)}..."` : "";
    console.log(`  ${i + 1}. ${chat.title}${preview}`);
    console.log(`     JID: ${chat.jid.split("@")[0].slice(0, 12)}...`);
  });

  console.log("\nEnter numbers of contacts to allow (comma-separated), or 'all' for all, or 'none' to skip:");
  const selection = await prompt("> ");

  if (!selection || selection.toLowerCase() === "none") {
    console.log("No changes made.");
    process.exit(0);
  }

  let selectedJids: string[] = [];
  if (selection.toLowerCase() === "all") {
    selectedJids = dmChats.map((c) => c.jid);
  } else {
    const indices = selection.split(/[,\s]+/).map((s) => parseInt(s.trim(), 10) - 1);
    selectedJids = indices
      .filter((i) => i >= 0 && i < dmChats.length)
      .map((i) => dmChats[i].jid);
  }

  if (selectedJids.length === 0) {
    console.log("No valid selections. No changes made.");
    process.exit(0);
  }

  // Load existing config and update allowFrom
  const cfg = loadConfig() as Record<string, unknown>;
  const channels = (cfg.channels ?? {}) as Record<string, unknown>;
  const elyments = (channels.elyments ?? {}) as Record<string, unknown>;
  const dm = (elyments.dm ?? {}) as Record<string, unknown>;
  const existingAllowFrom = Array.isArray(dm.allowFrom) ? dm.allowFrom.map(String) : [];

  // Merge with existing
  const newAllowFrom = [...new Set([...existingAllowFrom.filter(e => e !== "*"), ...selectedJids])];

  // Update config
  cfg.channels = {
    ...channels,
    elyments: {
      ...elyments,
      dm: {
        ...dm,
        allowFrom: newAllowFrom,
      },
    },
  };

  saveConfig(cfg);

  console.log(`\nAdded ${selectedJids.length} contact(s) to allowlist:`);
  selectedJids.forEach((jid) => {
    const chat = dmChats.find((c) => c.jid === jid);
    console.log(`  - ${chat?.title || jid}`);
  });
  console.log("\nConfiguration updated. Restart gateway to apply.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
