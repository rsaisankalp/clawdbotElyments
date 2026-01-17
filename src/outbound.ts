import type { ChannelOutboundAdapter } from "clawdbot/dist/channels/plugins/types.adapters.js";
import { chunkMarkdownText } from "clawdbot/dist/auto-reply/chunk.js";
import { missingTargetError } from "clawdbot/dist/infra/outbound/target-errors.js";
import {
  sendMessageElyments,
  normalizeElymentsTarget,
} from "./elyments/send.js";
import { isElymentsGroup, formatDirectJid, formatGroupJid } from "./elyments/xmpp.js";
import { getElymentsSenderName } from "./elyments/accounts.js";
import type { CoreConfig } from "./types.js";

export const elymentsOutbound: ChannelOutboundAdapter = {
  deliveryMode: "gateway",
  chunker: chunkMarkdownText,
  textChunkLimit: 4000,

  resolveTarget: ({ to, allowFrom, mode }) => {
    const trimmed = to?.trim() ?? "";
    const allowListRaw = (allowFrom ?? []).map((entry) => String(entry).trim()).filter(Boolean);
    const hasWildcard = allowListRaw.includes("*");
    const allowList = allowListRaw
      .filter((entry) => entry !== "*")
      .map((entry) => normalizeElymentsTarget(entry))
      .filter((entry): entry is string => Boolean(entry));

    if (trimmed) {
      const normalizedTo = normalizeElymentsTarget(trimmed);
      if (!normalizedTo) {
        if ((mode === "implicit" || mode === "heartbeat") && allowList.length > 0) {
          return { ok: true, to: allowList[0] };
        }
        return {
          ok: false,
          error: missingTargetError(
            "Elyments",
            "<user JID|group JID> or channels.elyments.dm.allowFrom[0]",
          ),
        };
      }

      // Check if it's a group
      if (normalizedTo.includes("@muclight.localhost") || normalizedTo.startsWith("group:")) {
        return { ok: true, to: normalizedTo };
      }

      if (mode === "implicit" || mode === "heartbeat") {
        if (hasWildcard || allowList.length === 0) {
          return { ok: true, to: normalizedTo };
        }
        if (allowList.includes(normalizedTo)) {
          return { ok: true, to: normalizedTo };
        }
        return { ok: true, to: allowList[0] };
      }

      return { ok: true, to: normalizedTo };
    }

    if (allowList.length > 0) {
      return { ok: true, to: allowList[0] };
    }

    return {
      ok: false,
      error: missingTargetError(
        "Elyments",
        "<user JID|group JID> or channels.elyments.dm.allowFrom[0]",
      ),
    };
  },

  sendText: async ({ to, text, cfg }) => {
    const senderName = getElymentsSenderName(cfg as CoreConfig);
    const result = await sendMessageElyments(to, text, { senderName });
    return { channel: "elyments", ...result };
  },

  sendMedia: async ({ to, text, mediaUrl, cfg }) => {
    const senderName = getElymentsSenderName(cfg as CoreConfig);
    const result = await sendMessageElyments(to, text || "", {
      senderName,
      mediaUrl,
    });
    return { channel: "elyments", ...result };
  },
};
