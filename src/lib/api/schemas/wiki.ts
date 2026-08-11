import { z } from "zod";

export const createWikiPageSchema = z.object({
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(100, "Slug must be at most 100 characters")
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(500),
  content: z.string().min(50).max(100000),
  /** Required for player submissions; validated against
   * PLAYER_SUBMITTABLE_CATEGORY_IDS inside the route handler so admins can
   * still use system-only categories via /api/admin/wiki. */
  category: z.string().min(2).max(50).optional(),
  tags: z.array(z.string().min(2).max(30)).max(10),
  templateType: z.string().optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  featured: z.boolean().optional(),
  private: z.boolean().optional(),
});

export const updateWikiPageSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().min(10).max(500).optional(),
  content: z.string().min(50).max(100000).optional(),
  category: z.string().min(2).max(50).optional(),
  tags: z.array(z.string().min(2).max(30)).max(10).optional(),
  templateType: z.string().optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  featured: z.boolean().optional(),
  private: z.boolean().optional(),
  status: z.enum(["draft", "pending_review", "published", "archived"]).optional(),
});

export const approveWikiPageSchema = z.object({
  editedContent: z.string().min(50).max(100000).optional(),
  editedTitle: z.string().min(3).max(200).optional(),
  editedDescription: z.string().min(10).max(500).optional(),
  editedTags: z.array(z.string().min(2).max(30)).max(10).optional(),
});

export const rejectWikiPageSchema = z.object({
  reason: z.string().min(10).max(500),
});

export const createSystemTagSchema = z.object({
  id: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(100),
  description: z.string().min(10).max(500),
  icon: z.string().min(1).max(10),
  color: z.string().min(5).max(50), // Tailwind class
  order: z.number().int().min(1),
});
