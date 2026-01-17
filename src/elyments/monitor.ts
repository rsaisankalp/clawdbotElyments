import type { RuntimeEnv } from "../../../../src/runtime.js";
import type { CoreConfig, ElymentsInboundMessage } from "../types.js";
import {
  ElymentsClient,
  getSharedElymentsClient,
  setSharedElymentsClient,
} from "./client.js";
import { resolveElymentsAccount, getElymentsSenderName } from "./accounts.js";
import { elymentsCredentialsExist, loadElymentsSession } from "./credentials.js";
import { isElymentsGroup, extractUserId } from "./xmpp.js";
import type { XmppMessageEvent } from "./xmpp.js";
import { loadConfig } from "../../../../src/config/config.js";
import { resolveAgentRoute } from "../../../../src/routing/resolve-route.js";
import { formatAgentEnvelope } from "../../../../src/auto-reply/envelope.js";
import { finalizeInboundContext } from "../../../../src/auto-reply/reply/inbound-context.js";
import { dispatchReplyFromConfig } from "../../../../src/auto-reply/reply/dispatch-from-config.js";
import { createReplyDispatcherWithTyping } from "../../../../src/auto-reply/reply/reply-dispatcher.js";
import { resolveStorePath, updateLastRoute } from "../../../../src/config/sessions.js";
import { enqueueSystemEvent } from "../../../../src/infra/system-events.js";
import { logVerbose, shouldLogVerbose, danger } from "../../../../src/globals.js";
import { getChildLogger } from "../../../../src/logging.js";
import { chunkMarkdownText, resolveTextChunkLimit } from "../../../../src/auto-reply/chunk.js";
import {
  buildMentionRegexes,
  matchesMentionPatterns,
} from "../../../../src/auto-reply/reply/mentions.js";
import { hasControlCommand } from "../../../../src/auto-reply/command-detection.js";
import { shouldHandleTextCommands } from "../../../../src/auto-reply/commands-registry.js";
import { resolveCommandAuthorizedFromAuthorizers } from "../../../../src/channels/command-gating.js";
import {
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
} from "../../../../src/pairing/pairing-store.js";
import { resolveEffectiveMessagesConfig, resolveHumanDelayConfig } from "../../../../src/agents/identity.js";
import { sendMessageElyments, sendTypingElyments } from "./send.js";

export type MonitorElymentsOpts = {
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

export async function monitorElymentsProvider(opts: MonitorElymentsOpts = {}): Promise<void> {
  const cfg = loadConfig() as CoreConfig;
  if (cfg.channels?.elyments?.enabled === false) return;

  if (!elymentsCredentialsExist()) {
    throw new Error("Elyments not configured. Run `clawdbot setup elyments` first.");
  }

  const runtime: RuntimeEnv = opts.runtime ?? {
    log: console.log,
    error: console.error,
    exit: (code: number): never => {
      throw new Error(`exit ${code}`);
    },
  };

  const account = resolveElymentsAccount({ cfg, accountId: opts.accountId });
  const session = loadElymentsSession();
  if (!session) {
    throw new Error("No Elyments session found");
  }

  const client = getSharedElymentsClient();
  setSharedElymentsClient(client);

  const mentionRegexes = buildMentionRegexes(cfg);
  const logger = getChildLogger({ module: "elyments-auto-reply" });
  const groupPolicy = account.groupPolicy ?? "allowlist";
  const dmConfig = account.config.dm;
  const dmEnabled = dmConfig?.enabled ?? true;
  const dmPolicy = dmConfig?.policy ?? "pairing";
  const allowFrom = dmConfig?.allowFrom ?? [];
  const textLimit = resolveTextChunkLimit(cfg, "elyments");
  const startupMs = Date.now();
  const startupGraceMs = 0;
  const senderName = getElymentsSenderName(cfg);

  // Handle incoming messages
  const handleMessage = async (event: XmppMessageEvent) => {
    try {
      // Skip old messages
      if (event.timestamp < startupMs - startupGraceMs) {
        return;
      }

      const fromJid = event.from;
      const isGroup = isElymentsGroup(fromJid);
      const chatId = fromJid;
      const senderId = extractUserId(fromJid);
      const senderDisplayName = event.senderName || senderId;

      // Skip messages from self
      if (senderId === session.userId) return;

      // Check group policy
      if (isGroup && groupPolicy === "disabled") return;

      const bodyText = event.body?.trim() || "";
      if (!bodyText) return;

      // Check DM policy
      const storeAllowFrom = await readChannelAllowFromStore("elyments").catch(() => []);
      const effectiveAllowFrom = [...allowFrom, ...storeAllowFrom].map((e) =>
        String(e).toLowerCase().trim(),
      );

      if (!isGroup) {
        if (!dmEnabled || dmPolicy === "disabled") return;

        if (dmPolicy !== "open") {
          // Extract bare JID (without resource) for matching
          const bareJid = fromJid.split("/")[0].toLowerCase();
          const permitted =
            effectiveAllowFrom.length > 0 &&
            effectiveAllowFrom.some(
              (entry) =>
                entry === "*" ||
                entry === senderId.toLowerCase() ||
                entry === fromJid.toLowerCase() ||
                entry === bareJid, // Match bare JID (without resource)
            );

          if (!permitted) {
            if (dmPolicy === "pairing") {
              const { code, created } = await upsertChannelPairingRequest({
                channel: "elyments",
                id: senderId,
                meta: { name: senderDisplayName },
              });

              if (created) {
                try {
                  await sendMessageElyments(fromJid, [
                    "Clawdbot: access not configured.",
                    "",
                    `Pairing code: ${code}`,
                    "",
                    "Ask the bot owner to approve with:",
                    "clawdbot pairing approve elyments <code>",
                  ].join("\n"));
                } catch (err) {
                  logVerbose(`elyments pairing reply failed for ${senderId}: ${String(err)}`);
                }
              }
            }
            return;
          }
        }
      }

      // Check group allowlist
      if (isGroup && groupPolicy === "allowlist") {
        const groups = account.groups ?? {};
        const groupConfig = groups[chatId] || groups[senderId];
        if (!groupConfig) {
          logVerbose("elyments: drop group message (not in allowlist)");
          return;
        }
        if (groupConfig.enabled === false) {
          logVerbose("elyments: drop group message (disabled)");
          return;
        }

        // Check user allowlist within group
        if (groupConfig.users?.length) {
          const userAllowed = groupConfig.users.some(
            (entry) =>
              entry === "*" ||
              entry.toLowerCase() === senderId.toLowerCase() ||
              entry.toLowerCase() === senderDisplayName.toLowerCase(),
          );
          if (!userAllowed) {
            logVerbose(`elyments: blocked sender ${senderId} (group users allowlist)`);
            return;
          }
        }
      }

      // Get group config
      const groupConfigInfo = isGroup
        ? (account.groups ?? {})[chatId] || (account.groups ?? {})[senderId] || {}
        : {};

      // Check mention requirement
      const wasMentioned = matchesMentionPatterns(bodyText, mentionRegexes);
      const shouldRequireMention = isGroup
        ? groupConfigInfo.autoReply === true
          ? false
          : groupConfigInfo.autoReply === false
            ? true
            : groupConfigInfo.requireMention !== false
        : false;

      const allowTextCommands = shouldHandleTextCommands({
        cfg,
        surface: "elyments",
      });
      const useAccessGroups = cfg.commands?.useAccessGroups !== false;
      const senderAllowedForCommands = effectiveAllowFrom.some(
        (entry) =>
          entry === "*" ||
          entry === senderId.toLowerCase() ||
          entry === fromJid.toLowerCase(),
      );
      const commandAuthorized = resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers: [
          { configured: effectiveAllowFrom.length > 0, allowed: senderAllowedForCommands },
        ],
      });

      if (isGroup && allowTextCommands && hasControlCommand(bodyText, cfg) && !commandAuthorized) {
        logVerbose(`elyments: drop control command from unauthorized sender ${senderId}`);
        return;
      }

      const shouldBypassMention =
        allowTextCommands &&
        isGroup &&
        shouldRequireMention &&
        !wasMentioned &&
        commandAuthorized &&
        hasControlCommand(bodyText);

      if (isGroup && shouldRequireMention && !wasMentioned && !shouldBypassMention) {
        logger.info({ chatId, reason: "no-mention" }, "skipping group message");
        return;
      }

      // Build context
      const messageId = event.id || `msg-${Date.now()}`;
      const envelopeFrom = isGroup ? chatId : senderDisplayName;
      const textWithId = `${bodyText}\n[elyments message id: ${messageId} chat: ${chatId}]`;
      const body = formatAgentEnvelope({
        channel: "Elyments",
        from: envelopeFrom,
        timestamp: event.timestamp,
        body: textWithId,
      });

      const route = resolveAgentRoute({
        cfg,
        channel: "elyments",
        peer: {
          kind: isGroup ? "channel" : "dm",
          id: chatId,
        },
      });

      const groupSystemPrompt = isGroup ? groupConfigInfo.systemPrompt?.trim() : undefined;
      const ctxPayload = finalizeInboundContext({
        Body: body,
        RawBody: bodyText,
        CommandBody: bodyText,
        From: `elyments:${fromJid}`,
        To: `elyments:${chatId}`,
        SessionKey: route.sessionKey,
        AccountId: route.accountId,
        ChatType: isGroup ? "channel" : "direct",
        ConversationLabel: envelopeFrom,
        SenderName: senderDisplayName,
        SenderId: senderId,
        SenderUsername: senderId,
        GroupSubject: isGroup ? chatId : undefined,
        GroupRoom: isGroup ? chatId : undefined,
        GroupSystemPrompt: groupSystemPrompt,
        Provider: "elyments" as const,
        Surface: "elyments" as const,
        WasMentioned: isGroup ? wasMentioned : undefined,
        MessageSid: messageId,
        Timestamp: event.timestamp,
        CommandAuthorized: commandAuthorized,
        CommandSource: "text" as const,
        OriginatingChannel: "elyments" as const,
        OriginatingTo: `elyments:${chatId}`,
      });

      // Update last route for DMs
      if (!isGroup) {
        const storePath = resolveStorePath(cfg.session?.store, {
          agentId: route.agentId,
        });
        await updateLastRoute({
          storePath,
          sessionKey: route.mainSessionKey,
          channel: "elyments",
          to: `elyments:${chatId}`,
          accountId: route.accountId,
        });
      }

      if (shouldLogVerbose()) {
        const preview = bodyText.slice(0, 200).replace(/\n/g, "\\n");
        logVerbose(`elyments inbound: chat=${chatId} from=${senderId} preview="${preview}"`);
      }

      // Create reply dispatcher
      const replyTarget = ctxPayload.To;
      if (!replyTarget) {
        runtime.error?.(danger("elyments: missing reply target"));
        return;
      }

      let didSendReply = false;
      const { dispatcher, replyOptions, markDispatchIdle } = createReplyDispatcherWithTyping({
        responsePrefix: resolveEffectiveMessagesConfig(cfg, route.agentId).responsePrefix,
        humanDelay: resolveHumanDelayConfig(cfg, route.agentId),
        deliver: async (payload) => {
          await deliverElymentsReplies({
            replies: [payload],
            chatId,
            textLimit,
            senderName,
          });
          didSendReply = true;
        },
        onError: (err, info) => {
          runtime.error?.(danger(`elyments ${info.kind} reply failed: ${String(err)}`));
        },
        onReplyStart: () => sendTypingElyments(chatId, true).catch(() => {}),
        onIdle: () => sendTypingElyments(chatId, false).catch(() => {}),
      });

      const { queuedFinal, counts } = await dispatchReplyFromConfig({
        ctx: ctxPayload,
        cfg,
        dispatcher,
        replyOptions: {
          ...replyOptions,
          skillFilter: isGroup ? groupConfigInfo.skills : undefined,
        },
      });
      markDispatchIdle();

      if (!queuedFinal) return;
      didSendReply = true;

      if (shouldLogVerbose()) {
        const finalCount = counts.final;
        logVerbose(`elyments: delivered ${finalCount} reply${finalCount === 1 ? "" : "ies"} to ${replyTarget}`);
      }

      if (didSendReply) {
        const preview = bodyText.replace(/\s+/g, " ").slice(0, 160);
        enqueueSystemEvent(`Elyments message from ${senderDisplayName}: ${preview}`, {
          sessionKey: route.sessionKey,
          contextKey: `elyments:message:${chatId}:${messageId}`,
        });
      }
    } catch (err) {
      const stack = err instanceof Error ? err.stack : String(err);
      runtime.error?.(danger(`elyments handler failed: ${stack}`));
    }
  };

  // Set up event handlers
  client.on("message", handleMessage);
  client.on("error", (err) => {
    runtime.error?.(danger(`elyments error: ${err.message}`));
  });
  client.on("connected", () => {
    runtime.log?.(`elyments: connected as ${session.userId}`);
  });
  client.on("disconnected", ({ reason }) => {
    runtime.log?.(`elyments: disconnected (${reason || "unknown"})`);
  });

  // Connect to Elyments
  await client.connect();
  runtime.log?.(`elyments: logged in as ${session.userId}`);

  // Wait for abort signal
  await new Promise<void>((resolve) => {
    const onAbort = () => {
      try {
        client.disconnect();
      } finally {
        setSharedElymentsClient(null);
        resolve();
      }
    };
    if (opts.abortSignal?.aborted) {
      onAbort();
      return;
    }
    opts.abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Deliver replies to Elyments
async function deliverElymentsReplies(params: {
  replies: Array<{ text?: string; mediaUrl?: string }>;
  chatId: string;
  textLimit: number;
  senderName: string;
}): Promise<void> {
  const { replies, chatId, textLimit, senderName } = params;

  for (const reply of replies) {
    if (reply.text) {
      // Chunk text if needed
      const chunks = chunkMarkdownText(reply.text, textLimit);
      for (const chunk of chunks) {
        await sendMessageElyments(chatId, chunk, {
          senderName,
          mediaUrl: reply.mediaUrl,
        });
      }
    } else if (reply.mediaUrl) {
      await sendMessageElyments(chatId, "", {
        senderName,
        mediaUrl: reply.mediaUrl,
      });
    }
  }
}
