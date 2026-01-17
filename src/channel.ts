import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";
import {
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "../../../src/channels/plugins/config-helpers.js";
import { buildChannelConfigSchema } from "../../../src/channels/plugins/config-schema.js";
import { formatPairingApproveHint } from "../../../src/channels/plugins/helpers.js";
import { PAIRING_APPROVED_MESSAGE } from "../../../src/channels/plugins/pairing-message.js";
import { applyAccountNameToChannelSection } from "../../../src/channels/plugins/setup-helpers.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../../../src/routing/session-key.js";

import { ElymentsConfigSchema } from "./config-schema.js";
import type { CoreConfig, ResolvedElymentsAccount } from "./types.js";
import {
  listElymentsAccountIds,
  resolveDefaultElymentsAccountId,
  resolveElymentsAccount,
} from "./elyments/accounts.js";
import {
  elymentsCredentialsExist,
  loadElymentsSession,
  clearElymentsCredentials,
} from "./elyments/credentials.js";
import {
  sendMessageElyments,
  normalizeElymentsTarget,
  looksLikeElymentsTarget,
} from "./elyments/send.js";
import { isElymentsGroup, formatDirectJid } from "./elyments/xmpp.js";
import { elymentsOnboardingAdapter } from "./onboarding.js";
import { elymentsOutbound } from "./outbound.js";

const meta = {
  id: "elyments",
  label: "Elyments",
  selectionLabel: "Elyments (plugin)",
  docsPath: "/channels/elyments",
  docsLabel: "elyments",
  blurb: "Indian social platform; authenticate via OTP.",
  order: 80,
  quickstartAllowFrom: true,
};

function normalizeElymentsMessagingTarget(raw: string): string | undefined {
  let normalized = raw.trim();
  if (!normalized) return undefined;
  if (normalized.toLowerCase().startsWith("elyments:")) {
    normalized = normalized.slice("elyments:".length).trim();
  }
  return normalized ? normalized.toLowerCase() : undefined;
}

function buildElymentsConfigUpdate(
  cfg: CoreConfig,
  input: {
    phoneNumber?: string;
    countryCode?: string;
    senderName?: string;
  },
): CoreConfig {
  const existing = cfg.channels?.elyments ?? {};
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      elyments: {
        ...existing,
        enabled: true,
        ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        ...(input.senderName ? { senderName: input.senderName } : {}),
      },
    },
  };
}

export const elymentsPlugin: ChannelPlugin<ResolvedElymentsAccount> = {
  id: "elyments",
  meta,
  onboarding: elymentsOnboardingAdapter,
  pairing: {
    idLabel: "elymentsUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^elyments:/i, ""),
    notifyApproval: async ({ id }) => {
      await sendMessageElyments(`user:${id}`, PAIRING_APPROVED_MESSAGE);
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    polls: false,
    reactions: false,
    media: true,
  },
  reload: { configPrefixes: ["channels.elyments"] },
  configSchema: buildChannelConfigSchema(ElymentsConfigSchema),
  config: {
    listAccountIds: (cfg) => listElymentsAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveElymentsAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultElymentsAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "elyments",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "elyments",
        accountId,
        clearBaseFields: ["name", "phoneNumber", "countryCode", "senderName"],
      }),
    isConfigured: () => elymentsCredentialsExist(),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      phoneNumber: account.phoneNumber,
    }),
    resolveAllowFrom: ({ cfg }) =>
      ((cfg as CoreConfig).channels?.elyments?.dm?.allowFrom ?? []).map((entry) =>
        String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean),
  },
  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.dmPolicy ?? "pairing",
      allowFrom: account.allowFrom ?? [],
      policyPath: "channels.elyments.dm.policy",
      allowFromPath: "channels.elyments.dm.allowFrom",
      approveHint: formatPairingApproveHint("elyments"),
      normalizeEntry: (raw) => raw.replace(/^elyments:/i, "").trim().toLowerCase(),
    }),
    collectWarnings: ({ account }) => {
      const groupPolicy = account.groupPolicy ?? "allowlist";
      if (groupPolicy !== "open") return [];
      return [
        '- Elyments groups: groupPolicy="open" allows any group to trigger (mention-gated). Set channels.elyments.groupPolicy="allowlist" + channels.elyments.groups to restrict groups.',
      ];
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, groupId, accountId }) => {
      const account = resolveElymentsAccount({ cfg: cfg as CoreConfig, accountId });
      const groups = account?.groups ?? {};
      const groupConfig = groups[groupId];
      if (!groupConfig) return true;
      if (groupConfig.autoReply === true) return false;
      if (groupConfig.autoReply === false) return true;
      return groupConfig.requireMention !== false;
    },
  },
  messaging: {
    normalizeTarget: normalizeElymentsMessagingTarget,
    looksLikeTargetId: looksLikeElymentsTarget,
    targetHint: "<user JID|group JID>",
  },
  directory: {
    self: async () => {
      const session = loadElymentsSession();
      if (!session) return null;
      return {
        kind: "user",
        id: session.userId,
        name: session.userId,
        raw: { userId: session.userId },
      };
    },
    listPeers: async ({ cfg, query, limit }) => {
      const account = resolveElymentsAccount({ cfg: cfg as CoreConfig });
      const q = query?.trim().toLowerCase() || "";
      const ids = new Set<string>();

      for (const entry of account.allowFrom ?? []) {
        const raw = String(entry).trim();
        if (!raw || raw === "*") continue;
        ids.add(raw.replace(/^elyments:/i, "").toLowerCase());
      }

      return Array.from(ids)
        .filter((id) => !isElymentsGroup(id))
        .filter((id) => (q ? id.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({
          kind: "user",
          id: id.includes("@") ? id : formatDirectJid(id),
        }));
    },
    listGroups: async ({ cfg, query, limit }) => {
      const account = resolveElymentsAccount({ cfg: cfg as CoreConfig });
      const q = query?.trim().toLowerCase() || "";
      const groups = Object.keys(account.groups ?? {})
        .map((id) => id.trim())
        .filter((id) => Boolean(id) && id !== "*")
        .filter((id) => (q ? id.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "group", id }) as const);
      return groups;
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg: cfg as CoreConfig,
        channelKey: "elyments",
        accountId,
        name,
      }),
    validateInput: ({ input }) => {
      // Elyments uses OTP auth, so we don't require credentials in config
      return null;
    },
    applyAccountConfig: ({ cfg, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg: cfg as CoreConfig,
        channelKey: "elyments",
        accountId: DEFAULT_ACCOUNT_ID,
        name: input.name,
      });
      return buildElymentsConfigUpdate(namedConfig as CoreConfig, {
        phoneNumber: input.phoneNumber?.trim(),
        countryCode: input.countryCode?.trim(),
        senderName: input.senderName?.trim(),
      });
    },
  },
  outbound: elymentsOutbound,
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        const lastError =
          typeof account.lastError === "string" ? account.lastError.trim() : "";
        if (!lastError) return [];
        return [
          {
            channel: "elyments",
            accountId: account.accountId,
            kind: "runtime",
            message: `Channel error: ${lastError}`,
          },
        ];
      }),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      connected: snapshot.connected ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      phoneNumber: account.phoneNumber,
      running: runtime?.running ?? false,
      connected: runtime?.connected ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const session = loadElymentsSession();
      const identity = session?.userId || "unknown";
      ctx.log?.info(`[${account.accountId}] starting provider (${identity})`);

      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
      });

      // Lazy import to avoid ESM init cycles
      const { monitorElymentsProvider } = await import("./elyments/monitor.js");
      return monitorElymentsProvider({
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: account.accountId,
      });
    },
    logoutAccount: async () => {
      clearElymentsCredentials();
      return { cleared: true, loggedOut: true };
    },
  },
  auth: {
    login: async ({ runtime, verbose }) => {
      const { runElymentsOnboarding } = await import("./onboarding.js");
      const result = await runElymentsOnboarding(runtime);
      if (!result.success) {
        throw new Error(result.message || "Login failed");
      }
    },
  },
};
