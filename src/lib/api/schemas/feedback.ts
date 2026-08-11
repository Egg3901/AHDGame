import { z } from "zod";

const BUG_CATEGORIES = [
  "ui_ux",
  "performance",
  "data_display",
  "authentication",
  "elections",
  "congress_bills",
  "parties",
  "npps",
  "map",
  "actions",
  "notifications",
  "other",
] as const;

const SUGGESTION_CATEGORIES = [
  "feature_request",
  "ui_improvement",
  "game_balance",
  "new_content",
  "accessibility",
  "other",
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

export const feedbackBugSchema = z.object({
  type: z.literal("bug"),
  category: z.enum(BUG_CATEGORIES),
  title: z.string().min(1, "Title required").max(200),
  description: z.string().min(1, "Description required").max(5000),
  stepsToReproduce: z.string().max(2000).optional(),
  severity: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : Number(v)))
    .optional(),
  context: contextSchema.default({}),
  screenshotUrl: z.string().url().optional(),
  sentryEventId: z.string().uuid().optional(),
});

export const feedbackSuggestionSchema = z.object({
  type: z.literal("suggestion"),
  category: z.enum(SUGGESTION_CATEGORIES),
  title: z.string().min(1, "Title required").max(200),
  description: z.string().min(1, "Description required").max(5000),
  impact: z.string().max(500).optional(),
  priority: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : Number(v)))
    .optional(),
  context: contextSchema.default({}),
  screenshotUrl: z.string().url().optional(),
  sentryEventId: z.string().uuid().optional(),
});

export const feedbackSchema = z.discriminatedUnion("type", [
  feedbackBugSchema,
  feedbackSuggestionSchema,
]);
