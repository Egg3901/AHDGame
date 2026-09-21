import type { JurisdictionMode, LegislationType } from "@/lib/db/types/legislation";

export const JURISDICTION_MODES = [
  "national_direct",
  "national_floor",
  "concurrent",
  "grant_supported_regional",
  "regional_discretion",
] as const satisfies readonly JurisdictionMode[];

export interface BillJurisdictionResolution {
  ok: boolean;
  mode?: JurisdictionMode;
  error?: string;
}

/**
 * Resolve one responsibility model for a bill. Policy content and ideological
 * stance are deliberately absent from this rule; only authored administration
 * metadata controls which jurisdiction modes are legal.
 */
export function resolveBillJurisdiction(input: {
  enabled: boolean;
  requested?: JurisdictionMode;
  legislationTypes: Pick<LegislationType, "_id" | "name" | "administration">[];
}): BillJurisdictionResolution {
  if (!input.enabled) return { ok: true, mode: "national_direct" };
  if (input.legislationTypes.length === 0) {
    if (input.requested && input.requested !== "national_direct") {
      return {
        ok: false,
        error: "A jurisdiction mode can only be selected for an administered policy bill.",
      };
    }
    return { ok: true, mode: "national_direct" };
  }

  for (const type of input.legislationTypes) {
    if (!type.administration) {
      return {
        ok: false,
        error: `Legislation type "${type.name}" has not been migrated to the administration model.`,
      };
    }
  }

  let mode = input.requested;
  if (!mode) {
    const defaults = new Set(
      input.legislationTypes.map((type) => type.administration!.defaultJurisdictionMode)
    );
    if (defaults.size === 1) mode = [...defaults][0];
    else if (
      input.legislationTypes.every((type) =>
        type.administration!.allowedJurisdictionModes.includes("national_direct")
      )
    ) {
      mode = "national_direct";
    } else {
      return {
        ok: false,
        error:
          "This bill combines laws with different responsibility models. Select one mode that every provision allows.",
      };
    }
  }

  const rejected = input.legislationTypes.find(
    (type) => !type.administration!.allowedJurisdictionModes.includes(mode!)
  );
  if (rejected) {
    return {
      ok: false,
      error: `Legislation type "${rejected.name}" does not allow the selected jurisdiction mode.`,
    };
  }
  return { ok: true, mode };
}
