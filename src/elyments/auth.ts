import type { ElymentsSession, OtpRequest, OtpVerifyRequest } from "../types.js";
import { ELYMENTS_ENDPOINTS } from "../types.js";
import {
  getOrCreateDevice,
  loadElymentsSession,
  saveElymentsSession,
  isTokenExpiring,
} from "./credentials.js";

// Elyments client info header (mimics web client)
const ELYMENTS_CLIENT_INFO = JSON.stringify({
  applicationVersion: "143.0.0",
  deviceOSVersion: "Mac OS",
  deviceModel: "chrome",
  deviceOEMName: "browser",
  deviceType: "Web",
});

function buildClientHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
    "elyments-client-info": ELYMENTS_CLIENT_INFO,
    "referer": "https://web.elyments.com/",
    "origin": "https://web.elyments.com",
    ...extra,
  };
}

// V2 API response type (used for OTP request)
type OtpResponseV2 = {
  IsSuccess?: boolean;
  Message?: string;
  ResponseData?: unknown;
};

// Normalize phone number (extract digits, return last 10)
function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Parse response that might be JSON or plain text
async function parseResponse<T>(response: Response): Promise<T | string> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text;
  }
}

// Request OTP for phone number (V2 API)
export async function requestOtp(params: OtpRequest): Promise<{ success: boolean; error?: string }> {
  const url = `${ELYMENTS_ENDPOINTS.identity}GenerateOtp/V2`;
  const phone = normalizePhone(params.phoneNumber);
  const countryCode = params.countryCode.replace(/^\+/, "");

  const response = await fetch(url, {
    method: "POST",
    headers: buildClientHeaders(),
    body: JSON.stringify({
      CountryCode: countryCode,
      MobileNumber: phone,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { success: false, error: `HTTP ${response.status}: ${response.statusText} ${text}` };
  }

  const data = await parseResponse<OtpResponseV2>(response);

  // Handle plain text "success" response
  if (typeof data === "string") {
    const lower = data.toLowerCase();
    if (lower === "success" || lower.includes("success")) {
      return { success: true };
    }
    return { success: false, error: data };
  }

  if (!data.IsSuccess) {
    return { success: false, error: data.Message || "OTP request failed" };
  }

  return { success: true };
}

// Extract session from various response formats (like reference implementation)
function extractSession(response: unknown): ElymentsSession | null {
  if (!response || typeof response !== "object") return null;

  const r = response as Record<string, unknown>;

  // Try different response structures
  const data = (r.ResponseData ?? r.result ?? r.data ?? r) as Record<string, unknown>;

  // Try different field name conventions
  const userId = data.UserId ?? data.userId ?? data.user_id ?? (data.user as Record<string, unknown>)?.id;
  const accessToken = data.AccessToken ?? data.accessToken ?? data.access_token ?? data.token;
  const chatAccessToken = data.ChatAccessToken ?? data.chatAccessToken ?? data.chat_access_token ?? data.chatToken;
  const refreshToken = data.RefreshToken ?? data.refreshToken ?? data.refresh_token;

  if (!userId || !accessToken || !chatAccessToken) {
    return null;
  }

  return {
    userId: String(userId),
    accessToken: String(accessToken),
    chatAccessToken: String(chatAccessToken),
    refreshToken: refreshToken ? String(refreshToken) : "",
    savedAt: Date.now(),
  };
}

// Verify OTP and get session tokens (V2 API)
export async function verifyOtp(
  params: OtpVerifyRequest,
  env?: NodeJS.ProcessEnv,
): Promise<{ success: boolean; session?: ElymentsSession; error?: string }> {
  const url = `${ELYMENTS_ENDPOINTS.identity}VerifyOtp/V2`;
  const device = getOrCreateDevice(env);
  const phone = normalizePhone(params.phoneNumber);
  const countryCode = params.countryCode.replace(/^\+/, "");

  const payload: Record<string, string> = {
    CountryCode: countryCode,
    MobileNumber: phone,
    Otp: params.otp,
    DeviceToken: params.deviceToken || device.deviceToken,
  };
  if (params.platformType || device.platformType) {
    payload.PlatformType = params.platformType || device.platformType;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: buildClientHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { success: false, error: `HTTP ${response.status}: ${response.statusText} ${text}` };
  }

  const data = await parseResponse<Record<string, unknown>>(response);

  // Handle unexpected plain text response
  if (typeof data === "string") {
    return { success: false, error: `Unexpected response: ${data}` };
  }

  // Check for explicit failure
  const isSuccess = data.IsSuccess ?? data.isSuccess ?? data.success;
  if (isSuccess === false) {
    const message = data.Message ?? data.message ?? "OTP verification failed";
    return { success: false, error: String(message) };
  }

  // Try to extract session
  const session = extractSession(data);
  if (!session) {
    // Log response for debugging
    console.error("[elyments] verifyOtp unexpected response:", JSON.stringify(data, null, 2));
    return { success: false, error: "Could not extract session from response" };
  }

  saveElymentsSession(session, env);
  return { success: true, session };
}

// Extract refreshed session from response
function extractRefreshedSession(response: unknown, existing: ElymentsSession): ElymentsSession | null {
  if (!response || typeof response !== "object") return null;

  const r = response as Record<string, unknown>;
  const data = (r.ResponseData ?? r.result ?? r.data ?? r) as Record<string, unknown>;

  const userId = data.UserId ?? data.userId ?? data.user_id ?? existing.userId;
  const accessToken = data.AccessToken ?? data.accessToken ?? data.access_token ?? data.token;
  const chatAccessToken = data.ChatAccessToken ?? data.chatAccessToken ?? data.chat_access_token ?? data.chatToken;
  const refreshToken = data.RefreshToken ?? data.refreshToken ?? data.refresh_token ?? existing.refreshToken;

  if (!userId || !accessToken || !chatAccessToken) {
    return null;
  }

  return {
    userId: String(userId),
    accessToken: String(accessToken),
    chatAccessToken: String(chatAccessToken),
    refreshToken: refreshToken ? String(refreshToken) : existing.refreshToken,
    savedAt: Date.now(),
  };
}

// Refresh session tokens (V4 API)
export async function refreshSession(
  env?: NodeJS.ProcessEnv,
): Promise<{ success: boolean; session?: ElymentsSession; error?: string }> {
  const currentSession = loadElymentsSession(env);
  if (!currentSession?.refreshToken) {
    return { success: false, error: "No refresh token available" };
  }

  const device = getOrCreateDevice(env);
  const url = `${ELYMENTS_ENDPOINTS.identity}RefreshToken/V4`;

  const payload: Record<string, string> = {
    DeviceToken: device.deviceToken,
  };
  if (device.platformType) {
    payload.PlatformType = device.platformType;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: buildClientHeaders({
      authorization: `bearer ${currentSession.refreshToken}`,
    }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    // Check for logout scenario
    if (response.status === 401) {
      return { success: false, error: "Session expired, please login again" };
    }
    const text = await response.text().catch(() => "");
    return { success: false, error: `HTTP ${response.status}: ${response.statusText} ${text}` };
  }

  const data = await parseResponse<Record<string, unknown>>(response);

  // Handle unexpected plain text response
  if (typeof data === "string") {
    return { success: false, error: `Unexpected response: ${data}` };
  }

  // Check for explicit failure
  const isSuccess = data.IsSuccess ?? data.isSuccess ?? data.success;
  if (isSuccess === false) {
    const message = data.Message ?? data.message ?? "Token refresh failed";
    return { success: false, error: String(message) };
  }

  const session = extractRefreshedSession(data, currentSession);
  if (!session) {
    console.error("[elyments] refreshSession unexpected response:", JSON.stringify(data, null, 2));
    return { success: false, error: "Could not extract session from refresh response" };
  }

  saveElymentsSession(session, env);
  return { success: true, session };
}

// Get valid session (refresh if needed)
export async function getValidSession(
  env?: NodeJS.ProcessEnv,
): Promise<{ success: boolean; session?: ElymentsSession; error?: string }> {
  const session = loadElymentsSession(env);
  if (!session) {
    return { success: false, error: "Not logged in" };
  }

  // Check if access token is expiring
  if (isTokenExpiring(session.accessToken)) {
    return await refreshSession(env);
  }

  return { success: true, session };
}

// Auto-refresh wrapper for API calls
export async function withAutoRefresh<T>(
  fn: (session: ElymentsSession) => Promise<T>,
  env?: NodeJS.ProcessEnv,
): Promise<T> {
  const result = await getValidSession(env);
  if (!result.success || !result.session) {
    throw new Error(result.error || "No valid session");
  }

  try {
    return await fn(result.session);
  } catch (err) {
    // Check if it's an auth error
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("401") || message.includes("unauthorized") || message.includes("expired")) {
      // Try refreshing and retrying once
      const refreshResult = await refreshSession(env);
      if (refreshResult.success && refreshResult.session) {
        return await fn(refreshResult.session);
      }
    }
    throw err;
  }
}
