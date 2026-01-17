import type { ClawdbotConfig } from "clawdbot/dist/config/types.plugins.js";

// Elyments session stored after authentication
export type ElymentsSession = {
  userId: string;
  accessToken: string;
  chatAccessToken: string;
  refreshToken: string;
  savedAt: number;
};

// Device information for authentication
export type ElymentsDevice = {
  deviceId: string;
  deviceToken: string;
  platformType: "WEB" | "MOBILE";
  resource: string;
  createdAt: number;
};

// User profile information
export type ElymentsProfile = {
  senderName: string;
  userId: string;
  updatedAt: number;
};

// OTP request parameters
export type OtpRequest = {
  countryCode: string;
  phoneNumber: string;
};

// OTP verification request
export type OtpVerifyRequest = OtpRequest & {
  otp: string;
  deviceToken?: string;
  platformType?: "WEB" | "MOBILE";
};

// Chat summary from chat list
export type ChatSummary = {
  id: string;
  jid: string;
  isGroup: boolean;
  title: string;
  lastMessage?: string;
  raw?: unknown;
};

// Elyments message structure
export type ElymentsMessage = {
  id: string;
  jid: string;
  from: string;
  to: string;
  type: "chat" | "groupchat";
  body?: string;
  timestamp: number;
  senderName?: string;
  media?: ElymentsMediaInfo;
};

// Media information
export type ElymentsMediaInfo = {
  type: "image" | "video" | "audio" | "document";
  url: string;
  id: string;
  name?: string;
  size?: number;
  mimeType?: string;
  duration?: number;
  thumbnail?: string;
};

// Recipient resolution
export type RecipientEntry = {
  jid: string;
  title: string;
  isGroup: boolean;
  phones?: string[];
  updatedAt: number;
};

export type ResolvedRecipient = {
  jid: string;
  isGroup: boolean;
  title: string;
};

// Configuration for Elyments channel
export type ElymentsChannelConfig = {
  enabled?: boolean;
  name?: string;
  senderName?: string;
  phoneNumber?: string;
  countryCode?: string;
  // DM policy configuration
  dm?: {
    enabled?: boolean;
    policy?: "open" | "allowlist" | "pairing" | "disabled";
    allowFrom?: string[];
  };
  // Group policy configuration
  groupPolicy?: "open" | "allowlist" | "disabled";
  groups?: Record<
    string,
    {
      enabled?: boolean;
      requireMention?: boolean;
      autoReply?: boolean;
      users?: string[];
      systemPrompt?: string;
      skills?: string[];
    }
  >;
  // Actions configuration
  actions?: {
    reactions?: boolean;
  };
};

// Extended config type with Elyments
export type CoreConfig = ClawdbotConfig & {
  channels?: ClawdbotConfig["channels"] & {
    elyments?: ElymentsChannelConfig;
  };
};

// Resolved account type
export type ResolvedElymentsAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  phoneNumber?: string;
  countryCode?: string;
  senderName?: string;
  config: ElymentsChannelConfig;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  allowFrom?: string[];
  groupPolicy?: "open" | "allowlist" | "disabled";
  groups?: ElymentsChannelConfig["groups"];
};

// Runtime status
export type ElymentsRuntimeStatus = {
  accountId: string;
  running: boolean;
  connected: boolean;
  lastStartAt: number | null;
  lastStopAt: number | null;
  lastError: string | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
};

// Elyments API endpoints
export const ELYMENTS_ENDPOINTS = {
  identity: "https://identityapi.elyments.com/api/Identity/",
  chat: "https://chatapi.elyments.com/api/",
  xmpp: "wss://chatim.elyments.com:5285/ws-xmpp",
} as const;

// Send text request
export type SendTextRequest = {
  jid: string;
  text: string;
  senderName: string;
  isGroup?: boolean;
  language?: string;
};

// Send media request
export type SendMediaRequest = SendTextRequest & {
  media: ElymentsMediaInfo;
};

// Inbound message event
export type ElymentsInboundMessage = {
  id: string;
  from: string;
  to: string;
  chatId: string;
  chatType: "direct" | "group";
  body: string;
  senderName?: string;
  senderJid?: string;
  groupSubject?: string;
  groupParticipants?: string[];
  timestamp: number;
  mediaPath?: string;
  mediaType?: string;
  raw?: unknown;
};
