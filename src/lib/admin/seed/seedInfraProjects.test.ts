import { describe, it, expect } from "vitest";
import { buildCountryPipeline } from "./seedInfraProjects";
import { getInfraArchetype } from "@/lib/constants/cabinetInfra";

describe("buildCountryPipeline", () => {
  it("is deterministic", () => {
    const a = buildCountryPipeline("US", "secretary_of_transportation", ["US-CA", "US-TX"], 5);
    const b = buildCountryPipeline("US", "secretary_of_transportation", ["US-CA", "US-TX"], 5);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
  it("seeds a mix of operational + in-progress construction with valid archetypes", () => {
    const pipe = buildCountryPipeline("US", "secretary_of_transportation", ["US-CA", "US-TX"], 5);
    expect(pipe.some((p) => p.status === "operational")).toBe(true);
    expect(pipe.some((p) => p.status === "construction")).toBe(true);
    for (const p of pipe) {
      expect(getInfraArchetype(p.archetypeId)).toBeDefined();
      expect(["US-CA", "US-TX"]).toContain(p.regionId);
      expect(p.positionId).toBe("secretary_of_transportation");
      expect(p.buildDuration).toBeGreaterThan(0);
      if (p.status === "construction") {
        expect(p.progress).toBeGreaterThanOrEqual(0);
        expect(p.progress).toBeLessThan(p.buildDuration);
      }
    }
  });
  it("returns [] when no regions", () => {
    expect(buildCountryPipeline("US", "secretary_of_transportation", [], 1)).toEqual([]);
  });

  it("excludes anachronistic broadband in an early-era world", () => {
    // A 1953 world predates commercial broadband (windows 1998) — no broadband
    // archetype may seed, regardless of the deterministic RNG draw.
    const regionIds = Array.from({ length: 12 }, (_, i) => `US-R${i}`);
    for (const seat of ["secretary_of_transportation", "transport_secretary"]) {
      const pipe = buildCountryPipeline("US", seat, regionIds, 1, "1953");
      expect(pipe.length).toBeGreaterThan(0);
      expect(pipe.some((p) => p.archetypeId === "broadband")).toBe(false);
    }
  });

  it("includes broadband in a modern-era world", () => {
    // Across countries the pool contains broadband post-1998; at least one
    // country's deterministic draw lands it, proving it is not gated out.
    const regionIds = Array.from({ length: 12 }, (_, i) => `R${i}`);
    const anySeedsBroadband = ["US", "UK", "DE", "JP"].some((c) =>
      buildCountryPipeline(c, "transport", regionIds, 1, "2019").some(
        (p) => p.archetypeId === "broadband"
      )
    );
    expect(anySeedsBroadband).toBe(true);
  });

  it("is era-agnostic when no era is supplied (legacy callers)", () => {
    const withEra = buildCountryPipeline("US", "t", ["US-CA", "US-TX"], 5, undefined);
    const withoutEra = buildCountryPipeline("US", "t", ["US-CA", "US-TX"], 5);
    expect(withEra).toEqual(withoutEra);
  });
});
