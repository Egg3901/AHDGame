import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { COUNTRY_ELECTION_PHASE_NAMES } from "./countryElectionPhaseNames";

// A progress-only import must not initialize any executable election phases.
vi.mock("@/lib/turn/countryPhases", () => {
  throw new Error("Turn progress imported the election engine");
});

describe("country phase metadata", () => {
  it("loads turn progress without loading country phase implementations", async () => {
    const { computeTurnProcessingProgress } = await import("@/lib/turn/turnProgress");
    expect(computeTurnProcessingProgress("ukElections")).toBeGreaterThan(0);
  });

  it("preserves the complete executable registry order, including Japan", () => {
    const registry = readFileSync("src/lib/turn/countryPhases.ts", "utf8");
    const japan = readFileSync("src/lib/countries/jp/elections.ts", "utf8");
    const block = registry.slice(
      registry.indexOf("export const COUNTRY_ELECTION_PHASES:"),
      registry.indexOf("// ─── Parliamentary government helpers")
    );
    const japanPhases = japan.slice(
      japan.indexOf("const phases:"),
      japan.indexOf("export const JP_ELECTIONS")
    );
    const expanded = block.replace("JP: JP_ELECTIONS.electionPhases,", japanPhases);
    const names = [...expanded.matchAll(/\bname:\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(40);
    expect(COUNTRY_ELECTION_PHASE_NAMES).toEqual(names);
  });
});
