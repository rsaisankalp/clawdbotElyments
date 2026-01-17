import { z } from "zod";

// DM policy schema
const DmPolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    policy: z.enum(["open", "allowlist", "pairing", "disabled"]).optional(),
    allowFrom: z.array(z.string()).optional(),
  })
  .optional();

// Group config schema
const GroupConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    requireMention: z.boolean().optional(),
    autoReply: z.boolean().optional(),
    users: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
    skills: z.array(z.string()).optional(),
  })
  .optional();

// Actions schema
const ActionsSchema = z
  .object({
    reactions: z.boolean().optional(),
  })
  .optional();

// Main Elyments config schema
export const ElymentsConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    senderName: z.string().optional(),
    phoneNumber: z.string().optional(),
    countryCode: z.string().optional(),
    dm: DmPolicySchema,
    groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
    groups: z.record(z.string(), GroupConfigSchema).optional(),
    actions: ActionsSchema,
  })
  .optional();

export type ElymentsConfig = z.infer<typeof ElymentsConfigSchema>;
