import { z } from "zod";

const CATEGORIES = [
  "feature_request",
  "ui_improvement",
  "game_balance",
  "new_content",
  "accessibility",
  "other",
] as const;

const GAME_SYSTEMS = [
  "elections",
  "legislature",
  "executive",
  "judiciary",
  "economy",
  "corporations",
  "parties",
  "npps",
  "map_geo",
  "combat_or_military",
  "diplomacy",
  "onboarding_account",
  "notifications",
  "meta_other",
] as const;

const lastActionSchema = z
  .object({
    label: z.string(),
    timestamp: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .optional();

const contextSchema = z
  .object({
    pathname: z.string().optional(),
    url: z.string().optional(),
    capturedAt: z.string().optional(),
    lastAction: lastActionSchema,
    recentActions: z.array(z.unknown()).optional(),
    userAgent: z.string().optional(),
    viewport: z.object({ width: z.number(), height: z.number() }).optional(),
    referrer: z.string().optional(),
  })
  .passthrough();

export const createSuggestionSchema = z.object({
  category: z.enum(CATEGORIES),
  gameSystem: z.enum(GAME_SYSTEMS),
  title: z.string().min(1, "Title required").max(200),
  description: z.string().min(1, "Description required").max(5000),
  impact: z.string().max(500).optional(),
  priority: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : Number(v)))
    .optional(),
  context: contextSchema.default({}),
  screenshotUrl: z.string().url().optional(),
});

export const suggestionCommentSchema = z.object({
  body: z.string().min(1).max(2000).trim(),
});
