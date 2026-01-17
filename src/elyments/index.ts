// Re-export main components
export { ElymentsClient, getSharedElymentsClient, setSharedElymentsClient } from "./client.js";
export { ElymentsXmppClient, isElymentsGroup, extractUserId, formatDirectJid, formatGroupJid } from "./xmpp.js";
export type { XmppMessageEvent, XmppClientEvents } from "./xmpp.js";

// Authentication
export { requestOtp, verifyOtp, refreshSession, getValidSession, withAutoRefresh } from "./auth.js";

// Credentials
export {
  loadElymentsSession,
  saveElymentsSession,
  deleteElymentsSession,
  touchElymentsSession,
  loadElymentsDevice,
  saveElymentsDevice,
  getOrCreateDevice,
  loadElymentsProfile,
  saveElymentsProfile,
  elymentsCredentialsExist,
  clearElymentsCredentials,
  isSessionValid,
  isTokenExpiring,
} from "./credentials.js";

// Accounts
export {
  listElymentsAccountIds,
  resolveDefaultElymentsAccountId,
  resolveElymentsAccount,
  isElymentsEnabled,
  getElymentsSenderName,
} from "./accounts.js";
export type { ResolvedElymentsAccount } from "./accounts.js";

// Sending messages
export {
  sendMessageElyments,
  sendTypingElyments,
  normalizeElymentsTarget,
  looksLikeElymentsTarget,
} from "./send.js";
export type { SendMessageResult } from "./send.js";

// Monitor
export { monitorElymentsProvider } from "./monitor.js";
export type { MonitorElymentsOpts } from "./monitor.js";
