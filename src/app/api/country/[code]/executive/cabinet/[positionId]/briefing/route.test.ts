import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { getAuthUserWithCharacter } = await import("@/lib/auth");

describe("GET /api/country/[code]/executive/cabinet/[positionId]/briefing", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue(null);
  });

  it("prefers the national metrics document over regional averaging for national metrics", async () => {
    // The metrics this asserts on (`governance.publicTrust`,
    // `social.civicParticipation`) are POLITICAL, so they reach the briefing as
    // the board's legacy projection rather than as stored legacy values. The
    // subject is unchanged — national doc wins over averaging the regions — but
    // the fixture has to seed boards to exercise it, and the expected numbers
    // come from the projection rather than being written by hand.
    db.collection("states");
    db.collection("macroMetrics");
    db.collection("politicalMetrics");
    db.collection("cabinetMembers");
    db.collection("cabinetSettings");
    db.collection("ministerialOrders");

    db.collectionMocks.states.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { _id: "CA", name: "California", population: 100 },
          { _id: "TX", name: "Texas", population: 90 },
        ]),
      }),
    } as never);

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue(null);

    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "CA" }, { _id: "TX" }]),
    } as never);
    db.collectionMocks.macroMetrics.findOne.mockResolvedValue({ _id: "federal" });

    // Regions sit far below the national doc, so averaging them cannot
    // coincidentally produce the national answer.
    const REGIONAL = { "governance.integrity": 20, "society.civicLife": 20 };
    const NATIONAL = { "governance.integrity": 80, "society.civicLife": 80 };
    db.collectionMocks.politicalMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", values: REGIONAL },
        { _id: "TX", values: REGIONAL },
      ]),
    } as never);
    db.collectionMocks.politicalMetrics.findOne.mockResolvedValue({
      _id: "federal",
      values: NATIONAL,
    });

    const { legacyPoliticalHalfFromBoard } =
      await import("@/lib/politicalLegislation/legacyProjection");
    const nationalProjection = legacyPoliticalHalfFromBoard(NATIONAL as never)!;
    const regionalProjection = legacyPoliticalHalfFromBoard(REGIONAL as never)!;

    const { GET } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/briefing/route");

    const response = await GET(
      new Request("http://localhost/api/country/us/executive/cabinet/secretary_of_state/briefing"),
      { params: Promise.resolve({ code: "us", positionId: "secretary_of_state" }) }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as { nationalMetrics: Record<string, number> };
    for (const [category, metricId] of [
      ["governance", "publicTrust"],
      ["social", "civicParticipation"],
    ] as const) {
      const fromNational = (
        nationalProjection[category] as Record<string, { value: number }> | undefined
      )?.[metricId]?.value;
      const fromRegions = (
        regionalProjection[category] as Record<string, { value: number }> | undefined
      )?.[metricId]?.value;
      expect(fromNational).toBeTypeOf("number");
      expect(fromNational).not.toBe(fromRegions);
      expect(json.nationalMetrics[`${category}.${metricId}`]).toBeCloseTo(fromNational!, 6);
    }
  });

  it("sources the PBoC governor's inflation from the budget and interest from the central bank", async () => {
    db.collection("states");
    db.collection("macroMetrics");
    db.collection("cabinetMembers");
    db.collection("cabinetSettings");
    db.collection("ministerialOrders");
    db.collection("federalBudget");
    db.collection("centralBanks");

    db.collectionMocks.states.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never);
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue(null);

    // Regional macroMetrics (empty) and the national-scope doc. The national doc
    // carries a STALE economic.inflationRate (0.043) that must be ignored, plus
    // the maintained gdpGrowth / unemploymentRate.
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.macroMetrics.findOne.mockResolvedValue({
      _id: "cn_national",
      economic: {
        inflationRate: { value: 0.043 },
        gdpGrowth: { value: 1.948 },
        unemploymentRate: { value: 9.288 },
      },
    });

    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "CN",
      economicFactors: { inflationRate: 2.82 },
    });
    db.collectionMocks.centralBanks.findOne.mockResolvedValue({ _id: "CN", primeRate: 2 });

    const { GET } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/briefing/route");

    const response = await GET(
      new Request("http://localhost/api/country/cn/executive/cabinet/pboc_governor/briefing"),
      { params: Promise.resolve({ code: "cn", positionId: "pboc_governor" }) }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as { nationalMetrics: Record<string, number> };
    // Canonical sources, not the stale metrics value.
    expect(json.nationalMetrics["economic.inflationRate"]).toBe(2.82);
    expect(json.nationalMetrics["economic.interestRate"]).toBe(2);
    // macroMetrics-sourced metrics still flow through unchanged.
    expect(json.nationalMetrics["economic.gdpGrowth"]).toBe(1.948);
    expect(json.nationalMetrics["economic.unemploymentRate"]).toBe(9.288);
  });

  it("excludes stale orphan regionalBudgets (non-state ids) from the CN finance minister funding pool", async () => {
    db.collection("states");
    db.collection("macroMetrics");
    db.collection("cabinetMembers");
    db.collection("cabinetSettings");
    db.collection("regionalBudgets");

    db.collectionMocks.states.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { _id: "HB", name: "Huabei", population: 100 },
          { _id: "DB", name: "Dongbei", population: 90 },
        ]),
      }),
    } as never);

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue(null);

    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "HB" }, { _id: "DB" }]),
    } as never);

    // Live CN has 2 current regional budgets (HB/DB) plus a stale orphan
    // (NORTHEAST) left over from the pre-rename region-id scheme. The orphan
    // still carries countryId: "CN", so a { countryId } query would wrongly
    // pull it into the Finance Minister's funding pool — the bug this fixes.
    const current = [
      { _id: "HB", countryId: "CN", centralTransferGrant: 10 },
      { _id: "DB", countryId: "CN", centralTransferGrant: 10 },
    ];
    const orphan = { _id: "NORTHEAST", countryId: "CN", centralTransferGrant: 700 };
    db.collectionMocks.regionalBudgets.find.mockImplementation(
      (query: { _id?: { $in?: string[] }; countryId?: string }) => {
        const ids = query?._id?.$in;
        const docs = ids
          ? [...current, orphan].filter((d) => ids.includes(d._id))
          : [...current, orphan];
        return { toArray: vi.fn().mockResolvedValue(docs) } as never;
      }
    );

    const { GET } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/briefing/route");

    const response = await GET(
      new Request("http://localhost/api/country/cn/executive/cabinet/minister_of_finance/briefing"),
      { params: Promise.resolve({ code: "cn", positionId: "minister_of_finance" }) }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      regionalBudgets: Array<{ regionId: string; fundingPoolAmount: number }>;
    };
    const ids = json.regionalBudgets.map((r) => r.regionId);
    expect(ids).toEqual(expect.arrayContaining(["HB", "DB"]));
    expect(ids).not.toContain("NORTHEAST");
    // Pool must reflect only the 2 current regions (10 + 10), not + 700 orphan.
    const pool = json.regionalBudgets.reduce((sum, r) => sum + r.fundingPoolAmount, 0);
    expect(pool).toBe(20);
  });

  it("attaches the military order-of-battle + force summary for the defense seat", async () => {
    db.collection("cabinetMembers");
    db.collection("cabinetSettings");
    db.collection("militaryUnits");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue(null);
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "u1",
          countryId: "US",
          branchId: "army",
          domain: "ground",
          name: "1st Vanguard Infantry Division",
          type: "Infantry Division",
          icon: "soldier",
          posture: "standard",
          techTier: 1,
          personnel: 12000,
          readiness: 70,
          basePower: 48,
          upkeepBase: 70,
          vet: 1,
          xp: 0,
          equipment: { firepower: 1, protection: 1, support: 1 },
          drill: null,
          theaterId: "reserve",
          assignedGeneralId: null,
          createdTurn: 1,
        },
      ]),
    } as never);

    const { GET } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/briefing/route");
    const response = await GET(
      new Request(
        "http://localhost/api/country/us/executive/cabinet/secretary_of_defense/briefing"
      ),
      { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) }
    );
    const json = (await response.json()) as {
      units: Array<{ _id: string; effectivePower: number; effectiveUpkeep: number }>;
      forceSummary: {
        unitCount: number;
        totalPower: number;
        treasuryBalance: number;
        gdp: number | null;
      };
    };
    expect(json.units).toHaveLength(1);
    expect(json.units[0].effectivePower).toBeGreaterThan(0);
    expect(json.units[0].effectiveUpkeep).toBeGreaterThan(0);
    expect(json.forceSummary.unitCount).toBe(1);
    expect(json.forceSummary.totalPower).toBeGreaterThan(0);
    // The route builds forceSummary as Record<string, unknown>, so tsc checks
    // only the CLIENT half of this DTO — a typo here would ship silently. These
    // two are the fields procurement prices against, so assert them at runtime.
    expect(json.forceSummary).toHaveProperty("treasuryBalance");
    expect(json.forceSummary).toHaveProperty("gdp");
    expect(typeof json.forceSummary.treasuryBalance).toBe("number");
    // Same reasoning for the defence account: the panel prices and gates against these,
    // and a dropped field would render as `undefined` with a green typecheck.
    for (const field of [
      "appropriation",
      "appropriationAccrual",
      "appropriationUpkeep",
      "arrearsRatio",
    ]) {
      expect(json.forceSummary).toHaveProperty(field);
      expect(typeof (json.forceSummary as Record<string, unknown>)[field]).toBe("number");
    }
    expect(json.forceSummary).toHaveProperty("militaryPriceBaselineGdp");
  });

  // The arsenal and contract blocks are assembled outside `forceSummary`'s typed view, so
  // the same reasoning applies: a dropped field type-checks and renders as `undefined`.
  it("emits the arsenal, contract and supplier blocks on the defence seat", async () => {
    db.collection("cabinetMembers");
    db.collection("cabinetSettings");
    db.collection("militaryUnits");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue(null);
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { GET } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/briefing/route");
    const response = await GET(
      new Request(
        "http://localhost/api/country/us/executive/cabinet/secretary_of_defense/briefing"
      ),
      { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) }
    );
    const json = (await response.json()) as {
      arsenal?: { stock: Record<string, number>; grade: Record<string, number> };
      contracts?: unknown[];
      suppliers?: unknown[];
      lotPricePerLot?: number | null;
    };
    // An absent arsenal document is a legitimate starting state — every nation begins empty —
    // so the block must still be present, with every domain zeroed rather than missing.
    expect(json.arsenal).toBeDefined();
    for (const domain of ["ground", "naval", "air", "rocket", "space", "marine"]) {
      expect(json.arsenal!.stock).toHaveProperty(domain);
      expect(json.arsenal!.grade).toHaveProperty(domain);
    }
    expect(Array.isArray(json.contracts)).toBe(true);
    // The award form is built from these two. Dropping either leaves a minister with a
    // contract list they can cancel from but never add to — which is how C2 originally
    // shipped, and is not something type-checking can see.
    expect(Array.isArray(json.suppliers)).toBe(true);
    expect(json).toHaveProperty("lotPricePerLot");
  });

  it("carries a missing gdp through as null rather than a free-unit zero", async () => {
    db.collection("cabinetMembers");
    db.collection("cabinetSettings");
    db.collection("militaryUnits");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue(null);
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    // No federalBudget document at all — the budget-less country case.
    db.collection("federalBudget");
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(null);

    const { GET } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/briefing/route");
    const response = await GET(
      new Request(
        "http://localhost/api/country/us/executive/cabinet/secretary_of_defense/briefing"
      ),
      { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) }
    );
    const json = (await response.json()) as {
      forceSummary: {
        treasuryBalance: number;
        gdp: number | null;
        militaryPriceBaselineGdp: number | null;
        appropriation: number;
        appropriationUpkeep: number;
      };
    };
    // `?? null`, never `?? 0` — a zero gdp is what would price units free.
    expect(json.forceSummary.gdp).toBeNull();
    expect(json.forceSummary.treasuryBalance).toBe(0);
    // A 0 baseline would anchor prices at zero, which is the same free-unit bug in a
    // different field; absent must mean "price off live GDP".
    expect(json.forceSummary.militaryPriceBaselineGdp).toBeNull();
    // No budget document ⇒ no appropriation and nothing charged, never a guess.
    expect(json.forceSummary.appropriation).toBe(0);
    expect(json.forceSummary.appropriationUpkeep).toBe(0);
  });
});
