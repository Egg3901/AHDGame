import { describe, it, expect } from "vitest";
import { SECEDE_FANOUT } from "./fanoutPolicy";
import { REGION_SCOPED_COLLECTIONS } from "@/lib/referendum/transfer/regionScopedCollections";

describe("SECEDE_FANOUT", () => {
  it("covers every region-scoped collection exactly once with a matching key", () => {
    const byName = new Map(SECEDE_FANOUT.map((f) => [f.collection, f]));
    expect(byName.size).toBe(SECEDE_FANOUT.length); // no dupes
    for (const scope of REGION_SCOPED_COLLECTIONS) {
      const f = byName.get(scope.collection);
      expect(f, `missing fan-out policy for ${scope.collection}`).toBeTruthy();
      expect(f!.key).toBe(scope.key);
    }
    expect(SECEDE_FANOUT.length).toBe(REGION_SCOPED_COLLECTIONS.length);
  });

  it("regionDemographics scales its age count vectors", () => {
    const f = SECEDE_FANOUT.find((x) => x.collection === "regionDemographics")!;
    expect(f.policy).toBe("scaleCounts");
    expect(f.countVectorFields).toEqual(["ages.male", "ages.female"]);
  });

  it("sectors distribute by GDP; pool re-keys; characters re-home", () => {
    const policyOf = (c: string) => SECEDE_FANOUT.find((x) => x.collection === c)!.policy;
    expect(policyOf("corporateSectors")).toBe("partitionGdp");
    expect(policyOf("unownedSectors")).toBe("partitionGdp");
    expect(policyOf("stateRegistrationPool")).toBe("rekeyCopyShares");
    expect(policyOf("characters")).toBe("rehomeCapital");
    expect(policyOf("statePolicies")).toBe("rehomeCapital");
    expect(policyOf("macroMetrics")).toBe("cloneIdentical");
    // BOTH halves of a region's metrics must fan out. The board is where
    // approval, corp margins and crisis triggers are scored from, so a
    // sub-region without one reads as unseeded across every one of those at
    // once — and the list carried only the retired legacy collection until the
    // stores were swapped under it.
    expect(policyOf("politicalMetrics")).toBe("cloneIdentical");
  });
});
