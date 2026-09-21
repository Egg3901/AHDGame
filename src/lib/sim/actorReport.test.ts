import { describe, expect, it } from "vitest";
import {
  ACTOR_COVERAGE_SECTION_HEADING,
  buildActorCoverageSection,
  summarizeActorCoverageForVerdict,
} from "./actorReport";
import { evaluateActorCoverage } from "./actorCoverage";
import { snapshotActorPopulation } from "./syntheticActors";

describe("buildActorCoverageSection", () => {
  it("renders the full section for a pure-NPP manifest: 0/12 covered, 12 warnings", () => {
    const manifest = evaluateActorCoverage(
      snapshotActorPopulation({
        mode: "pure-npp",
        preset: "1953-default",
        characters: 0,
        users: 0,
        syntheticCharacters: 0,
        syntheticUsers: 0,
      }),
      "1953-01-01T00:00:00.000Z"
    );
    const section = buildActorCoverageSection(manifest);
    expect(section.heading).toBe(ACTOR_COVERAGE_SECTION_HEADING);
    expect(section.mode).toBe("pure-npp");
    expect(section.mechanicCount).toBe(12);
    expect(section.coveredCount).toBe(0);
    expect(section.uncoveredCount).toBe(12);
    expect(section.warnings).toHaveLength(12);
    expect(section.lines[0]).toContain("0/12 mechanics covered");
    // Warnings render inline, first, so no reader meets a chart before them.
    expect(section.lines.slice(1)).toEqual(section.warnings);
  });

  it("renders one partial warning for campaigns in synthetic mode", () => {
    const manifest = evaluateActorCoverage(
      snapshotActorPopulation({
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
      }),
      "1953-01-01T00:00:00.000Z"
    );
    const section = buildActorCoverageSection(manifest);
    // 11 covered + 1 partial (campaigns: accrual but no retained
    // full-sequence purchase), so the section warns exactly once instead of
    // reading clean.
    expect(section.coveredCount).toBe(11);
    expect(section.uncoveredCount).toBe(1);
    expect(section.warnings).toHaveLength(1);
    expect(section.warnings[0]).toContain("Campaigns and player actions");
  });

  it("passes the synthetic-unseeded degradation through to reports", () => {
    const manifest = evaluateActorCoverage(
      snapshotActorPopulation({
        mode: "synthetic",
        preset: "1953-default",
        characters: 0,
        users: 0,
        syntheticCharacters: 0,
        syntheticUsers: 0,
      }),
      "1953-01-01T00:00:00.000Z"
    );
    const section = buildActorCoverageSection(manifest);
    expect(section.coveredCount).toBe(0);
    expect(section.warnings.length).toBeGreaterThan(0);
    expect(section.warnings.some((w) => w.includes("zero synthetic characters"))).toBe(true);
  });
});

describe("summarizeActorCoverageForVerdict", () => {
  it("warns, never passes silently, when the run predates manifest stamping", () => {
    const verdict = summarizeActorCoverageForVerdict(null);
    expect(verdict.status).toBe("warn");
    expect(verdict.title).toContain("predates manifest stamping");
  });

  it("reads warn while campaigns stay partial in synthetic mode", () => {
    const manifest = evaluateActorCoverage(
      snapshotActorPopulation({
        mode: "synthetic",
        preset: "1953-default",
        characters: 7,
        users: 7,
        syntheticCharacters: 7,
        syntheticUsers: 7,
      }),
      "1953-01-01T00:00:00.000Z"
    );
    const verdict = summarizeActorCoverageForVerdict(manifest);
    expect(verdict.status).toBe("warn");
    expect(verdict.title).toContain("1 mechanic(s) partial or unreachable");
    expect(verdict.detail).toContain("Campaigns and player actions");
  });

  it("reads warn (never bad) for partial/unreachable mechanics: harness limits, not engine defects", () => {
    const manifest = evaluateActorCoverage(
      snapshotActorPopulation({
        mode: "pure-npp",
        preset: "1953-default",
        characters: 0,
        users: 0,
        syntheticCharacters: 0,
        syntheticUsers: 0,
      }),
      "1953-01-01T00:00:00.000Z"
    );
    const verdict = summarizeActorCoverageForVerdict(manifest);
    expect(verdict.status).toBe("warn");
    expect(verdict.title).toContain("partial or unreachable");
    expect(verdict.detail).toContain("State-party leadership elections");
  });
});
