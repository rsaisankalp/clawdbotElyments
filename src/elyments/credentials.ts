import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ElymentsSession, ElymentsDevice, ElymentsProfile } from "../types.js";

const CREDENTIALS_DIR = ".clawdbot/credentials/elyments";
const SESSION_FILE = "session.json";
const DEVICE_FILE = "device.json";
const PROFILE_FILE = "profile.json";

function getCredentialsDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || os.homedir();
  return path.join(home, CREDENTIALS_DIR);
}

function ensureCredentialsDir(env?: NodeJS.ProcessEnv): string {
  const dir = getCredentialsDir(env);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Session management
export function loadElymentsSession(env?: NodeJS.ProcessEnv): ElymentsSession | null {
  try {
    const dir = getCredentialsDir(env);
    const filePath = path.join(dir, SESSION_FILE);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as ElymentsSession;
  } catch {
    return null;
  }
}

export function saveElymentsSession(session: ElymentsSession, env?: NodeJS.ProcessEnv): void {
  const dir = ensureCredentialsDir(env);
  const filePath = path.join(dir, SESSION_FILE);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
}

export function deleteElymentsSession(env?: NodeJS.ProcessEnv): boolean {
  try {
    const dir = getCredentialsDir(env);
    const filePath = path.join(dir, SESSION_FILE);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function touchElymentsSession(env?: NodeJS.ProcessEnv): void {
  const session = loadElymentsSession(env);
  if (session) {
    session.savedAt = Date.now();
    saveElymentsSession(session, env);
  }
}

// Device management
export function loadElymentsDevice(env?: NodeJS.ProcessEnv): ElymentsDevice | null {
  try {
    const dir = getCredentialsDir(env);
    const filePath = path.join(dir, DEVICE_FILE);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as ElymentsDevice;
  } catch {
    return null;
  }
}

export function saveElymentsDevice(device: ElymentsDevice, env?: NodeJS.ProcessEnv): void {
  const dir = ensureCredentialsDir(env);
  const filePath = path.join(dir, DEVICE_FILE);
  fs.writeFileSync(filePath, JSON.stringify(device, null, 2), "utf-8");
}

export function getOrCreateDevice(env?: NodeJS.ProcessEnv): ElymentsDevice {
  const existing = loadElymentsDevice(env);
  if (existing) return existing;

  const device: ElymentsDevice = {
    deviceId: generateDeviceId(),
    deviceToken: generateDeviceToken(),
    platformType: "WEB",
    resource: `clawdbot-${Date.now()}`,
    createdAt: Date.now(),
  };
  saveElymentsDevice(device, env);
  return device;
}

function generateDeviceId(): string {
  return `clawdbot-${Math.random().toString(36).slice(2, 10)}`;
}

function generateDeviceToken(): string {
  // Generate a UUID-like token
  const segments = [8, 4, 4, 4, 12];
  return segments
    .map((len) =>
      Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
    )
    .join("-");
}

// Profile management
export function loadElymentsProfile(env?: NodeJS.ProcessEnv): ElymentsProfile | null {
  try {
    const dir = getCredentialsDir(env);
    const filePath = path.join(dir, PROFILE_FILE);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as ElymentsProfile;
  } catch {
    return null;
  }
}

export function saveElymentsProfile(profile: ElymentsProfile, env?: NodeJS.ProcessEnv): void {
  const dir = ensureCredentialsDir(env);
  const filePath = path.join(dir, PROFILE_FILE);
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), "utf-8");
}

// Check if session is valid (not expired)
export function isSessionValid(session: ElymentsSession | null): boolean {
  if (!session) return false;
  if (!session.accessToken || !session.chatAccessToken) return false;
  // Check JWT expiration with 60 second buffer
  try {
    const payload = parseJwtPayload(session.accessToken);
    if (!payload?.exp) return true; // No expiration claim
    const expiresAt = payload.exp * 1000;
    return Date.now() < expiresAt - 60_000;
  } catch {
    return true; // Assume valid if we can't parse
  }
}

export function isTokenExpiring(token: string, bufferMs = 60_000): boolean {
  try {
    const payload = parseJwtPayload(token);
    if (!payload?.exp) return false;
    const expiresAt = payload.exp * 1000;
    return Date.now() >= expiresAt - bufferMs;
  } catch {
    return false;
  }
}

function parseJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64").toString("utf-8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

// Check if credentials exist
export function elymentsCredentialsExist(env?: NodeJS.ProcessEnv): boolean {
  const session = loadElymentsSession(env);
  return session !== null && Boolean(session.accessToken);
}

// Clear all credentials
export function clearElymentsCredentials(env?: NodeJS.ProcessEnv): void {
  const dir = getCredentialsDir(env);
  for (const file of [SESSION_FILE, DEVICE_FILE, PROFILE_FILE]) {
    const filePath = path.join(dir, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
