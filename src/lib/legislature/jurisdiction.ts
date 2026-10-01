import type { JurisdictionMode, LegislationType } from "@/lib/db/types/legislation";

export const JURISDICTION_MODES = [
  "national_direct",
  "national_floor",
  "concurrent",
  "grant_supported_regional",
  "regional_discretion",
] as const satisfies readonly JurisdictionMode[];

export interface BillAdministrationValidation {
  ok: boolean;
  error?: string;
}

/**
 * Verify that administered laws have migrated metadata. A bill no longer
 * selects one jurisdiction for all provisions; each enacted policy option
 * carries its authored delivery consequence.
 */
export function validateBillAdministration(input: {
  enabled: boolean;
  legislationTypes: Pick<LegislationType, "_id" | "name" | "administration">[];
}): BillAdministrationValidation {
  if (!input.enabled || input.legislationTypes.length === 0) return { ok: true };

  for (const type of input.legislationTypes) {
    if (!type.administration) {
      return {
        ok: false,
        error: `Legislation type "${type.name}" has not been migrated to the administration model.`,
      };
    }
  }

  return { ok: true };
}

/** Resolve delivery from authored option metadata, then the law's scope default. */
export function resolvePolicyOptionJurisdiction(
  type: Pick<LegislationType, "administration">,
  option: NonNullable<LegislationType["policyOptions"]>[number] | undefined,
  legacyBillMode?: JurisdictionMode
): JurisdictionMode {
  return (
    option?.jurisdictionMode ??
    legacyBillMode ??
    type.administration?.defaultJurisdictionMode ??
    "national_direct"
  );
}
