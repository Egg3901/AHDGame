import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  ACTOR_COVERAGE_REGISTRY_VERSION,
  ACTOR_GATED_MECHANICS,
  actorCoverageSeams,
  actorCoverageWarnings,
  assertKnownActorMechanic,
  evaluateActorCoverage,
  uncoveredEntries,
  UNCOVERED_PRESIDENTIAL_NOMINATION,
  type ActorPopulationSnapshot,
} from "./actorCoverage";
import { snapshotActorPopulation } from "./syntheticActors";

function pureNppSnapshot(): ActorPopulationSnapshot {
  return snapshotActorPopulation({
    mode: "pure-npp",
    preset: "1953-default",
    characters: 0,
    users: 0,
    syntheticCharacters: 0,
    syntheticUsers: 0,
  });
}

function syntheticSnapshot(): ActorPopulationSnapshot {
  return snapshotActorPopulation({
    mode: "synthetic",
    preset: "1953-default",
    characters: 7,
    users: 7,
    syntheticCharacters: 7,
    syntheticUsers: 7,
    statePartyCandidates: 3,
    crisisDecidedInteractions: 1,
    wealthListRows: 2,
    playerFoundedCorps: 2,
  });
}

describe("actor-coverage registry", () => {
  it("pins twelve mechanics covering every issue thread", () => {
    expect(ACTOR_GATED_MECHANICS.map((m) => m.id)).toEqual([
      "presidential-nomination",
      "central-bank-chair-us",
      "central-bank-chair-non-us",
      "player-country-offices",
      "state-party-leadership",
      "campaigns-player-actions",
      "crisis-decisions",
      "character-wealth",
      "household-wealth",
      "corp-founding-private",
      "corp-founding-ipo",
      "dd-finance-minister-survey",
    ]);
  });

  it("gives every mechanic a pure-NPP and a synthetic verdict", () => {
    for (const mechanic of ACTOR_GATED_MECHANICS) {
      expect(["covered", "partial", "unreachable"]).toContain(mechanic.pureNpp.status);
      expect(["covered", "partial", "unreachable"]).toContain(mechanic.synthetic.status);
      expect(mechanic.seams.length).toBeGreaterThan(0);
    }
  });

  it("keeps every seam anchor present in the named source file (drift guard)", () => {
    const root = process.cwd();
    expect(actorCoverageSeams().length).toBeGreaterThan(0);
    for (const seam of actorCoverageSeams()) {
      const path = join(root, seam.path);
      expect(existsSync(path), `seam file missing: ${seam.path}`).toBe(true);
      expect(readFileSync(path, "utf8")).toContain(seam.anchor);
    }
  });

  it("rejects unregistered mechanic ids", () => {
    expect(() => assertKnownActorMechanic("nope")).toThrow("Unknown actor-gated mechanic");
    expect(assertKnownActorMechanic("crisis-decisions")).toBe("crisis-decisions");
  });
});

describe("evaluateActorCoverage", () => {
  it("reports pure-NPP vacancies honestly: 9 unreachable, 3 partial, 0 covered", () => {
    const manifest = evaluateActorCoverage(pureNppSnapshot(), "1953-01-01T00:00:00.000Z");
    expect(manifest.registryVersion).toBe(ACTOR_COVERAGE_REGISTRY_VERSION);
    expect(manifest.mechanicCount).toBe(12);
    expect(manifest.mode).toBe("pure-npp");
    const byStatus = new Map(manifest.entries.map((e) => [e.id, e.status]));
    expect(byStatus.get("presidential-nomination")).toBe("unreachable");
    expect(byStatus.get("central-bank-chair-us")).toBe("unreachable");
    expect(byStatus.get("state-party-leadership")).toBe("unreachable");
    expect(byStatus.get("campaigns-player-actions")).toBe("unreachable");
    expect(byStatus.get("character-wealth")).toBe("unreachable");
    expect(byStatus.get("household-wealth")).toBe("unreachable");
    expect(byStatus.get("corp-founding-private")).toBe("unreachable");
    expect(byStatus.get("corp-founding-ipo")).toBe("unreachable");
    expect(byStatus.get("dd-finance-minister-survey")).toBe("unreachable");
    expect(byStatus.get("central-bank-chair-non-us")).toBe("partial");
    expect(byStatus.get("player-country-offices")).toBe("partial");
    expect(byStatus.get("crisis-decisions")).toBe("partial");
    // No synthetic actors exist, so nothing may read covered in pure NPP mode.
    expect(manifest.entries.filter((e) => e.status === "covered")).toHaveLength(0);
    expect(uncoveredEntries(manifest)).toHaveLength(12);
  });

  it("uses the exact uncovered string for the presidential-nomination gate", () => {
    expect(UNCOVERED_PRESIDENTIAL_NOMINATION).toBe("uncovered: presidential nomination");
    const manifest = evaluateActorCoverage(pureNppSnapshot(), "1953-01-01T00:00:00.000Z");
    const chair = manifest.entries.find((e) => e.id === "central-bank-chair-us");
    expect(chair?.reason).toContain(UNCOVERED_PRESIDENTIAL_NOMINATION);
  });

  it("covers every mechanic but campaigns once synthetic actors are materialized", () => {
    const manifest = evaluateActorCoverage(syntheticSnapshot(), "1953-01-01T00:00:00.000Z");
    // 11 covered + 1 partial: campaigns accrue through the production rule
    // and a flow driver exists, but this run retained no full-sequence
    // purchase, so the manifest stays honest.
    expect(manifest.entries.filter((e) => e.status === "covered")).toHaveLength(11);
    expect(uncoveredEntries(manifest)).toHaveLength(1);
    const campaigns = manifest.entries.find((e) => e.id === "campaigns-player-actions");
    expect(campaigns?.status).toBe("partial");
    expect(campaigns?.reason).toContain("no successful full-sequence purchase");
    expect(actorCoverageWarnings(manifest)).toHaveLength(1);
  });

  it("marks campaigns covered only on retained flow-driver evidence", () => {
    const snapshot = snapshotActorPopulation({
      mode: "synthetic",
      preset: "1953-default",
      characters: 7,
      users: 7,
      syntheticCharacters: 7,
      syntheticUsers: 7,
      statePartyCandidates: 3,
      crisisDecidedInteractions: 1,
      wealthListRows: 2,
      playerFoundedCorps: 2,
      oppoFlowSucceeded: true,
    });
    const manifest = evaluateActorCoverage(snapshot, "1953-01-01T00:00:00.000Z");
    expect(manifest.registryVersion).toBe(ACTOR_COVERAGE_REGISTRY_VERSION);
    expect(manifest.entries.filter((e) => e.status === "covered")).toHaveLength(12);
    expect(uncoveredEntries(manifest)).toHaveLength(0);
    const campaigns = manifest.entries.find((e) => e.id === "campaigns-player-actions");
    expect(campaigns?.status).toBe("covered");
    expect(campaigns?.reason).toContain("opposition-research flow driver");
    expect(campaigns?.evidence).toContain("oppoFlowSucceeded=true");
    expect(actorCoverageWarnings(manifest)).toHaveLength(0);
  });

  it("degrades synthetic mode without materialized actors to unreachable, never covered", () => {
    const snapshot = snapshotActorPopulation({
      mode: "synthetic",
      preset: "1953-default",
      characters: 0,
      users: 0,
      syntheticCharacters: 0,
      syntheticUsers: 0,
    });
    const manifest = evaluateActorCoverage(snapshot, "1953-01-01T00:00:00.000Z");
    expect(manifest.entries.filter((e) => e.status === "covered")).toHaveLength(0);
    const chair = manifest.entries.find((e) => e.id === "central-bank-chair-us");
    expect(chair?.status).toBe("unreachable");
    expect(chair?.reason).toContain("zero synthetic characters");
  });

  it("embeds live population evidence in every entry", () => {
    const manifest = evaluateActorCoverage(syntheticSnapshot(), "1953-01-01T00:00:00.000Z");
    for (const entry of manifest.entries) {
      expect(entry.evidence).toContain("characters=7");
    }
    const candidacy = manifest.entries.find((e) => e.id === "state-party-leadership");
    expect(candidacy?.evidence).toContain("statePartyCandidates=3");
    const wealth = manifest.entries.find((e) => e.id === "household-wealth");
    expect(wealth?.evidence).toContain("wealthListRows=2");
    const ipo = manifest.entries.find((e) => e.id === "corp-founding-ipo");
    expect(ipo?.evidence).toContain("playerFoundedCorps=2");
  });
});

describe("actorCoverageWarnings", () => {
  it("warns truthfully: one warning per uncovered mechanic, naming mode and preset", () => {
    const manifest = evaluateActorCoverage(pureNppSnapshot(), "1953-01-01T00:00:00.000Z");
    const warnings = actorCoverageWarnings(manifest);
    expect(warnings).toHaveLength(12);
    for (const warning of warnings) {
      expect(warning).toContain("ACTOR-COVERAGE WARNING");
      expect(warning).toContain("pure-npp");
      expect(warning).toContain("1953-default");
      expect(warning).toMatch(/UNREACHABLE|PARTIAL/);
    }
  });

  it("never tells a reader to treat vacancies as balance evidence", () => {
    const manifest = evaluateActorCoverage(pureNppSnapshot(), "1953-01-01T00:00:00.000Z");
    for (const warning of actorCoverageWarnings(manifest)) {
      expect(warning).toContain("Do not present null, zero, or permanently vacant readings");
    }
  });
});
