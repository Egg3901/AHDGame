import type { EditorStateConfig, DerivedComposition, EraId } from "./types";

export function stateConfigToCsv(cfg: EditorStateConfig, derived: DerivedComposition): string {
  const lines: string[] = [];
  lines.push("section,era,country,state,a,b,c,d,e,f");
  for (const dim of cfg.dims) {
    for (const [key, e] of Object.entries(cfg.layer1[dim])) {
      lines.push(
        `layer1,${cfg.era},${cfg.countryId},${cfg.stateId},${dim},${key},${e.share},${e.turnout},${e.economicLean},${e.socialLean}`
      );
    }
  }
  for (const a of cfg.archetypes) {
    for (const w of a.weights) {
      lines.push(
        `composition,${cfg.era},${cfg.countryId},${cfg.stateId},${a.id},${w.dim},${w.key},${w.w},${a.civicMultiplier},`
      );
    }
  }
  for (const a of derived.archetypes) {
    lines.push(
      `derived,${cfg.era},${cfg.countryId},${cfg.stateId},${a.id},${a.populationShare},${a.votingPoolShare},${a.economicLean},${a.socialLean},${a.turnout}`
    );
  }
  lines.push(
    `state,${cfg.era},${cfg.countryId},${cfg.stateId},${derived.stateEconomicLean},${derived.stateSocialLean},${derived.stateDisplayLean},,,`
  );
  return lines.join("\n");
}

export function allStatesLeanToCsv(
  era: EraId,
  country: string,
  rows: Array<{ stateId: string; economic: number; social: number; display: number }>
): string {
  const lines = ["era,country,state,economic,social,display"];
  for (const r of rows)
    lines.push(`${era},${country},${r.stateId},${r.economic},${r.social},${r.display}`);
  return lines.join("\n");
}

/** Full-country CSV export — every state's Layer-1, composition, derived, and lean.
 *  Includes localStorage edits (overrides) when passed as `configs`. */
export function allStatesFullToCsv(
  era: EraId,
  country: string,
  states: Array<{ stateId: string; config: EditorStateConfig; derived: DerivedComposition }>
): string {
  const lines: string[] = [];
  lines.push("section,era,country,state,a,b,c,d,e,f,g,h");

  for (const { stateId, config, derived } of states) {
    // Layer-1 rows
    for (const dim of config.dims) {
      for (const [key, e] of Object.entries(config.layer1[dim])) {
        lines.push(
          `layer1,${era},${country},${stateId},${dim},${key},${e.share},${e.turnout},${e.economicLean},${e.socialLean},,`
        );
      }
    }
    // Composition rows
    for (const a of config.archetypes) {
      for (const w of a.weights) {
        lines.push(
          `composition,${era},${country},${stateId},${a.id},${w.dim},${w.key},${w.w},${a.civicMultiplier},,,`
        );
      }
    }
    // Derived archetype rows
    for (const a of derived.archetypes) {
      lines.push(
        `derived,${era},${country},${stateId},${a.id},${a.populationShare},${a.votingPoolShare},${a.economicLean},${a.socialLean},${a.turnout},,`
      );
    }
    // State lean row
    lines.push(
      `state,${era},${country},${stateId},${derived.stateEconomicLean},${derived.stateSocialLean},${derived.stateDisplayLean},,,,,`
    );
  }

  return lines.join("\n");
}

/** Browser download helper. */
export function downloadCsv(filename: string, content: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
