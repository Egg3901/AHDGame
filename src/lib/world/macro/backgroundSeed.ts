import type { WorldEntityManifestEntry } from "@/lib/world/worldEntityManifest";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { buildMacroCountryFromSpec } from "./seedBuilder";
import type { MacroCountryState } from "./types";
import { buildBackgroundMacroSpec } from "./rules/backgroundProfile";

/**
 * Builds an intentionally coarse, deterministic aggregate profile. These
 * estimates are a lower simulation tier, not historical-statistics claims.
 */
export function buildBackgroundMacroCountry(
  entry: WorldEntityManifestEntry,
  presetId: string,
  now = new Date()
): MacroCountryState {
  const year = getStartingYearForPreset(presetId);
  const spec = buildBackgroundMacroSpec(
    entry.entityId,
    entry.displayName,
    entry.economicArchetype,
    year
  );
  return buildMacroCountryFromSpec(spec, now, {
    presetId,
    simulationTier: "background-macro",
    provenance: "estimated-background",
  });
}
