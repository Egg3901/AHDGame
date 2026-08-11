import { z } from "zod";
import { MAX_REGION_ID_LENGTH } from "@/lib/constants/states";

export const executeActionSchema = z.object({
  actionType: z.enum([
    "fundraise",
    "campaign",
    "advertise",
    "buildDonorBase",
    "poll",
    "pollLarge",
    "convertCash",
    "rest",
    "debatePrep",
  ]),
  /** Batch runs (×5 / ×10). Omitted or 1 = single execution. */
  count: z.union([z.literal(1), z.literal(5), z.literal(10)]).optional(),
  /**
   * Shape only, for the same reason as `expandSectorSchema.stateId`: this was
   * refined against the US-only `STATE_IDS`, which would reject any non-US
   * character's own region. `executeAction` resolves the id against `states`
   * scoped to the character's country, which is both stronger and
   * country-agnostic. Omitted entirely for the actions that take no target.
   */
  targetState: z
    .string()
    .trim()
    .min(1, "Invalid state ID")
    .max(MAX_REGION_ID_LENGTH, "Invalid state ID")
    .optional(),
  convertAmount: z.number().positive().optional(),
});
