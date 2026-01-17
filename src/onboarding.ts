import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingStatusContext,
  ChannelOnboardingConfigureContext,
  ChannelOnboardingResult,
  ChannelOnboardingStatus,
} from "../../../src/channels/plugins/onboarding-types.js";
import type { RuntimeEnv } from "../../../src/runtime.js";
import { requestOtp, verifyOtp } from "./elyments/auth.js";
import {
  elymentsCredentialsExist,
  loadElymentsSession,
  saveElymentsProfile,
} from "./elyments/credentials.js";
import { ELYMENTS_ENDPOINTS } from "./types.js";
import type { CoreConfig } from "./types.js";

const channel = "elyments" as const;

// Chat summary from inbox API
type RecentChat = {
  jid: string;
  title: string;
  isGroup: boolean;
  lastMessage?: string;
};

// Fetch recent chats from Elyments inbox API
async function fetchRecentChats(limit = 10): Promise<RecentChat[]> {
  const session = loadElymentsSession();
  if (!session?.accessToken) {
    return [];
  }

  try {
    const url = `${ELYMENTS_ENDPOINTS.chat}inboxDetails/v2?limit=${limit}`;
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!response.ok) {
      console.error(`[elyments] Failed to fetch chats: ${response.status}`);
      return [];
    }

    const data = await response.json() as Record<string, unknown>;
    const items = Array.isArray(data)
      ? data
      : (data?.inboxDetails ?? data?.result ?? data?.data ?? data?.response ?? []) as unknown[];

    if (!Array.isArray(items)) return [];

    return items.slice(0, limit).map((item: unknown) => {
      const i = item as Record<string, unknown>;
      const jid = String(
        i?.remote_bare_jid ?? i?.remoteBareJid ?? i?.jid ?? ""
      );
      const isGroup = jid.endsWith("@muclight.localhost");
      const title = String(
        i?.display_name ??
        i?.displayName ??
        i?.contact_name ??
        i?.name ??
        i?.group_name ??
        i?.remote_bare_jid_name ??
        i?.remoteBareJidName ??
        i?.remote_name ??
        jid
      );

      // Extract last message from JSON body
      let lastMessage: string | undefined;
      const content = i?.content as Record<string, unknown> | undefined;
      const msg = content?.message as Record<string, unknown> | undefined;
      const body = msg?.body;
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body) as { info?: { message?: string } };
          lastMessage = parsed?.info?.message;
        } catch {
          lastMessage = body.slice(0, 50);
        }
      }

      return { jid, title, isGroup, lastMessage };
    }).filter((c) => c.jid); // Filter out empty JIDs
  } catch (err) {
    console.error(`[elyments] Error fetching chats:`, err);
    return [];
  }
}

export const elymentsOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,

  getStatus: async (_ctx: ChannelOnboardingStatusContext): Promise<ChannelOnboardingStatus> => {
    const configured = elymentsCredentialsExist();
    const session = configured ? loadElymentsSession() : null;
    const statusLabel = configured && session ? `logged in as ${session.userId}` : "not logged in";

    return {
      channel,
      configured,
      statusLines: [`Elyments: ${statusLabel}`],
      selectionHint: configured ? "logged in" : "not logged in",
      quickstartScore: configured ? 3 : 2,
    };
  },

  configure: async (ctx: ChannelOnboardingConfigureContext): Promise<ChannelOnboardingResult> => {
    const { cfg, runtime, prompter } = ctx;

    // Check if already configured
    const alreadyConfigured = elymentsCredentialsExist();
    const existingSession = alreadyConfigured ? loadElymentsSession() : null;

    if (existingSession) {
      const action = await prompter.select({
        message: `Already logged in as ${existingSession.userId}. What do you want to do?`,
        options: [
          { value: "keep", label: "Keep current login" },
          { value: "relogin", label: "Re-login (new OTP)" },
          { value: "logout", label: "Logout" },
          { value: "settings", label: "Modify settings" },
        ],
      }) as "keep" | "relogin" | "logout" | "settings";

      if (action === "keep") {
        return { cfg };
      }

      if (action === "logout") {
        const { clearElymentsCredentials } = await import("./elyments/credentials.js");
        clearElymentsCredentials();
        await prompter.note("Logged out of Elyments.", "Elyments");

        // Ask if they want to log in again
        const loginAgain = await prompter.confirm({
          message: "Would you like to log in again?",
          initialValue: true,
        });
        if (!loginAgain) {
          // Disable elyments in config
          const next: CoreConfig = {
            ...cfg,
            channels: {
              ...cfg.channels,
              elyments: {
                ...(cfg as CoreConfig).channels?.elyments,
                enabled: false,
              },
            },
          };
          return { cfg: next };
        }
      }

      if (action === "settings") {
        // Go to settings configuration
        return await configureElymentsSettings(ctx);
      }
    }

    await prompter.note(
      [
        "Elyments uses OTP-based authentication.",
        "You will receive an OTP on your phone to verify.",
      ].join("\n"),
      "Elyments Login",
    );

    // Get country code
    const countryCode = await prompter.text({
      message: "Country code",
      placeholder: "91",
      initialValue: "91",
    });

    // Get phone number
    const phoneNumber = await prompter.text({
      message: "Phone number (without country code)",
      placeholder: "9876543210",
      validate: (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "Required";
        if (!/^\d{10,15}$/.test(raw)) return "Invalid phone number";
        return undefined;
      },
    });

    const cc = String(countryCode || "91").trim();
    const phone = String(phoneNumber).trim();

    // Request OTP
    await prompter.note("Requesting OTP...", "Elyments");
    const otpResult = await requestOtp({
      countryCode: cc,
      phoneNumber: phone,
    });

    if (!otpResult.success) {
      await prompter.note(
        `Failed to request OTP: ${otpResult.error || "Unknown error"}`,
        "Elyments Error",
      );
      return { cfg };
    }

    await prompter.note("OTP sent to your phone.", "Elyments");

    // Get OTP
    const otp = await prompter.text({
      message: "Enter OTP",
      placeholder: "123456",
      validate: (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "Required";
        if (!/^\d{4,8}$/.test(raw)) return "Invalid OTP";
        return undefined;
      },
    });

    // Verify OTP
    await prompter.note("Verifying OTP...", "Elyments");
    const verifyResult = await verifyOtp({
      countryCode: cc,
      phoneNumber: phone,
      otp: String(otp).trim(),
    });

    if (!verifyResult.success || !verifyResult.session) {
      await prompter.note(
        `OTP verification failed: ${verifyResult.error || "Unknown error"}`,
        "Elyments Error",
      );
      return { cfg };
    }

    await prompter.note(`Logged in as ${verifyResult.session.userId}`, "Elyments");

    // Get sender name
    const senderName = await prompter.text({
      message: "Display name for messages",
      placeholder: "Clawdbot",
      initialValue: "Clawdbot",
    });

    if (senderName) {
      saveElymentsProfile({
        senderName: String(senderName).trim(),
        userId: verifyResult.session.userId,
        updatedAt: Date.now(),
      });
    }

    // Update config
    const next: CoreConfig = {
      ...cfg,
      channels: {
        ...cfg.channels,
        elyments: {
          ...(cfg as CoreConfig).channels?.elyments,
          enabled: true,
          phoneNumber: phone,
          countryCode: cc,
          senderName: String(senderName || "Clawdbot").trim(),
        },
      },
    };

    await prompter.note(
      `Successfully configured Elyments for ${verifyResult.session.userId}`,
      "Elyments",
    );

    // Configure settings after login
    return await configureElymentsSettings({
      ...ctx,
      cfg: next,
    });
  },
};

// Configure Elyments settings (allowFrom, senderName, etc.)
async function configureElymentsSettings(
  ctx: ChannelOnboardingConfigureContext,
): Promise<ChannelOnboardingResult> {
  const { cfg, prompter } = ctx;
  let next = cfg as CoreConfig;
  const elymentsCfg = next.channels?.elyments ?? {};

  // Sender name
  const currentSenderName = elymentsCfg.senderName || "Clawdbot";
  const senderName = await prompter.text({
    message: "Display name for messages",
    placeholder: "Clawdbot",
    initialValue: currentSenderName,
  });

  // DM Policy
  const currentDmPolicy = elymentsCfg.dm?.policy ?? "pairing";
  const dmPolicy = await prompter.select({
    message: "DM access policy",
    options: [
      { value: "pairing", label: "Pairing (default) - unknown senders get pairing code" },
      { value: "allowlist", label: "Allowlist - only allow specific users" },
      { value: "open", label: "Open - allow all DMs" },
      { value: "disabled", label: "Disabled - ignore all DMs" },
    ],
  }) as "pairing" | "allowlist" | "open" | "disabled";

  // AllowFrom configuration
  let allowFrom: string[] = [...(elymentsCfg.dm?.allowFrom ?? [])].map(String);

  if (dmPolicy === "allowlist" || dmPolicy === "pairing") {
    // Fetch recent chats for easy selection
    await prompter.note("Fetching recent chats...", "Elyments");
    const recentChats = await fetchRecentChats(15);
    const dmChats = recentChats.filter((c) => !c.isGroup);

    const currentAllowFrom = allowFrom.length > 0 ? allowFrom.join(", ") : "(none)";
    const currentDisplay = allowFrom.map((jid) => {
      const chat = recentChats.find((c) => c.jid.toLowerCase() === jid.toLowerCase());
      return chat ? `${chat.title} (${jid})` : jid;
    }).join("\n  - ") || "(none)";

    await prompter.note(
      [
        `Current allowFrom:`,
        `  - ${currentDisplay}`,
        "",
        dmChats.length > 0
          ? `Found ${dmChats.length} recent DM chats to choose from.`
          : "No recent DM chats found. You can enter JIDs manually.",
      ].join("\n"),
      "Elyments allowFrom",
    );

    // Build action options
    const actionOptions: Array<{ value: string; label: string }> = [
      { value: "keep", label: "Keep current list" },
    ];

    if (dmChats.length > 0) {
      actionOptions.push({ value: "select", label: "Select from recent chats" });
    }
    actionOptions.push(
      { value: "manual", label: "Enter JIDs manually" },
      { value: "clear", label: "Clear list" },
    );

    const action = await prompter.select({
      message: "Manage allowFrom list",
      options: actionOptions,
    }) as "keep" | "select" | "manual" | "clear";

    if (action === "select" && dmChats.length > 0) {
      // Show recent chats as multi-select options
      const chatOptions = dmChats.map((chat) => ({
        value: chat.jid,
        label: `${chat.title}${chat.lastMessage ? ` - "${chat.lastMessage.slice(0, 30)}..."` : ""}`,
        hint: chat.jid.split("@")[0].slice(0, 8) + "...",
      }));

      // Use multiselect if available, otherwise loop through options
      const selectedChats: string[] = [];

      await prompter.note(
        "Select users to allow (you can select multiple):",
        "Elyments allowFrom",
      );

      for (const chatOpt of chatOptions) {
        const shouldAdd = await prompter.confirm({
          message: `Allow ${chatOpt.label}?`,
          initialValue: allowFrom.some((a) => a.toLowerCase() === chatOpt.value.toLowerCase()),
        });
        if (shouldAdd) {
          selectedChats.push(chatOpt.value);
        }
      }

      if (selectedChats.length > 0) {
        // Merge with existing
        allowFrom = [...new Set([...allowFrom, ...selectedChats])];
      }
    } else if (action === "manual") {
      const entries = await prompter.text({
        message: "Enter Elyments user JIDs (comma-separated)",
        placeholder: "user-uuid@localhost, other-uuid@localhost",
      });

      const newEntries = String(entries || "")
        .split(/[,\n;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      if (newEntries.length > 0) {
        allowFrom = [...new Set([...allowFrom, ...newEntries])];
      }
    } else if (action === "clear") {
      allowFrom = [];
    }
  } else if (dmPolicy === "open") {
    allowFrom = ["*"];
  }

  // Update config
  next = {
    ...next,
    channels: {
      ...next.channels,
      elyments: {
        ...elymentsCfg,
        enabled: true,
        senderName: String(senderName || currentSenderName).trim(),
        dm: {
          ...elymentsCfg.dm,
          enabled: dmPolicy !== "disabled",
          policy: dmPolicy,
          allowFrom: allowFrom,
        },
      },
    },
  };

  await prompter.note(
    [
      "Elyments configuration updated:",
      `- Sender name: ${String(senderName || currentSenderName).trim()}`,
      `- DM policy: ${dmPolicy}`,
      `- Allow from: ${allowFrom.length > 0 ? allowFrom.join(", ") : "(none)"}`,
    ].join("\n"),
    "Elyments",
  );

  return { cfg: next };
}

// Legacy function for auth.login (used by channel.ts auth adapter)
export async function runElymentsOnboarding(runtime: RuntimeEnv): Promise<{
  success: boolean;
  message: string;
}> {
  // This is a simplified version for the auth.login path
  // The full configure flow uses prompter from the wizard
  runtime.log?.("\nElyments Login\n");
  runtime.log?.("This will authenticate you with Elyments using OTP verification.\n");

  // For auth.login, we use readline directly since we don't have a prompter
  const readline = await import("node:readline");
  const prompt = (question: string): Promise<string> => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  };

  // Check if already configured
  if (elymentsCredentialsExist()) {
    const session = loadElymentsSession();
    if (session) {
      const proceed = await prompt(
        `Already logged in as ${session.userId}. Reconfigure? (y/N): `,
      );
      if (proceed.toLowerCase() !== "y") {
        return { success: true, message: "Keeping existing configuration" };
      }
    }
  }

  // Get phone number
  const countryCode = await prompt("Country code (default: 91): ");
  const phoneNumber = await prompt("Phone number: ");

  if (!phoneNumber) {
    return { success: false, message: "Phone number is required" };
  }

  const cc = countryCode || "91";

  // Request OTP
  runtime.log?.("\nRequesting OTP...");
  const otpResult = await requestOtp({
    countryCode: cc,
    phoneNumber,
  });

  if (!otpResult.success) {
    return { success: false, message: otpResult.error || "Failed to request OTP" };
  }

  runtime.log?.("OTP sent to your phone.\n");

  // Get OTP
  const otp = await prompt("Enter OTP: ");

  if (!otp) {
    return { success: false, message: "OTP is required" };
  }

  // Verify OTP
  runtime.log?.("\nVerifying OTP...");
  const verifyResult = await verifyOtp({
    countryCode: cc,
    phoneNumber,
    otp,
  });

  if (!verifyResult.success || !verifyResult.session) {
    return { success: false, message: verifyResult.error || "OTP verification failed" };
  }

  runtime.log?.(`\nLogged in as ${verifyResult.session.userId}\n`);

  // Get sender name
  const senderName = await prompt(
    "Display name for messages (default: Clawdbot): ",
  );

  if (senderName) {
    saveElymentsProfile({
      senderName,
      userId: verifyResult.session.userId,
      updatedAt: Date.now(),
    });
  }

  return {
    success: true,
    message: `Successfully logged in as ${verifyResult.session.userId}`,
  };
}
