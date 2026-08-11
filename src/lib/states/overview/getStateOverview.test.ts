import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { getStateOverview } from "./getStateOverview";

// Lightweight in-memory Mongo-like stub matching this aggregator's needs.
type Doc = Record<string, unknown>;

function matches(doc: Doc, query: Doc): boolean {
  for (const [key, val] of Object.entries(query)) {
    if (val && typeof val === "object" && "$in" in val) {
      const arr = (val as { $in: unknown[] }).$in;
      const docVal = doc[key];
      if (!arr.some((v) => v === docVal)) return false;
    } else if (doc[key] !== val) {
      return false;
    }
  }
  return true;
}

function makeStubDb(collections: Record<string, Doc[]>) {
  return {
    collection<T extends Doc>(name: string) {
      const docs = collections[name] ?? [];
      return {
        find(query: Doc = {}) {
          const hits = docs.filter((d) => matches(d, query));
          return {
            toArray: async () => hits as T[],
            sort: () => ({
              toArray: async () => hits as T[],
            }),
          };
        },
        findOne: async (query: Doc = {}, options?: { sort?: Record<string, number> }) => {
          // For our tests, sort doesn't matter — caller asserts on what's there.
          void options;
          const hit = docs.find((d) => matches(d, query));
          return (hit as T) ?? null;
        },
      };
    },
  };
}

describe("getStateOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the top party + sorted party org list + unaffiliated remainder", async () => {
    const db = makeStubDb({
      statePartyOrg: [
        { _id: "PA_dem", countryId: "US", stateId: "PA", partyId: "dem", organization: 42 },
        { _id: "PA_gop", countryId: "US", stateId: "PA", partyId: "gop", organization: 41 },
        { _id: "PA_wfp", countryId: "US", stateId: "PA", partyId: "wfp", organization: 4 },
      ],
      politicalParties: [
        {
          _id: "dem-oid",
          sequentialId: "dem",
          countryId: "US",
          abbreviation: "DEM",
          color: "#2563eb",
        },
        {
          _id: "gop-oid",
          sequentialId: "gop",
          countryId: "US",
          abbreviation: "GOP",
          color: "#dc2626",
        },
        {
          _id: "wfp-oid",
          sequentialId: "wfp",
          countryId: "US",
          abbreviation: "WFP",
          color: "#7c3aed",
        },
      ],
      states: [{ _id: "PA", countryId: "US", name: "Pennsylvania", gdp: 940_000_000_000 }],
      electedOfficials: [],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });

    expect(result.kpis.topPartyId).toBe("dem");
    expect(result.kpis.topPartyOrgPct).toBe(42);
    expect(result.partyOrg).toHaveLength(3);
    expect(result.partyOrg[0].id).toBe("dem");
    expect(result.partyOrg[0].abbr).toBe("DEM");
    expect(result.unaffiliatedPct).toBe(13); // 100 - 42 - 41 - 4
  });

  it("marks Reg as derived placeholder until Phase 1.5/2 backfill", async () => {
    const db = makeStubDb({
      statePartyOrg: [
        { _id: "PA_dem", countryId: "US", stateId: "PA", partyId: "dem", organization: 42 },
      ],
      politicalParties: [
        {
          _id: "dem-oid",
          sequentialId: "dem",
          countryId: "US",
          abbreviation: "DEM",
          color: "#2563eb",
        },
      ],
      states: [{ _id: "PA", countryId: "US", name: "Pennsylvania", gdp: 1_000 }],
      electedOfficials: [],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.kpis.regSource).toBe("derived");
    expect(result.kpis.topPartyRegPct).toBe(0);
  });

  it("treats Reg as derived when only a non-top party has the field set", async () => {
    const db = makeStubDb({
      statePartyOrg: [
        // Top party (DEM) has no registration value → headline is placeholder.
        { _id: "PA_dem", countryId: "US", stateId: "PA", partyId: "dem", organization: 42 },
        // Tiny third party has a real registration value, but it doesn't drive the headline.
        {
          _id: "PA_wfp",
          countryId: "US",
          stateId: "PA",
          partyId: "wfp",
          organization: 4,
          registration: 5,
        },
      ],
      politicalParties: [
        {
          _id: "dem-oid",
          sequentialId: "dem",
          countryId: "US",
          abbreviation: "DEM",
          color: "#2563eb",
        },
        {
          _id: "wfp-oid",
          sequentialId: "wfp",
          countryId: "US",
          abbreviation: "WFP",
          color: "#7c3aed",
        },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.kpis.topPartyId).toBe("dem");
    expect(result.kpis.regSource).toBe("derived");
    expect(result.kpis.topPartyRegPct).toBe(0);
  });

  it("breaks Org ties deterministically by partyId", async () => {
    const db = makeStubDb({
      statePartyOrg: [
        { _id: "PA_gop", countryId: "US", stateId: "PA", partyId: "gop", organization: 30 },
        { _id: "PA_dem", countryId: "US", stateId: "PA", partyId: "dem", organization: 30 },
      ],
      politicalParties: [
        {
          _id: "dem-oid",
          sequentialId: "dem",
          countryId: "US",
          abbreviation: "DEM",
          color: "#2563eb",
        },
        {
          _id: "gop-oid",
          sequentialId: "gop",
          countryId: "US",
          abbreviation: "GOP",
          color: "#dc2626",
        },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    // Tied Org → alphabetically lowest partyId wins (dem before gop).
    expect(result.partyOrg[0].id).toBe("dem");
    expect(result.partyOrg[1].id).toBe("gop");
    expect(result.kpis.topPartyId).toBe("dem");
  });

  it("uses real Reg field when present on the top party row", async () => {
    const db = makeStubDb({
      statePartyOrg: [
        {
          _id: "PA_dem",
          countryId: "US",
          stateId: "PA",
          partyId: "dem",
          organization: 42,
          registration: 49,
        },
      ],
      politicalParties: [
        {
          _id: "dem-oid",
          sequentialId: "dem",
          countryId: "US",
          abbreviation: "DEM",
          color: "#2563eb",
        },
      ],
      states: [{ _id: "PA", countryId: "US", name: "Pennsylvania", gdp: 1_000 }],
      electedOfficials: [],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.kpis.regSource).toBe("field");
    expect(result.kpis.topPartyRegPct).toBe(49);
  });

  it("populates GDP from State.gdp", async () => {
    const db = makeStubDb({
      statePartyOrg: [
        { _id: "TX_gop", countryId: "US", stateId: "TX", partyId: "gop", organization: 36 },
      ],
      politicalParties: [
        {
          _id: "gop-oid",
          sequentialId: "gop",
          countryId: "US",
          abbreviation: "GOP",
          color: "#dc2626",
        },
      ],
      states: [{ _id: "TX", countryId: "US", name: "Texas", gdp: 2_400_000_000_000 }],
      electedOfficials: [],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "TX" });
    expect(result.economy.gdp).toBe(2_400_000_000_000);
    expect(result.kpis.gdp).toBe(2_400_000_000_000);
  });

  it("defaults gdp to 0 when state row is missing (data integrity edge)", async () => {
    const db = makeStubDb({
      statePartyOrg: [],
      politicalParties: [],
      states: [],
      electedOfficials: [],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "ZZ" });
    expect(result.economy.gdp).toBe(0);
    expect(result.kpis.gdp).toBe(0);
    expect(result.partyOrg).toEqual([]);
    expect(result.unaffiliatedPct).toBe(100);
    expect(result.kpis.topPartyId).toBe("");
    expect(result.kpis.topPartyOrgPct).toBe(0);
  });

  it("returns governor as regional executive for US states with one seated", async () => {
    const govId = new ObjectId();
    const db = makeStubDb({
      statePartyOrg: [
        { _id: "PA_dem", countryId: "US", stateId: "PA", partyId: "dem", organization: 42 },
      ],
      politicalParties: [
        {
          _id: "dem-oid",
          sequentialId: "dem",
          countryId: "US",
          abbreviation: "DEM",
          color: "#2563eb",
        },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [
        {
          _id: govId,
          countryId: "US",
          state: "PA",
          officeType: "governor",
          party: "dem",
          characterId: null,
        },
      ],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.regionalExecutive).toEqual({
      partyId: "dem",
      sign: 1,
      label: "Governor",
    });
  });

  it("returns null regional executive for UK regions (no comparable office)", async () => {
    const db = makeStubDb({
      statePartyOrg: [
        { _id: "SCO_lab", countryId: "UK", stateId: "SCO", partyId: "lab", organization: 16 },
      ],
      politicalParties: [
        {
          _id: "lab-oid",
          sequentialId: "lab",
          countryId: "UK",
          abbreviation: "LAB",
          color: "#dc2626",
        },
      ],
      states: [{ _id: "SCO", countryId: "UK", gdp: 200_000_000_000 }],
      electedOfficials: [],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "UK", stateId: "SCO" });
    expect(result.regionalExecutive).toBeNull();
  });

  it("clamps unaffiliatedPct to 0 if Org sum exceeds 100 (data integrity)", async () => {
    const db = makeStubDb({
      statePartyOrg: [
        { _id: "PA_dem", countryId: "US", stateId: "PA", partyId: "dem", organization: 60 },
        { _id: "PA_gop", countryId: "US", stateId: "PA", partyId: "gop", organization: 50 },
      ],
      politicalParties: [
        {
          _id: "dem-oid",
          sequentialId: "dem",
          countryId: "US",
          abbreviation: "DEM",
          color: "#2563eb",
        },
        {
          _id: "gop-oid",
          sequentialId: "gop",
          countryId: "US",
          abbreviation: "GOP",
          color: "#dc2626",
        },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.unaffiliatedPct).toBe(0);
  });

  it("falls back to partyId when politicalParties row is missing", async () => {
    const db = makeStubDb({
      statePartyOrg: [
        { _id: "PA_dem", countryId: "US", stateId: "PA", partyId: "dem", organization: 42 },
      ],
      politicalParties: [], // missing — data integrity edge
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.partyOrg[0]).toMatchObject({
      id: "dem",
      abbr: "DEM", // upper-cased fallback from partyId
    });
    // Color falls back to a neutral default (so UI never crashes).
    expect(result.partyOrg[0].color).toMatch(/^#/);
  });

  it("stubs hot races / primary contest / extended economy for Phase 1 (Phase 4+/5+ wires real)", async () => {
    const db = makeStubDb({
      statePartyOrg: [
        { _id: "PA_dem", countryId: "US", stateId: "PA", partyId: "dem", organization: 42 },
      ],
      politicalParties: [
        {
          _id: "dem-oid",
          sequentialId: "dem",
          countryId: "US",
          abbreviation: "DEM",
          color: "#2563eb",
        },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.hotRaces).toEqual([]);
    expect(result.kpis.competitiveRacesCount).toBe(0);
    expect(result.contestedPrimaries).toEqual([]);
    expect(result.economy.gdpDeltaPct).toBe(0);
    expect(result.economy.unemployment).toBe(0);
    expect(result.economy.topSectors).toEqual([]);
  });

  it("populates economy.unemployment from macroMetrics.economic.unemploymentRate.value", async () => {
    const db = makeStubDb({
      statePartyOrg: [],
      politicalParties: [],
      states: [{ _id: "AZ", countryId: "US", name: "Arizona", gdp: 407500 }],
      macroMetrics: [
        {
          _id: "AZ",
          countryId: "US",
          economic: {
            unemploymentRate: { value: 4.8 },
            medianIncome: { value: 62000 },
            gdpGrowth: { value: 2.0 },
            povertyRate: { value: 11.0 },
            costOfLiving: { value: 108 },
            smallBusinessFormation: { value: 1.0 },
          },
        },
      ],
      electedOfficials: [],
      elections: [],
    });
    const result = await getStateOverview(db as never, { countryId: "US", stateId: "AZ" });
    expect(result.economy.unemployment).toBeCloseTo(4.8);
  });

  it("populates economy.topSectors from State.sectorSpecializations (primary + secondary) when cache empty", async () => {
    const db = makeStubDb({
      statePartyOrg: [],
      politicalParties: [],
      states: [
        {
          _id: "AZ",
          countryId: "US",
          name: "Arizona",
          gdp: 407500,
          sectorSpecializations: { primary: "technology", secondary: "real_estate" },
        },
      ],
      electedOfficials: [],
      elections: [],
    });
    const result = await getStateOverview(db as never, { countryId: "US", stateId: "AZ" });
    expect(result.economy.topSectors).toEqual([
      { id: "technology", share: 0, specializationBonus: "primary" },
      { id: "real_estate", share: 0, specializationBonus: "secondary" },
    ]);
  });

  it("prefers topSectorsCache over sectorSpecializations when cache has sectors", async () => {
    const db = makeStubDb({
      statePartyOrg: [],
      politicalParties: [],
      states: [
        {
          _id: "AZ",
          countryId: "US",
          gdp: 407500,
          sectorSpecializations: { primary: "technology", secondary: "real_estate" },
          topSectorsCache: {
            sectors: [
              { sectorType: "technology", revenue: 5000, specializationBonus: "primary" },
              { sectorType: "finance", revenue: 3000, specializationBonus: null },
              { sectorType: "real_estate", revenue: 1500, specializationBonus: "secondary" },
            ],
            computedAtTurn: 42,
            computedAt: new Date(),
          },
        },
      ],
      electedOfficials: [],
      elections: [],
    });
    const result = await getStateOverview(db as never, { countryId: "US", stateId: "AZ" });
    expect(result.economy.topSectors).toEqual([
      { id: "technology", share: 0, specializationBonus: "primary" },
      { id: "finance", share: 0, specializationBonus: null },
      { id: "real_estate", share: 0, specializationBonus: "secondary" },
    ]);
  });

  it("deduplicates topSectors when primary === secondary (defensive)", async () => {
    const db = makeStubDb({
      statePartyOrg: [],
      politicalParties: [],
      states: [
        {
          _id: "AK",
          countryId: "US",
          gdp: 60000,
          sectorSpecializations: { primary: "energy", secondary: "energy" },
        },
      ],
      electedOfficials: [],
      elections: [],
    });
    const result = await getStateOverview(db as never, { countryId: "US", stateId: "AK" });
    expect(result.economy.topSectors.map((s) => s.id)).toEqual(["energy"]);
  });

  // ─── Contested Primaries + Race Watchlist ────────────────────────────────

  it("populates contestedPrimaries when a party fields 2+ candidates in a primary-phase race", async () => {
    const electionId = new ObjectId();
    const futurePrimaryEnd = new Date(Date.now() + 1000 * 60 * 60 * 24); // tomorrow
    const db = makeStubDb({
      statePartyOrg: [
        { _id: "PA_dem", countryId: "US", stateId: "PA", partyId: "dem", organization: 42 },
      ],
      politicalParties: [
        {
          _id: "dem-oid",
          sequentialId: "dem",
          countryId: "US",
          abbreviation: "DEM",
          color: "#2563eb",
        },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [
        {
          _id: electionId,
          countryId: "US",
          electionType: "senate",
          state: "PA",
          status: "active",
          primaryEndTime: futurePrimaryEnd,
          seatId: "US-senate-PA-1",
        },
      ],
      electionCandidates: [
        {
          _id: new ObjectId(),
          electionId,
          characterId: new ObjectId(),
          characterName: "A",
          party: "dem",
          status: "active",
        },
        {
          _id: new ObjectId(),
          electionId,
          characterId: new ObjectId(),
          characterName: "B",
          party: "dem",
          status: "active",
        },
        {
          _id: new ObjectId(),
          electionId,
          characterId: new ObjectId(),
          characterName: "C",
          party: "gop",
          status: "active",
        },
      ],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.contestedPrimaries).toHaveLength(1);
    expect(result.contestedPrimaries[0]).toMatchObject({
      partyId: "dem",
      candidateCount: 2,
      partyAbbr: "DEM",
    });
    // Primary-phase races aren't watchlist-eligible
    expect(result.hotRaces).toEqual([]);
  });

  it("does NOT include primaries with only one candidate per party", async () => {
    const electionId = new ObjectId();
    const futurePrimaryEnd = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const db = makeStubDb({
      statePartyOrg: [
        { _id: "PA_dem", countryId: "US", stateId: "PA", partyId: "dem", organization: 42 },
      ],
      politicalParties: [
        { _id: "dem-oid", sequentialId: "dem", countryId: "US", abbreviation: "DEM" },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [
        {
          _id: electionId,
          countryId: "US",
          electionType: "senate",
          state: "PA",
          status: "active",
          primaryEndTime: futurePrimaryEnd,
        },
      ],
      electionCandidates: [
        {
          _id: new ObjectId(),
          electionId,
          characterId: new ObjectId(),
          characterName: "A",
          party: "dem",
          status: "active",
        },
        {
          _id: new ObjectId(),
          electionId,
          characterId: new ObjectId(),
          characterName: "B",
          party: "gop",
          status: "active",
        },
      ],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.contestedPrimaries).toEqual([]);
  });

  it("populates hotRaces for general-phase races where top-2 vote share is within 15pp", async () => {
    const electionId = new ObjectId();
    const pastPrimaryEnd = new Date(Date.now() - 1000 * 60 * 60 * 24); // yesterday
    const candA = new ObjectId();
    const candB = new ObjectId();
    const db = makeStubDb({
      statePartyOrg: [],
      politicalParties: [
        { _id: "dem-oid", sequentialId: "dem", countryId: "US", abbreviation: "DEM" },
        { _id: "gop-oid", sequentialId: "gop", countryId: "US", abbreviation: "GOP" },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [
        {
          _id: electionId,
          countryId: "US",
          electionType: "senate",
          state: "PA",
          status: "active",
          primaryEndTime: pastPrimaryEnd,
          senateClass: 2,
        },
      ],
      electionCandidates: [
        {
          _id: candA,
          electionId,
          characterId: new ObjectId(),
          characterName: "A",
          party: "dem",
          status: "active",
        },
        {
          _id: candB,
          electionId,
          characterId: new ObjectId(),
          characterName: "B",
          party: "gop",
          status: "active",
        },
      ],
      electionVoteTallies: [
        {
          _id: new ObjectId(),
          electionId,
          state: "PA",
          // 52% vs 48% = 4pp margin, within 15pp threshold.
          totalVotes: { [candA.toString()]: 5200, [candB.toString()]: 4800 },
        },
      ],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.hotRaces).toHaveLength(1);
    expect(result.hotRaces[0].electionType).toBe("senate");
    expect(result.hotRaces[0].senateClass).toBe(2);
    expect(result.hotRaces[0].topTwoMargin).toBeCloseTo(4, 0);
    expect(result.kpis.competitiveRacesCount).toBe(1);
  });

  it("includes a race in the 10–15pp band (above the old 10pp cutoff, within the 15pp threshold)", async () => {
    const electionId = new ObjectId();
    const pastPrimaryEnd = new Date(Date.now() - 1000 * 60 * 60 * 24); // yesterday
    const candA = new ObjectId();
    const candB = new ObjectId();
    const db = makeStubDb({
      statePartyOrg: [],
      politicalParties: [
        { _id: "dem-oid", sequentialId: "dem", countryId: "US", abbreviation: "DEM" },
        { _id: "gop-oid", sequentialId: "gop", countryId: "US", abbreviation: "GOP" },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [
        {
          _id: electionId,
          countryId: "US",
          electionType: "governor",
          state: "PA",
          status: "active",
          primaryEndTime: pastPrimaryEnd,
        },
      ],
      electionCandidates: [
        {
          _id: candA,
          electionId,
          characterId: new ObjectId(),
          characterName: "A",
          party: "dem",
          status: "active",
        },
        {
          _id: candB,
          electionId,
          characterId: new ObjectId(),
          characterName: "B",
          party: "gop",
          status: "active",
        },
      ],
      electionVoteTallies: [
        {
          _id: new ObjectId(),
          electionId,
          state: "PA",
          // 56% vs 44% = 12pp margin: excluded under the old 10pp cap,
          // included under the 15pp threshold.
          totalVotes: { [candA.toString()]: 5600, [candB.toString()]: 4400 },
        },
      ],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.hotRaces).toHaveLength(1);
    expect(result.hotRaces[0].topTwoMargin).toBeCloseTo(12, 0);
  });

  it("excludes general races where top-2 vote share margin exceeds 15pp", async () => {
    const electionId = new ObjectId();
    const pastPrimaryEnd = new Date(Date.now() - 1000 * 60 * 60 * 24);
    const candA = new ObjectId();
    const candB = new ObjectId();
    const db = makeStubDb({
      statePartyOrg: [],
      politicalParties: [
        { _id: "dem-oid", sequentialId: "dem", countryId: "US", abbreviation: "DEM" },
        { _id: "gop-oid", sequentialId: "gop", countryId: "US", abbreviation: "GOP" },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [
        {
          _id: electionId,
          countryId: "US",
          electionType: "governor",
          state: "PA",
          status: "active",
          primaryEndTime: pastPrimaryEnd,
        },
      ],
      electionCandidates: [
        {
          _id: candA,
          electionId,
          characterId: new ObjectId(),
          characterName: "A",
          party: "dem",
          status: "active",
        },
        {
          _id: candB,
          electionId,
          characterId: new ObjectId(),
          characterName: "B",
          party: "gop",
          status: "active",
        },
      ],
      electionVoteTallies: [
        {
          _id: new ObjectId(),
          electionId,
          state: "PA",
          // 70% vs 30% = 40pp margin, far above 15pp threshold.
          totalVotes: { [candA.toString()]: 7000, [candB.toString()]: 3000 },
        },
      ],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.hotRaces).toEqual([]);
  });

  it("excludes races still in their primary (future primaryEndTime) from hotRaces", async () => {
    const electionId = new ObjectId();
    const futurePrimaryEnd = new Date(Date.now() + 1000 * 60 * 60 * 24); // tomorrow
    const candA = new ObjectId();
    const candB = new ObjectId();
    const db = makeStubDb({
      statePartyOrg: [],
      politicalParties: [
        { _id: "dem-oid", sequentialId: "dem", countryId: "US", abbreviation: "DEM" },
        { _id: "gop-oid", sequentialId: "gop", countryId: "US", abbreviation: "GOP" },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [
        {
          _id: electionId,
          countryId: "US",
          electionType: "house",
          state: "PA",
          status: "active",
          primaryEndTime: futurePrimaryEnd,
        },
      ],
      electionCandidates: [
        {
          _id: candA,
          electionId,
          characterId: new ObjectId(),
          characterName: "A",
          party: "dem",
          status: "active",
        },
        {
          _id: candB,
          electionId,
          characterId: new ObjectId(),
          characterName: "B",
          party: "gop",
          status: "active",
        },
      ],
      electionVoteTallies: [
        {
          _id: new ObjectId(),
          electionId,
          state: "PA",
          totalVotes: { [candA.toString()]: 5000, [candB.toString()]: 5000 },
        },
      ],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    // Race is still in primary phase — must NOT appear on the watchlist
    // even though the (eventual) general-phase tally is tied.
    expect(result.hotRaces).toEqual([]);
  });

  it("excludes races with no primary end time (pre-primary / unknown phase)", async () => {
    const electionId = new ObjectId();
    const candA = new ObjectId();
    const candB = new ObjectId();
    const db = makeStubDb({
      statePartyOrg: [],
      politicalParties: [
        { _id: "dem-oid", sequentialId: "dem", countryId: "US", abbreviation: "DEM" },
        { _id: "gop-oid", sequentialId: "gop", countryId: "US", abbreviation: "GOP" },
      ],
      states: [{ _id: "PA", countryId: "US", gdp: 1_000 }],
      electedOfficials: [],
      elections: [
        {
          _id: electionId,
          countryId: "US",
          electionType: "house",
          state: "PA",
          status: "active",
          // primaryEndTime intentionally missing
        },
      ],
      electionCandidates: [
        {
          _id: candA,
          electionId,
          characterId: new ObjectId(),
          characterName: "A",
          party: "dem",
          status: "active",
        },
        {
          _id: candB,
          electionId,
          characterId: new ObjectId(),
          characterName: "B",
          party: "gop",
          status: "active",
        },
      ],
      electionVoteTallies: [],
    });

    const result = await getStateOverview(db as never, { countryId: "US", stateId: "PA" });
    expect(result.hotRaces).toEqual([]);
  });
});
