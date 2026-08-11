import { z } from "zod";

/**
 * POST /api/country/[code]/parties/[id]/treasury/request — Request Funds
 * (member-initiated, party treasury → requester's campaign funds).
 *
 * No characterId in the body: the requester IS the recipient. Note
 * field is optional for the proposer to add context for approvers.
 */
export const requestFundsSchema = z.object({
  amount: z.coerce.number().int().min(1000, "Minimum request is $1,000"),
  note: z.string().trim().max(280).optional(),
});

export type RequestFundsBody = z.infer<typeof requestFundsSchema>;
