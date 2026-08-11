import { describe, expect, it } from "vitest";
import { evaluateModifiers } from "./approvalModifiers";

const metrics = (econ: Record<string, number>) =>
  ({ economic: econ }) as Record<string, Record<string, number>>;

describe("era-aware modifier evaluation", () => {
  it("no year → identical active set (regression invariant)", () => {
    const m = metrics({ gdpGrowth: 2.6, unemploymentRate: 5.0 });
    const legacy = evaluateModifiers(m, { countryId: "US" });
    const withNull = evaluateModifiers(m, { countryId: "US", year: null });
    expect(withNull).toEqual(legacy);
  });
  it("year 2019 → identical active set (zero shift at reference)", () => {
    const m = metrics({ gdpGrowth: 2.6, unemploymentRate: 5.0 });
    expect(evaluateModifiers(m, { countryId: "US", year: 2019 })).toEqual(
      evaluateModifiers(m, { countryId: "US" })
    );
  });
  it("strong_growth (gdpGrowth >= 2.5) needs more growth in a high-growth era", () => {
    // 1970 normal is 3.6 vs 2019's 2.2 → threshold shifts up by +1.4 to 3.9.
    const m = metrics({ gdpGrowth: 2.6 });
    const ids2019 = evaluateModifiers(m, { year: 2019 }).map((x) => x.id);
    const ids1970 = evaluateModifiers(m, { year: 1970 }).map((x) => x.id);
    expect(ids2019).toContain("strong_growth");
    expect(ids1970).not.toContain("strong_growth");
  });
  it("low_unemployment (<= 3.5) is easier when the era's normal was higher", () => {
    // 1980 normal 7.0 vs 2019's 4.0 → threshold shifts to <= 6.5.
    const m = metrics({ unemploymentRate: 5.0 });
    const ids2019 = evaluateModifiers(m, { year: 2019 }).map((x) => x.id);
    const ids1980 = evaluateModifiers(m, { year: 1980 }).map((x) => x.id);
    expect(ids2019).not.toContain("low_unemployment");
    expect(ids1980).toContain("low_unemployment");
  });
  it("conditions on non-curve metrics never shift", () => {
    // heavy_public_debt keys on governance.debtToGdp — not an era quantity.
    const m = { governance: { debtToGdp: 120 } } as Record<string, Record<string, number>>;
    expect(evaluateModifiers(m, { year: 1970 }).map((x) => x.id)).toContain("heavy_public_debt");
  });
  it("a condition on an INACTIVE metric never fires (low_broadband in a pre-window era)", () => {
    // broadbandAccess is windowed from 1998; seeded 0 in old-era worlds would
    // otherwise trip the low_broadband malus (<= 70) forever.
    const m = { infrastructure: { broadbandAccess: 0 } } as Record<string, Record<string, number>>;
    expect(evaluateModifiers(m, { countryId: "US", year: 1953 }).map((x) => x.id)).not.toContain(
      "low_broadband"
    );
    // legacy path (flag off) unchanged: fires as before
    expect(evaluateModifiers(m, { countryId: "US", year: null }).map((x) => x.id)).toContain(
      "low_broadband"
    );
    // active era: fires again on merit
    expect(evaluateModifiers(m, { countryId: "US", year: 2005 }).map((x) => x.id)).toContain(
      "low_broadband"
    );
  });
});
