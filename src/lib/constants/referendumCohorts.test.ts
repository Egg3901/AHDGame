import { describe, it, expect } from "vitest";
import { cohortAffinitiesFor, REFERENDUM_COHORT_AFFINITY } from "./referendumCohorts";
import { turnoutTargetIdsForCountry } from "@/lib/demographics/turnoutTargets";

describe("referendum cohort affinities", () => {
  it("exposes NIR affinities and returns {} for an unseeded region", () => {
    expect(REFERENDUM_COHORT_AFFINITY.NIR).toBeTruthy();
    expect(cohortAffinitiesFor("NIR")).toBe(REFERENDUM_COHORT_AFFINITY.NIR);
    expect(cohortAffinitiesFor("nir")).toBe(REFERENDUM_COHORT_AFFINITY.NIR);
    expect(cohortAffinitiesFor("ZZ")).toEqual({});
  });

  it("seeds SCO and WAL too", () => {
    expect(REFERENDUM_COHORT_AFFINITY.SCO).toBeTruthy();
    expect(REFERENDUM_COHORT_AFFINITY.WAL).toBeTruthy();
  });

  it("affinities are bounded relative offsets on buckets the UK electorate has", () => {
    // The affinity keys must be targetable buckets, not free-text: a key that
    // names no bucket contributes nothing and reads exactly like one that does.
    const realIds = turnoutTargetIdsForCountry("UK");
    for (const region of Object.values(REFERENDUM_COHORT_AFFINITY)) {
      for (const [bucketId, v] of Object.entries(region)) {
        expect(realIds.has(bucketId)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(-50);
        expect(v).toBeLessThanOrEqual(50);
      }
    }
  });

  it("gives the three regions genuinely different coalitions", () => {
    // The point of hand-authoring rather than projecting: Scottish
    // independence is class-inflected in a way Welsh independence is not, and
    // Welsh independence is the only one of the three where rural is a Yes
    // cohort (Welsh-speaking Gwynedd and Ceredigion).
    const sco = REFERENDUM_COHORT_AFFINITY.SCO;
    const wal = REFERENDUM_COHORT_AFFINITY.WAL;
    expect(sco["income:low"] - sco["income:high"]).toBeGreaterThan(
      wal["income:low"] - wal["income:high"]
    );
    expect(wal["urbanization:rural"]).toBeGreaterThan(0);
    expect(sco["urbanization:rural"]).toBeLessThan(0);
  });
});
