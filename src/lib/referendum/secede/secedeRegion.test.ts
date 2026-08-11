import { describe, it, expect, vi } from "vitest";

// Heavy / getDb-coupled steps are mocked — the orchestrator's job is composition
// + ordering; the underlying steps are unit-tested in their own suites.
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
import {
  ensureSCOElections,
  ensureSCOGovernorElections,
  ensureSCORegionalCouncilElections,
} from "@/lib/turn/perpetualElections";

function seedWorld() {
  const male = Array.from({ length: 101 }, () => 100);
  return makeInMemoryStore({
    states: [
      { _id: "SCO", countryId: "UK", regionType: "nation", population: 5_440_000, gdp: 163_000 },
      { _id: "LON", countryId: "UK", regionType: "region", population: 9_000_000, gdp: 837_000 },
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
    statePolicies: [{ _id: "pol1", countryId: "UK", stateId: "SCO" }],
    federalBudget: [
      {
        _id: "UK",
        countryId: "UK",
        taxBases: { income: 1000 },
        treasuryBalance: -500,
        debt: { principal: 500, interestRate: 3 },
        gdp: 1000,
        currencyCode: "GBP",
      },
    ],
    politicalParties: [
      { _id: "snp", sequentialId: 20, countryId: "UK", name: "SNP", abbreviation: "SNP" },
      { _id: "lab", sequentialId: 21, countryId: "UK", name: "Labour", abbreviation: "LAB" },
      { _id: "con", sequentialId: 22, countryId: "UK", name: "Conservative", abbreviation: "CON" },
    ],
    electedOfficials: [
      {
        _id: "mpSNP",
        countryId: "UK",
        officeType: "commons",
        state: "SCO",
        party: "20",
        characterId: "x1",
      },
      { _id: "mpLAB", countryId: "UK", officeType: "commons", state: "SCO", party: "21" },
      { _id: "mpCON", countryId: "UK", officeType: "commons", state: "SCO", party: "22" },
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
      { _id: "UK_SCO_21", countryId: "UK", stateId: "SCO", partyId: "21", organization: 50 },
      { _id: "UK_SCO_22", countryId: "UK", stateId: "SCO", partyId: "22", organization: 30 },
      { _id: "UK_ENG_21", countryId: "UK", stateId: "ENG", partyId: "21", organization: 70 },
    ],
    characters: [
      { _id: "cA", homeState: "SCO", countryId: "UK", party: "20" },
      { _id: "cB", homeState: "SCO", countryId: "UK", party: "22" },
    ],
  });
}

describe("secedeRegion", () => {
  it("stands Scotland up as a country end-to-end", async () => {
    const { db, cols } = seedWorld();
    const res = await secedeRegion(db, { regionId: "SCO", fromCountryId: "UK", currentTurn: 300 });

    expect(res.ok).toBe(true);
    const ids = scoRegions.map((s) => s._id);

    // Country registered + data stood up.
    expect(cols.countryGameStates.find((c) => c._id === "SCO")).toMatchObject({ status: "active" });
    expect(
      cols.states
        .filter((s) => s.countryId === "SCO")
        .map((s) => s._id)
        .sort()
    ).toEqual([...ids].sort());
    expect(cols.states.find((s) => s._id === "SCO" && s.regionType === "nation")).toBeUndefined();
    expect(cols.federalBudget.find((b) => b._id === "SCO")).toMatchObject({ currencyCode: "GBP" });

    // The full devolved election slate is stood up at secession — chamber AND
    // regional governors AND regional councils (not just the chamber), since the
    // governor/council turn phases miss the activation turn.
    expect(ensureSCOElections).toHaveBeenCalled();
    expect(ensureSCOGovernorElections).toHaveBeenCalled();
    expect(ensureSCORegionalCouncilElections).toHaveBeenCalled();

    // Government: SNP transfers wholesale; LAB independentized (UK parent only),
    // MPs → holyrood, FM → head of gov.
    expect(cols.politicalParties.find((p) => p._id === "snp")).toMatchObject({ countryId: "SCO" });
    expect(cols.politicalParties.filter((p) => p.abbreviation === "LAB")).toHaveLength(1);
    expect(cols.electedOfficials.find((o) => o._id === "mpSNP")).toMatchObject({
      countryId: "SCO",
      officeType: "holyrood",
    });
    expect(cols.electedOfficials.find((o) => o._id === "fm")).toMatchObject({
      countryId: "SCO",
      officeType: "firstMinister",
    });
    expect(cols.governmentFormations[0]).toMatchObject({ _id: "SCO" });

    // Residents re-homed; rump-UK keeps its own region.
    expect(cols.characters.find((c) => c._id === "cA")).toMatchObject({
      countryId: "SCO",
      homeState: "LOT",
    });
    expect(cols.states.find((s) => s._id === "LON")).toMatchObject({ countryId: "UK" });
  });

  it("guards: region-not-found and already-seceded", async () => {
    const { db } = seedWorld();
    expect(
      await secedeRegion(db, { regionId: "WAL", fromCountryId: "UK", currentTurn: 1 })
    ).toEqual({
      ok: false,
      skipped: "region-not-found",
    });
    await secedeRegion(db, { regionId: "SCO", fromCountryId: "UK", currentTurn: 300 });
    expect(
      await secedeRegion(db, { regionId: "SCO", fromCountryId: "UK", currentTurn: 301 })
    ).toEqual({ ok: true, skipped: "already-seceded" });
  });
});
