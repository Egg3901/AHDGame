import { z } from "zod";

/**
 * Query schema for GET /api/corporations/[id]/bonds/history.
 *
 * - `pageSize` is the number of TURNS per page (each turn expands into N rows
 *   in the response), not row count. Defaults to 10 turns per page.
 * - `direction` filters rows by sign-of-amount BEFORE the page is sliced, so
 *   `pageCount` and `totalTurns` reflect the filtered universe — the UI never
 *   shows "Page 3 of 5" with zero matching rows on the page. Case-insensitive
 *   on input (`Income`, `INCOME`, `income` all map to `income`).
 * - Zero-amount rows (e.g. refinance bond_issuance) are non-directional state
 *   changes — the route includes them under both `income` and `payment` so
 *   they don't disappear when a directional filter is active.
 */
export const bondHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  direction: z
    .string()
    .optional()
    .transform((v) => (v ?? "all").toLowerCase())
    .pipe(z.enum(["all", "income", "payment"])),
});

export type BondHistoryQuery = z.infer<typeof bondHistoryQuerySchema>;
export type BondHistoryDirection = BondHistoryQuery["direction"];
