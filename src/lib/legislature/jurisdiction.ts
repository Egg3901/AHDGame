import type { JurisdictionMode, LegislationType } from "@/lib/db/types/legislation";

export const JURISDICTION_MODES = [
  "national_direct",
  "national_floor",
  "concurrent",
  "grant_supported_regional",
  "regional_discretion",
] as const satisfies readonly JurisdictionMode[];

export const JURISDICTION_MODE_LABELS: Record<JurisdictionMode, string> = {
  national_direct: "National administration",
  national_floor: "National minimum standard",
  concurrent: "Shared national and regional administration",
  grant_supported_regional: "National grants with regional administration",
  regional_discretion: "Leave administration to regions",
};

export interface JurisdictionAdministrationChoice {
  allowedJurisdictionModes: JurisdictionMode[];
  defaultJurisdictionMode: JurisdictionMode;
}

export function commonJurisdictionChoices(
  administrations: Array<JurisdictionAdministrationChoice | undefined>
): { modes: JurisdictionMode[]; defaultMode?: JurisdictionMode } {
  if (administrations.length === 0 || administrations.some((value) => !value)) {
    return { modes: [] };
  }
  const complete = administrations as JurisdictionAdministrationChoice[];
  const modes = JURISDICTION_MODES.filter((mode) =>
    complete.every((administration) => administration.allowedJurisdictionModes.includes(mode))
  );
  const authoredDefaults = new Set(
    complete.map((administration) => administration.defaultJurisdictionMode)
  );
  const authoredDefault = authoredDefaults.size === 1 ? [...authoredDefaults][0] : undefined;
  const defaultMode =
    authoredDefault && modes.includes(authoredDefault)
      ? authoredDefault
      : modes.includes("national_direct")
        ? "national_direct"
        : modes[0];
  return { modes: [...modes], ...(defaultMode ? { defaultMode } : {}) };
}

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
