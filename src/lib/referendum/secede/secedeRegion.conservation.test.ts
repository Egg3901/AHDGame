/**
 * SP2d cross-country conservation invariant: after a region secedes, the post
 * state (rump-UK + the new country) sums back to the pre-state totals for
 * population, GDP, and treasury/tax/debt, and no doc is left orphaned on the old
 * aggregate. The heavy/getDb-coupled steps are mocked (tested in their own suites).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/turn/perpetualElections", () => ({
  ensureSCOElections: vi.fn().mockResolvedValue(undefined),
  ensureWALElections: vi.fn().mockResolvedValue(undefined),
  ensureSCOGovernorElections: vi.fn().mockResolvedValue(undefined),
  ensureWALGovernorElections: vi.fn().mockResolvedValue(undefined),
  ensureSCORegionalCouncilElections: vi.fn().mockResolvedValue(undefined),
  ensureWALRegionalCouncilElections: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/nationalMetrics", () => ({
  computeNationalMetrics: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({
  recordCountryEvent: vi.fn().mockResolvedValue(undefined),
}));

import { makeInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import { secedeRegion } from "./secedeRegion";
import { scoRegions } from "@/lib/seeds/sco/scoRegions";

// Aggregate SCO totals match the SP1 sub-region seeds (5.44M pop, 163k gdp).
const SCO_POP = scoRegions.reduce((s, r) => s + r.population, 0);
const SCO_GDP = scoRegions.reduce((s, r) => s + (r.gdp ?? 0), 0);
const LON_POP = 9_000_000;
const LON_GDP = 837_000;

function seedWorld() {
  const male = Array.from({ length: 101 }, () => 100);
  return makeInMemoryStore({
    states: [
      { _id: "SCO", countryId: "UK", regionType: "nation", population: SCO_POP, gdp: SCO_GDP },
      { _id: "LON", countryId: "UK", regionType: "region", population: LON_POP, gdp: LON_GDP },
    ],
    macroMetrics: [{ _id: "SCO", countryId: "UK", approval: 47 }],
    regionDemographics: [{ _id: "SCO", countryId: "UK", ages: { male, female: male } }],
    stateRegistrationPool: [
      { _id: "UK_SCO", countryId: "UK", stateId: "SCO", independent: 30, unregistered: 20 },
    ],
    corporateSectors: Array.from({ length: 8 }, (_, i) => ({
      _id: `s${i}`,
      countryId: "UK",
      stateId: "SCO",
      revenue: 50,
    })),
    regionalBudgets: [{ _id: "SCO", countryId: "UK", totalBudget: 1000, surplus: 100 }],
    federalBudget: [
      {
        _id: "UK",
        countryId: "UK",
        taxBases: { income: 1000 },
        treasuryBalance: -500,
        debt: { principal: 500, interestRate: 3 },
        gdp: SCO_GDP + LON_GDP,
        currencyCode: "GBP",
      },
    ],
    politicalParties: [
      { _id: "snp", sequentialId: 20, countryId: "UK", name: "SNP", abbreviation: "SNP" },
      { _id: "lab", sequentialId: 21, countryId: "UK", name: "Labour", abbreviation: "LAB" },
    ],
    electedOfficials: [
      { _id: "mpSNP", countryId: "UK", officeType: "commons", state: "SCO", party: "20" },
      { _id: "mpEng", countryId: "UK", officeType: "commons", state: "ENG", party: "21" },
      {
        _id: "fm",
        countryId: "UK",
        officeType: "governor",
        state: "SCO",
        party: "20",
        characterId: "fmChar",
      },
    ],
    statePartyOrg: [
      { _id: "UK_SCO_20", countryId: "UK", stateId: "SCO", partyId: "20", organization: 60 },
      { _id: "UK_ENG_21", countryId: "UK", stateId: "ENG", partyId: "21", organization: 70 },
    ],
    characters: [{ _id: "cA", homeState: "SCO", countryId: "UK", party: "20" }],
  });
}

describe("secedeRegion — conservation invariant", () => {
  it("conserves population, GDP, and treasury across the split", async () => {
    const { db, cols } = seedWorld();
    await secedeRegion(db, { regionId: "SCO", fromCountryId: "UK", currentTurn: 300 });

    const sumPop = (cid: string) =>
      cols.states
        .filter((s) => s.countryId === cid)
        .reduce((a, s) => a + (s.population as number), 0);
    const sumGdp = (cid: string) =>
      cols.states.filter((s) => s.countryId === cid).reduce((a, s) => a + (s.gdp as number), 0);

    // Population + GDP: Σ(SCO) + Σ(rump-UK) === pre-state UK total.
    expect(sumPop("SCO") + sumPop("UK")).toBe(SCO_POP + LON_POP);
    expect(sumGdp("SCO") + sumGdp("UK")).toBe(SCO_GDP + LON_GDP);
    expect(sumPop("SCO")).toBe(SCO_POP); // the seceded sub-regions carry the region's people

    // Treasury / taxBases / debt: Σ(UK_after, SCO) === UK_before.
    const sco = cols.federalBudget.find((b) => b._id === "SCO") as {
      taxBases: { income: number };
      treasuryBalance: number;
      debt: { principal: number };
    };
    const uk = cols.federalBudget.find((b) => b._id === "UK") as typeof sco;
    expect(sco.taxBases.income + uk.taxBases.income).toBeCloseTo(1000, 6);
    expect(sco.treasuryBalance + uk.treasuryBalance).toBeCloseTo(-500, 6);
    expect(sco.debt.principal + uk.debt.principal).toBeCloseTo(500, 6);
  });

  it("leaves no doc orphaned on the old aggregate", async () => {
    const { db, cols } = seedWorld();
    await secedeRegion(db, { regionId: "SCO", fromCountryId: "UK", currentTurn: 300 });

    expect(cols.states.some((s) => s._id === "SCO")).toBe(false);
    expect(cols.macroMetrics.some((m) => m._id === "SCO")).toBe(false);
    expect(cols.corporateSectors.some((s) => s.stateId === "SCO")).toBe(false);
    expect(cols.stateRegistrationPool.some((p) => p._id === "UK_SCO")).toBe(false);
    expect(cols.characters.some((c) => c.homeState === "SCO")).toBe(false);
    expect(
      cols.electedOfficials.some((o) => o.countryId === "SCO" && o.officeType === "commons")
    ).toBe(false);
  });
});
