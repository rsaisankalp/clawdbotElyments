import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { ElymentsMediaInfo } from "../types.js";
import { ELYMENTS_ENDPOINTS } from "../types.js";
import { getSharedElymentsClient } from "./client.js";
import { withAutoRefresh } from "./auth.js";
import { loadElymentsProfile } from "./credentials.js";
import { formatDirectJid, formatGroupJid, isElymentsGroup } from "./xmpp.js";

export type SendMessageResult = {
  messageId: string;
  to: string;
};

// Send a text message
export async function sendMessageElyments(
  to: string,
  text: string,
  opts?: {
    senderName?: string;
    mediaUrl?: string;
  },
): Promise<SendMessageResult> {
  const client = getSharedElymentsClient();

  if (!client.isConnected()) {
    throw new Error("Elyments client not connected");
  }

  const jid = resolveTargetJid(to);
  const senderName = opts?.senderName || getSenderName();

  let messageId: string;

  if (opts?.mediaUrl) {
    // Upload media and send
    const media = await uploadMedia(opts.mediaUrl);
    messageId = await client.sendMedia(jid, media, text, senderName);
  } else {
    messageId = await client.sendText(jid, text, senderName);
  }

  return { messageId, to: jid };
}

// Send typing indicator
export async function sendTypingElyments(to: string, typing: boolean): Promise<void> {
  const client = getSharedElymentsClient();

  if (!client.isConnected()) return;

  const jid = resolveTargetJid(to);

  if (typing) {
    client.sendComposing(jid);
  } else {
    client.sendPaused(jid);
  }
}

// Resolve target to JID
function resolveTargetJid(target: string): string {
  const trimmed = target.trim();

  // Already a JID
  if (trimmed.includes("@localhost") || trimmed.includes("@muclight.localhost")) {
    return trimmed;
  }

  // Check for group: prefix
  if (trimmed.toLowerCase().startsWith("group:")) {
    const groupId = trimmed.slice(6).trim();
    return formatGroupJid(groupId);
  }

  // Check for user: prefix
  if (trimmed.toLowerCase().startsWith("user:")) {
    const userId = trimmed.slice(5).trim();
    return formatDirectJid(userId);
  }

  // Default to direct message
  return formatDirectJid(trimmed);
}

// Get sender name
function getSenderName(): string {
  const profile = loadElymentsProfile();
  return profile?.senderName || process.env.ELYMENTS_SENDER_NAME || "Clawdbot";
}

// Upload media and get URL
async function uploadMedia(localPath: string): Promise<ElymentsMediaInfo> {
  return await withAutoRefresh(async (session) => {
    // Read file
    const buffer = fs.readFileSync(localPath);
    const filename = path.basename(localPath);
    const ext = path.extname(localPath).toLowerCase().slice(1);

    // Determine media type
    const mediaType = resolveMediaType(ext);
    const mimeType = resolveMimeType(ext);

    // Get upload URL
    const uploadUrl = await getUploadUrl(session.accessToken, filename, mimeType);

    // Upload to Azure blob storage
    await fetch(uploadUrl.sasUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        "x-ms-blob-type": "BlockBlob",
      },
      body: buffer,
    });

    return {
      type: mediaType,
      url: uploadUrl.url,
      id: uploadUrl.id,
      name: filename,
      size: buffer.length,
      mimeType,
    };
  });
}

// Get upload URL from Elyments API
async function getUploadUrl(
  accessToken: string,
  filename: string,
  mimeType: string,
): Promise<{ url: string; sasUrl: string; id: string }> {
  const id = crypto.randomUUID();
  const url = `${ELYMENTS_ENDPOINTS.chat}Media/UploadUrl`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      id,
      filename,
      contentType: mimeType,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get upload URL: ${response.status}`);
  }

  const data = (await response.json()) as {
    success: boolean;
    data?: {
      url: string;
      sasUrl: string;
    };
  };

  if (!data.success || !data.data) {
    throw new Error("Failed to get upload URL");
  }

  return {
    url: data.data.url,
    sasUrl: data.data.sasUrl,
    id,
  };
}

// Resolve media type from extension
function resolveMediaType(ext: string): ElymentsMediaInfo["type"] {
  switch (ext) {
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "webp":
      return "image";
    case "mp4":
    case "webm":
    case "mov":
    case "avi":
      return "video";
    case "mp3":
    case "ogg":
    case "wav":
    case "m4a":
    case "aac":
      return "audio";
    default:
      return "document";
  }
}

// Resolve MIME type from extension
function resolveMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

// Normalize target for messaging
export function normalizeElymentsTarget(raw: string): string | undefined {
  let normalized = raw.trim();
  if (!normalized) return undefined;

  // Remove elyments: prefix if present
  if (normalized.toLowerCase().startsWith("elyments:")) {
    normalized = normalized.slice("elyments:".length).trim();
  }

  // Handle various formats
  if (normalized.includes("@localhost") || normalized.includes("@muclight.localhost")) {
    return normalized;
  }

  if (normalized.toLowerCase().startsWith("group:")) {
    const groupId = normalized.slice(6).trim();
    return `group:${groupId}`;
  }

  if (normalized.toLowerCase().startsWith("user:")) {
    const userId = normalized.slice(5).trim();
    return `user:${userId}`;
  }

  return normalized;
}

// Check if target looks like an Elyments ID
export function looksLikeElymentsTarget(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;

  // JID format
  if (trimmed.includes("@localhost") || trimmed.includes("@muclight.localhost")) {
    return true;
  }

  // Prefixed format
  if (/^(elyments:|group:|user:)/i.test(trimmed)) {
    return true;
  }

  return false;
}
