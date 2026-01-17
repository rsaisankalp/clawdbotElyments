import { EventEmitter } from "node:events";
import type {
  ElymentsSession,
  ChatSummary,
  RecipientEntry,
  ResolvedRecipient,
  ElymentsMediaInfo,
} from "../types.js";
import { ELYMENTS_ENDPOINTS } from "../types.js";
import {
  loadElymentsSession,
  loadElymentsProfile,
  saveElymentsProfile,
  getOrCreateDevice,
} from "./credentials.js";
import { getValidSession, withAutoRefresh } from "./auth.js";
import {
  ElymentsXmppClient,
  type XmppMessageEvent,
  isElymentsGroup,
  formatDirectJid,
  formatGroupJid,
} from "./xmpp.js";

export type ElymentsClientEvents = {
  message: [XmppMessageEvent];
  online: [];
  offline: [];
  error: [Error];
  connected: [];
  disconnected: [{ reason?: string }];
};

export class ElymentsClient extends EventEmitter<ElymentsClientEvents> {
  private xmpp: ElymentsXmppClient | null = null;
  private recipientIndex: Map<string, RecipientEntry> = new Map();
  private env: NodeJS.ProcessEnv;

  constructor(env?: NodeJS.ProcessEnv) {
    super();
    this.env = env || process.env;
  }

  // Connect to Elyments (requires existing session)
  async connect(): Promise<void> {
    const result = await getValidSession(this.env);
    if (!result.success || !result.session) {
      throw new Error(result.error || "Not logged in");
    }

    await this.connectXmpp(result.session);
  }

  private async connectXmpp(session: ElymentsSession): Promise<void> {
    if (this.xmpp) {
      this.xmpp.disconnect();
    }

    const device = getOrCreateDevice(this.env);
    this.xmpp = new ElymentsXmppClient(session, device.resource);

    // Forward events
    this.xmpp.on("message", (msg) => this.emit("message", msg));
    this.xmpp.on("online", () => this.emit("online"));
    this.xmpp.on("offline", () => this.emit("offline"));
    this.xmpp.on("error", (err) => this.emit("error", err));
    this.xmpp.on("connected", () => this.emit("connected"));
    this.xmpp.on("disconnected", (info) => this.emit("disconnected", info));

    await this.xmpp.connect();
  }

  // Disconnect from Elyments
  async disconnect(): Promise<void> {
    if (this.xmpp) {
      await this.xmpp.disconnect();
      this.xmpp = null;
    }
  }

  // Check if connected
  isConnected(): boolean {
    return this.xmpp?.isConnected() ?? false;
  }

  // Send text message
  async sendText(to: string, text: string, senderName?: string): Promise<string> {
    if (!this.xmpp?.isConnected()) {
      throw new Error("Not connected to Elyments");
    }

    const jid = this.resolveJid(to);
    const name = senderName || this.getSenderName();
    return await this.xmpp.sendText(jid, text, name);
  }

  // Send media message
  async sendMedia(
    to: string,
    media: ElymentsMediaInfo,
    caption?: string,
    senderName?: string,
  ): Promise<string> {
    if (!this.xmpp?.isConnected()) {
      throw new Error("Not connected to Elyments");
    }

    const jid = this.resolveJid(to);
    const name = senderName || this.getSenderName();
    return await this.xmpp.sendMedia(jid, media, caption, name);
  }

  // Send typing indicator
  sendComposing(to: string): void {
    if (!this.xmpp?.isConnected()) return;
    const jid = this.resolveJid(to);
    this.xmpp.sendComposing(jid);
  }

  // Stop typing indicator
  sendPaused(to: string): void {
    if (!this.xmpp?.isConnected()) return;
    const jid = this.resolveJid(to);
    this.xmpp.sendPaused(jid);
  }

  // Get sender name from profile
  private getSenderName(): string {
    const profile = loadElymentsProfile(this.env);
    return profile?.senderName || process.env.ELYMENTS_SENDER_NAME || "Clawdbot";
  }

  // Resolve target to JID
  private resolveJid(target: string): string {
    // Already a JID
    if (target.includes("@localhost") || target.includes("@muclight.localhost")) {
      return target;
    }

    // Check recipient index
    const normalized = target.toLowerCase().trim();
    const entry = this.recipientIndex.get(normalized);
    if (entry) return entry.jid;

    // Try to match by name in index
    for (const [, recipient] of this.recipientIndex) {
      if (recipient.title.toLowerCase() === normalized) {
        return recipient.jid;
      }
    }

    // Assume it's a user ID for direct message
    return formatDirectJid(target);
  }

  // List chats from API
  async listChats(): Promise<ChatSummary[]> {
    return await withAutoRefresh(async (session) => {
      const url = `${ELYMENTS_ENDPOINTS.chat}Chat/List`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to list chats: ${response.status}`);
      }

      const data = (await response.json()) as {
        success: boolean;
        data?: Array<{
          id: string;
          jid: string;
          isGroup: boolean;
          title: string;
          lastMessage?: string;
        }>;
      };

      if (!data.success || !data.data) {
        return [];
      }

      // Update recipient index
      for (const chat of data.data) {
        this.recipientIndex.set(chat.jid.toLowerCase(), {
          jid: chat.jid,
          title: chat.title,
          isGroup: chat.isGroup,
          updatedAt: Date.now(),
        });
        this.recipientIndex.set(chat.title.toLowerCase(), {
          jid: chat.jid,
          title: chat.title,
          isGroup: chat.isGroup,
          updatedAt: Date.now(),
        });
      }

      return data.data.map((chat) => ({
        id: chat.id,
        jid: chat.jid,
        isGroup: chat.isGroup,
        title: chat.title,
        lastMessage: chat.lastMessage,
        raw: chat,
      }));
    }, this.env);
  }

  // List groups from API
  async listGroups(): Promise<ChatSummary[]> {
    return await withAutoRefresh(async (session) => {
      const url = `${ELYMENTS_ENDPOINTS.chat}Group/List`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to list groups: ${response.status}`);
      }

      const data = (await response.json()) as {
        success: boolean;
        data?: Array<{
          id: string;
          jid: string;
          title: string;
          lastMessage?: string;
        }>;
      };

      if (!data.success || !data.data) {
        return [];
      }

      // Update recipient index
      for (const group of data.data) {
        const jid = formatGroupJid(group.jid);
        this.recipientIndex.set(jid.toLowerCase(), {
          jid,
          title: group.title,
          isGroup: true,
          updatedAt: Date.now(),
        });
        this.recipientIndex.set(group.title.toLowerCase(), {
          jid,
          title: group.title,
          isGroup: true,
          updatedAt: Date.now(),
        });
      }

      return data.data.map((group) => ({
        id: group.id,
        jid: formatGroupJid(group.jid),
        isGroup: true,
        title: group.title,
        lastMessage: group.lastMessage,
        raw: group,
      }));
    }, this.env);
  }

  // Resolve recipient by name, phone, or JID
  async resolveRecipient(query: string): Promise<ResolvedRecipient | null> {
    const normalized = query.toLowerCase().trim();

    // Direct JID match
    if (normalized.includes("@localhost") || normalized.includes("@muclight.localhost")) {
      const existing = this.recipientIndex.get(normalized);
      return {
        jid: normalized,
        isGroup: isElymentsGroup(normalized),
        title: existing?.title || normalized,
      };
    }

    // Check index
    const entry = this.recipientIndex.get(normalized);
    if (entry) {
      return {
        jid: entry.jid,
        isGroup: entry.isGroup,
        title: entry.title,
      };
    }

    // Try to refresh chats and retry
    await this.listChats();
    await this.listGroups();

    const refreshedEntry = this.recipientIndex.get(normalized);
    if (refreshedEntry) {
      return {
        jid: refreshedEntry.jid,
        isGroup: refreshedEntry.isGroup,
        title: refreshedEntry.title,
      };
    }

    return null;
  }

  // Sync contacts from server
  async syncContacts(): Promise<void> {
    await withAutoRefresh(async (session) => {
      const url = `${ELYMENTS_ENDPOINTS.chat}Contact/Sync`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`Failed to sync contacts: ${response.status}`);
      }
    }, this.env);
  }

  // Get message history
  async getHistory(jid: string, limit = 50): Promise<XmppMessageEvent[]> {
    return await withAutoRefresh(async (session) => {
      const url = `${ELYMENTS_ENDPOINTS.chat}Message/History`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          jid,
          limit,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get history: ${response.status}`);
      }

      const data = (await response.json()) as {
        success: boolean;
        data?: Array<{
          id: string;
          from: string;
          to: string;
          type: string;
          body: string;
          timestamp: number;
          senderName?: string;
        }>;
      };

      if (!data.success || !data.data) {
        return [];
      }

      return data.data.map((msg) => ({
        id: msg.id,
        from: msg.from,
        to: msg.to,
        type: (msg.type || "chat") as "chat" | "groupchat",
        body: msg.body || "",
        timestamp: msg.timestamp,
        senderName: msg.senderName,
      }));
    }, this.env);
  }

  // Update profile
  async updateProfile(senderName: string): Promise<void> {
    const session = loadElymentsSession(this.env);
    if (!session) throw new Error("Not logged in");

    saveElymentsProfile(
      {
        senderName,
        userId: session.userId,
        updatedAt: Date.now(),
      },
      this.env,
    );
  }

  // Get current user ID
  getUserId(): string | null {
    const session = loadElymentsSession(this.env);
    return session?.userId || null;
  }
}

// Shared client instance
let sharedClient: ElymentsClient | null = null;

export function getSharedElymentsClient(env?: NodeJS.ProcessEnv): ElymentsClient {
  if (!sharedClient) {
    sharedClient = new ElymentsClient(env);
  }
  return sharedClient;
}

export function setSharedElymentsClient(client: ElymentsClient | null): void {
  sharedClient = client;
}
