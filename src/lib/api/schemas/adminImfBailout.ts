import { z } from "zod";

/**
 * Admin IMF restructuring: optional bond haircut + dilution + amortizing facility.
 * When `active` is false, only bailout flags are cleared (IMF may retain shares).
 */
export const adminImfBailoutSchema = z.object({
  active: z.boolean(),
  /** Target IMF fully diluted ownership % (e.g. 40). Required when active is true. */
  targetOwnershipPercent: z.number().min(1).max(90).optional(),
  /**
   * Fraction of bond face value retained by holders after haircut (e.g. 0.7 = 30% loss).
   * Required when activating and the corporation has outstanding bonds.
   */
  bondHaircutRetention: z.number().min(0.01).max(1).optional(),
  /** Annual interest on IMF facility principal (%). Required when active. */
  annualRatePercent: z.number().min(0).max(80).optional(),
  /** Turns over which the facility amortizes. Required when active. */
  amortizationTurns: z.number().int().min(24).max(960).optional(),
  /**
   * Max share of per-turn operating income applied to facility (1–45%).
   * Capped by IMF_BAILOUT_INCOME_FRACTION_CAP server-side. Default 35%.
   */
  incomeCapturePercent: z.number().min(1).max(45).optional(),
});

export type AdminImfBailoutBody = z.infer<typeof adminImfBailoutSchema>;
