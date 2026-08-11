import { z } from "zod";

/**
 * Pagination query schema for GET /api/corporations/[id]/shares/history.
 * Defaults produce a 25-per-page cursor with the newest entry first.
 */
export const shareHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ShareHistoryQuery = z.infer<typeof shareHistoryQuerySchema>;
