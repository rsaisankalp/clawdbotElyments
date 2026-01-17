import type { CoreConfig, ResolvedElymentsAccount, ElymentsChannelConfig } from "../types.js";
import { DEFAULT_ACCOUNT_ID } from "clawdbot/dist/routing/session-key.js";
import { elymentsCredentialsExist, loadElymentsProfile } from "./credentials.js";

export type { ResolvedElymentsAccount };

// List all configured Elyments account IDs
export function listElymentsAccountIds(cfg: CoreConfig): string[] {
  const elyments = cfg.channels?.elyments;
  if (!elyments) return [];

  // For now, Elyments only supports a single account (default)
  if (elyments.enabled === false) return [];

  return [DEFAULT_ACCOUNT_ID];
}

// Resolve the default account ID
export function resolveDefaultElymentsAccountId(cfg: CoreConfig): string {
  const ids = listElymentsAccountIds(cfg);
  return ids[0] || DEFAULT_ACCOUNT_ID;
}

// Resolve a specific Elyments account
export function resolveElymentsAccount(params: {
  cfg: CoreConfig;
  accountId?: string;
}): ResolvedElymentsAccount {
  const { cfg, accountId } = params;
  const resolvedAccountId = accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const elyments = cfg.channels?.elyments ?? {};
  const profile = loadElymentsProfile();

  const config: ElymentsChannelConfig = {
    enabled: elyments.enabled,
    name: elyments.name,
    senderName: elyments.senderName || profile?.senderName,
    phoneNumber: elyments.phoneNumber,
    countryCode: elyments.countryCode,
    dm: elyments.dm,
    groupPolicy: elyments.groupPolicy,
    groups: elyments.groups,
    actions: elyments.actions,
  };

  const configured = elymentsCredentialsExist();

  return {
    accountId: resolvedAccountId,
    name: config.name,
    enabled: config.enabled !== false,
    configured,
    phoneNumber: config.phoneNumber,
    countryCode: config.countryCode,
    senderName: config.senderName,
    config,
    dmPolicy: config.dm?.policy ?? "pairing",
    allowFrom: config.dm?.allowFrom ?? [],
    groupPolicy: config.groupPolicy ?? "allowlist",
    groups: config.groups,
  };
}

// Check if Elyments channel is enabled
export function isElymentsEnabled(cfg: CoreConfig): boolean {
  return cfg.channels?.elyments?.enabled !== false;
}

// Get sender name from config or profile
export function getElymentsSenderName(cfg: CoreConfig): string {
  const elyments = cfg.channels?.elyments;
  if (elyments?.senderName) return elyments.senderName;

  const profile = loadElymentsProfile();
  if (profile?.senderName) return profile.senderName;

  return process.env.ELYMENTS_SENDER_NAME || "Clawdbot";
}
