import { z } from "zod";

export const chatMsgSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(1_000_000),
});

export const capabilitiesSchema = z.object({
  web_search: z.boolean().default(true),
  image_analysis: z.boolean().default(true),
  planning: z.boolean().default(true),
  image_generation: z.boolean().default(true),
  video_generation: z.boolean().default(true),
  document_editing: z.boolean().default(true),
  scheduling: z.boolean().default(true),
});

export const ALL_CAPS_ON = {
  web_search: true,
  image_analysis: true,
  planning: true,
  image_generation: true,
  video_generation: true,
  document_editing: true,
  scheduling: true,
} as const;

export const chatTurnSchema = z.object({
  messages: z.array(chatMsgSchema).min(1).max(60),
  contextDocumentIds: z.array(z.string().uuid()).max(20).default([]),
  imageUrl: z.string().url().optional(),
  imageUrls: z.array(z.string().url()).max(6).default([]),
  threadId: z.string().uuid().optional(),
  capabilities: capabilitiesSchema.default({ ...ALL_CAPS_ON }),
});

export type ChatCapabilities = z.infer<typeof capabilitiesSchema>;
export type ChatTurnInput = z.infer<typeof chatTurnSchema>;
export type ChatRoute = "chat" | "web" | "plan" | "resumed";

/** The capability groups that make a request "actionable" (needs a plan). */
export const ACTION_GROUPS = [
  "planning",
  "document_editing",
  "image_generation",
  "video_generation",
  "scheduling",
] as const;

/** Normalize a possibly-partial capabilities object from the database. */
export function normalizeCapabilities(
  raw: unknown,
  fallback: Partial<ChatCapabilities> = {},
): ChatCapabilities {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (k: keyof ChatCapabilities): boolean => {
    if (typeof src[k] === "boolean") return src[k] as boolean;
    if (typeof fallback[k] === "boolean") return fallback[k] as boolean;
    return false;
  };
  return {
    web_search: pick("web_search"),
    image_analysis: pick("image_analysis"),
    planning: pick("planning"),
    image_generation: pick("image_generation"),
    video_generation: pick("video_generation"),
    document_editing: pick("document_editing"),
    scheduling: pick("scheduling"),
  };
}
