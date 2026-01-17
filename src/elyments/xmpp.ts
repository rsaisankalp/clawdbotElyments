import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { ElymentsSession, ElymentsMediaInfo } from "../types.js";
import { ELYMENTS_ENDPOINTS } from "../types.js";

// Patch global WebSocket for @xmpp/client to use custom headers
const OriginalWebSocket = globalThis.WebSocket;
function createPatchedWebSocket(origin: string) {
  return class PatchedWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, {
        headers: {
          Origin: origin,
        },
        // Elyments has cert issues, disable verification (as original SDK does)
        rejectUnauthorized: false,
      });
    }
  } as unknown as typeof globalThis.WebSocket;
}

function patchWebSocket(origin: string): void {
  globalThis.WebSocket = createPatchedWebSocket(origin);
}

function restoreWebSocket(): void {
  if (OriginalWebSocket) {
    globalThis.WebSocket = OriginalWebSocket;
  }
}

// Types for xmpp.js library
type XmppClient = {
  start(): Promise<unknown>;
  stop(): Promise<void>;
  send(stanza: unknown): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  removeAllListeners(): void;
};

export type XmppMessageEvent = {
  id: string;
  from: string;
  to: string;
  type: "chat" | "groupchat";
  body: string;
  timestamp: number;
  senderName?: string;
  media?: ElymentsMediaInfo;
  raw?: unknown;
};

export type XmppClientEvents = {
  message: [XmppMessageEvent];
  online: [];
  offline: [];
  error: [Error];
  connecting: [];
  connected: [];
  disconnected: [{ reason?: string }];
};

export class ElymentsXmppClient extends EventEmitter<XmppClientEvents> {
  private session: ElymentsSession;
  private resource: string;
  private xmpp: XmppClient | null = null;
  private connected = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private messageId = 0;

  constructor(session: ElymentsSession, resource: string) {
    super();
    this.session = session;
    this.resource = resource;
  }

  async connect(): Promise<void> {
    if (this.connected || this.xmpp) {
      return;
    }

    this.emit("connecting");

    // Patch WebSocket to add Origin header (required by Elyments)
    patchWebSocket("https://chat.elyments.com");

    try {
      // Dynamic import the @xmpp/client library
      const xmppModule = await import("@xmpp/client");
      const { client, xml } = xmppModule;

      // Create XMPP client
      this.xmpp = client({
        service: ELYMENTS_ENDPOINTS.xmpp,
        domain: "localhost",
        resource: this.resource,
        username: this.session.userId,
        password: this.session.chatAccessToken,
      }) as XmppClient;

    // Set up event handlers
    this.xmpp.on("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit("error", error);
    });

    this.xmpp.on("offline", () => {
      this.connected = false;
      this.stopPing();
      this.emit("offline");
      this.emit("disconnected", { reason: "offline" });
    });

    this.xmpp.on("online", async (jid: unknown) => {
      this.connected = true;
      this.emit("connected");
      this.emit("online");

      // Start XMPP session, send presence, enable carbons, request roster
      await this.initializeSession().catch((err) => {
        console.error("[elyments] session init error:", err);
      });

      this.startPing();
    });

    this.xmpp.on("stanza", (stanza: unknown) => {
      this.handleStanza(stanza);
    });

      // Connect
      await this.xmpp.start();
    } finally {
      // Restore original WebSocket
      restoreWebSocket();
    }
  }

  private handleStanza(stanza: unknown): void {
    // Type guard for stanza object
    if (!stanza || typeof stanza !== "object") return;

    const s = stanza as {
      name?: string;
      attrs?: Record<string, string>;
      getChild?: (name: string, ns?: string) => unknown;
      getChildText?: (name: string) => string | null;
    };

    if (s.name !== "message") return;

    const attrs = s.attrs || {};
    const from = attrs.from || "";
    const to = attrs.to || "";
    const id = attrs.id || `msg-${Date.now()}`;
    const type = (attrs.type || "chat") as "chat" | "groupchat";

    // Skip messages from self
    if (from.includes(this.session.userId)) return;

    // Get body text - may be direct or in MAM result
    let rawBody = s.getChildText?.("body") || "";
    let timestamp = Date.now();

    // Check for MAM (Message Archive Management) result
    const mamResult = s.getChild?.("result", "urn:xmpp:mam:2");
    if (mamResult && typeof mamResult === "object") {
      const mr = mamResult as { getChild?: (name: string, ns?: string) => unknown };
      const forwarded = mr.getChild?.("forwarded", "urn:xmpp:forward:0");
      if (forwarded && typeof forwarded === "object") {
        const fwd = forwarded as {
          getChild?: (name: string, ns?: string) => unknown;
        };
        const innerMsg = fwd.getChild?.("message");
        if (innerMsg && typeof innerMsg === "object") {
          const inner = innerMsg as { getChildText?: (name: string) => string | null };
          rawBody = inner.getChildText?.("body") || rawBody;
        }
        // Extract delay timestamp
        const delay = fwd.getChild?.("delay", "urn:xmpp:delay");
        if (delay && typeof delay === "object") {
          const d = delay as { attrs?: { stamp?: string } };
          if (d.attrs?.stamp) {
            timestamp = new Date(d.attrs.stamp).getTime();
          }
        }
      }
    }

    if (!rawBody) return;

    console.log("[elyments] message from:", from, "rawBody:", rawBody.slice(0, 100));

    // Parse body as JSON (Elyments format)
    let body = rawBody;
    let senderName: string | undefined;
    let messageId: string | undefined;

    try {
      const parsed = JSON.parse(rawBody) as {
        info?: { message?: string; caption?: string };
        senderName?: string;
        sender_name?: string;
        id?: string;
      };
      body = parsed?.info?.message || parsed?.info?.caption || rawBody;
      senderName = parsed?.senderName ?? parsed?.sender_name;
      messageId = parsed?.id;
    } catch {
      // Body is not JSON, use as-is
      body = rawBody;
    }

    const event: XmppMessageEvent = {
      id: messageId || id,
      from,
      to,
      type,
      body,
      timestamp,
      senderName,
      raw: stanza,
    };

    this.emit("message", event);
  }

  // Initialize XMPP session with presence, carbons, and roster
  private async initializeSession(): Promise<void> {
    if (!this.xmpp) return;

    const { xml } = await import("@xmpp/client");

    // 1. Start session
    const sessionId = this.nextId();
    const sessionIq = xml(
      "iq",
      { xmlns: "jabber:client", id: sessionId, type: "set" },
      xml("session", { xmlns: "urn:ietf:params:xml:ns:xmpp-session" })
    );
    await this.xmpp.send(sessionIq);

    // 2. Send presence (required for server to deliver messages)
    const presence = xml(
      "presence",
      { xmlns: "jabber:client" },
      xml("show", {}, "chat"),
      xml("priority", {}, "10")
    );
    await this.xmpp.send(presence);
    console.log("[elyments] presence sent");

    // 3. Enable carbons (to receive copies of messages)
    const carbonsId = this.nextId();
    const carbonsIq = xml(
      "iq",
      { xmlns: "jabber:client", id: carbonsId, type: "set" },
      xml("enable", { xmlns: "urn:xmpp:carbons:2" })
    );
    await this.xmpp.send(carbonsIq);

    // 4. Request roster (contact list)
    const rosterId = this.nextId();
    const rosterIq = xml(
      "iq",
      { xmlns: "jabber:client", id: rosterId, type: "get" },
      xml("query", { xmlns: "jabber:iq:roster" })
    );
    await this.xmpp.send(rosterIq);

    console.log("[elyments] session initialized");
  }

  private async startPing(): Promise<void> {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Import xml helper
    const { xml } = await import("@xmpp/client");

    // Send ping every 30 seconds to keep connection alive
    this.pingInterval = setInterval(async () => {
      if (this.connected && this.xmpp) {
        try {
          const id = this.nextId();
          const ping = xml("iq", { type: "get", id }, xml("ping", { xmlns: "urn:xmpp:ping" }));
          await this.xmpp.send(ping);
        } catch {
          // Ignore ping errors
        }
      }
    }, 30_000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private nextId(): string {
    return `clawdbot-${++this.messageId}`;
  }

  // Send a text message
  async sendText(jid: string, text: string, senderName?: string): Promise<string> {
    if (!this.xmpp || !this.connected) {
      throw new Error("Not connected");
    }

    const { xml } = await import("@xmpp/client");
    const crypto = await import("node:crypto");

    const stanzaId = this.nextId();
    const bodyId = crypto.randomBytes(16).toString("hex").toUpperCase();
    const isGroup = jid.includes("@muclight.localhost");
    const type = isGroup ? "groupchat" : "chat";

    // Elyments expects JSON body format
    const body = JSON.stringify({
      senderName: senderName || "Clawdbot",
      ver: 1,
      info: { message: text },
      id: bodyId,
      type: "text",
      lang: "en",
      isFwd: false,
      origin: "W|NodeJS|clawdbot",
    });

    const message = xml(
      "message",
      { xmlns: "jabber:client", id: stanzaId, to: jid, type },
      xml("origin-id", { xmlns: "urn:xmpp:sid:0", id: stanzaId }),
      xml("body", {}, body)
    );
    await this.xmpp.send(message);

    return bodyId;
  }

  // Send a media message
  async sendMedia(
    jid: string,
    media: ElymentsMediaInfo,
    caption?: string,
    senderName?: string
  ): Promise<string> {
    if (!this.xmpp || !this.connected) {
      throw new Error("Not connected");
    }

    const { xml } = await import("@xmpp/client");

    const id = this.nextId();
    const isGroup = jid.includes("@muclight.localhost");
    const type = isGroup ? "groupchat" : "chat";

    const children: unknown[] = [];

    if (caption) {
      children.push(xml("body", {}, caption));
    }

    // Media element
    const mediaAttrs: Record<string, string | number> = {
      xmlns: "elyments:media",
      type: media.type,
      url: media.url,
      id: media.id,
    };
    if (media.name) mediaAttrs.name = media.name;
    if (media.size) mediaAttrs.size = media.size;
    if (media.mimeType) mediaAttrs.mimeType = media.mimeType;
    if (media.duration) mediaAttrs.duration = media.duration;
    if (media.thumbnail) mediaAttrs.thumbnail = media.thumbnail;

    children.push(xml("x", mediaAttrs));

    if (senderName) {
      children.push(xml("nick", { xmlns: "http://jabber.org/protocol/nick" }, senderName));
    }

    const message = xml("message", { type, to: jid, id }, ...children);
    await this.xmpp.send(message);

    return id;
  }

  // Send typing indicator
  async sendComposing(jid: string): Promise<void> {
    if (!this.xmpp || !this.connected) return;

    const { xml } = await import("@xmpp/client");

    const isGroup = jid.includes("@muclight.localhost");
    const type = isGroup ? "groupchat" : "chat";
    const message = xml(
      "message",
      { type, to: jid },
      xml("composing", { xmlns: "http://jabber.org/protocol/chatstates" })
    );
    await this.xmpp.send(message);
  }

  // Send paused typing indicator
  async sendPaused(jid: string): Promise<void> {
    if (!this.xmpp || !this.connected) return;

    const { xml } = await import("@xmpp/client");

    const isGroup = jid.includes("@muclight.localhost");
    const type = isGroup ? "groupchat" : "chat";
    const message = xml(
      "message",
      { type, to: jid },
      xml("paused", { xmlns: "http://jabber.org/protocol/chatstates" })
    );
    await this.xmpp.send(message);
  }

  // Update session (e.g., after token refresh)
  updateSession(session: ElymentsSession): void {
    this.session = session;
  }

  // Check if connected
  isConnected(): boolean {
    return this.connected;
  }

  // Disconnect gracefully
  async disconnect(): Promise<void> {
    this.stopPing();
    if (this.xmpp) {
      try {
        await this.xmpp.stop();
      } catch {
        // Ignore stop errors
      }
      this.xmpp = null;
    }
    this.connected = false;
  }
}

// Check if a JID is a group
export function isElymentsGroup(jid: string): boolean {
  return jid.includes("@muclight.localhost");
}

// Extract user ID from JID
export function extractUserId(jid: string): string {
  const parts = jid.split("@");
  return parts[0] || jid;
}

// Format JID for direct message
export function formatDirectJid(userId: string): string {
  if (userId.includes("@")) return userId;
  return `${userId}@localhost`;
}

// Format JID for group chat
export function formatGroupJid(groupId: string): string {
  if (groupId.includes("@muclight.localhost")) return groupId;
  return `${groupId}@muclight.localhost`;
}
