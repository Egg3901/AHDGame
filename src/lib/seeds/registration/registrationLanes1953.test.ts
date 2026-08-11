import { describe, expect, it } from "vitest";
import { build1953RegistrationSeeds } from "./registrationLanes1953";
import { validateSeed } from "./registrationLanes";

/**
 * Guards the 2026-08 US 1953 org/reg balance retune. The previous assignment
 * table gave Democrats an org+reg lead in 41 of 51 states; the retune keeps
 * the Democratic machine where it historically lived (Solid South + border +
 * Catholic-machine New England + DFL/UAW belt) and restores the strong 1950s
 * GOP state organizations everywhere else. The structural even-appeal share
 * band below is what `orgVoteWeight` (share^0.2) x `regResistanceMultiplier`
 * (1 + 0.3*reg/100) contributes to a two-way general election before any
 * electorate-lean signal — a mild Democratic machine edge, not a wall.
 */
describe("1953 four-country registration/org seeds", () => {
  const seeds = build1953RegistrationSeeds();

  it("covers exactly the playable countries' 80 political regions with valid rows", () => {
    expect(seeds).toHaveLength(80);
    expect(
      Object.fromEntries(
        ["US", "UK", "RU", "DD"].map((countryId) => [
          countryId,
          seeds.filter((seed) => seed.countryId === countryId).length,
        ])
      )
    ).toEqual({ US: 48, UK: 12, RU: 14, DD: 6 });
    const errors = seeds.map((s) => validateSeed(s)).filter((e): e is string => e !== null);
    expect(errors).toEqual([]);
  });

  it("does not create political pools for 1953 territories or DC", () => {
    const usIds = new Set(
      seeds.filter((seed) => seed.countryId === "US").map((seed) => seed.stateId)
    );
    expect(usIds.has("AK")).toBe(false);
    expect(usIds.has("HI")).toBe(false);
    expect(usIds.has("DC")).toBe(false);
  });

  it("keeps the Solid South structurally Democratic", () => {
    for (const stateId of ["MS", "AL", "SC", "GA", "LA", "AR", "TX", "OK", "KY", "WV"]) {
      const s = seeds.find((x) => x.countryId === "US" && x.stateId === stateId)!;
      const d = s.parties.find((p) => p.abbr === "DEM")!;
      const r = s.parties.find((p) => p.abbr === "REP")!;
      expect(d.org, `${stateId} org`).toBeGreaterThan(r.org);
      expect(d.reg, `${stateId} reg`).toBeGreaterThan(r.reg);
    }
  });

  it("does not hand Democrats a nationwide org/reg wall", () => {
    let dLead = 0;
    let rLead = 0;
    let structural = 0;
    const usSeeds = seeds.filter((seed) => seed.countryId === "US");
    for (const s of usSeeds) {
      const d = s.parties.find((p) => p.abbr === "DEM")!;
      const r = s.parties.find((p) => p.abbr === "REP")!;
      if (d.org > r.org && d.reg > r.reg) dLead++;
      else if (r.org > d.org && r.reg > d.reg) rLead++;
      // Even-appeal two-way D share implied by the structural multipliers the
      // general-election kernel actually applies (org^0.2 and reg resistance).
      const ratio =
        Math.pow(d.org / r.org, 0.2) * ((1 + (0.3 * d.reg) / 100) / (1 + (0.3 * r.reg) / 100));
      structural += ratio / (1 + ratio);
    }
    // 2026-08 retune measured: D-lead 29, R-lead 21, structural 51.6%.
    expect(dLead).toBeLessThanOrEqual(31);
    expect(rLead).toBeGreaterThanOrEqual(18);
    const meanStructural = structural / usSeeds.length;
    expect(meanStructural).toBeGreaterThan(0.5); // the D machine edge survives...
    expect(meanStructural).toBeLessThan(0.535); // ...but stays mild
  });
});
