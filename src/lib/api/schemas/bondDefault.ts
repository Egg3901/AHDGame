import { z } from "zod";
import { CORPORATE_BOND_MATURITY_ISSUANCE_OPTIONS } from "@/lib/db/types/bond";

const CORPORATE_MATURITY_SET = new Set<number>(CORPORATE_BOND_MATURITY_ISSUANCE_OPTIONS);

export const bondDefaultRefinanceSchema = z.object({
  maturityTurns: z
    .number()
    .int()
    .refine(
      (v) => CORPORATE_MATURITY_SET.has(v),
      "Maturity must be 96 (2yr), 240 (5yr), or 336 (7yr)"
    ),
});

export const bondDefaultDissolveSchema = z.object({
  confirm: z.literal(true),
});
