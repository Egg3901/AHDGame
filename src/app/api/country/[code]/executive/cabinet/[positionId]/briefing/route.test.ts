import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn() }));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: vi.fn(async () => null),
}));

const { getDb } = await import("@/lib/mongodb");
const { getAuthUserWithCharacter } = await import("@/lib/auth");
const { getHeadOfGovernmentCharacterId } = await import("@/lib/api/headOfGovernment");

describe("GET /api/country/[code]/executive/cabinet/[positionId]/briefing", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    // These cases are about how the briefing SOURCES its numbers, not about who
    // may read them. Sign in as an admin so the visibility gate is satisfied and
    // each test keeps its own subject.
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue({ isAdmin: true } as never);
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

describe("GET briefing — cabinet office visibility", () => {
  let db: MockDb;
  const HOLDER = new ObjectId();
  const HEAD_OF_GOVERNMENT = new ObjectId();
  const OUTSIDER = new ObjectId();

  /** Seat the defence office, or leave it vacant when passed null. */
  function seedSeat(holderCharacterId: ObjectId | null) {
    db.collection("cabinetMembers");
    db.collection("cabinetSettings");
    db.collection("states");
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue(null);
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(
      holderCharacterId
        ? {
            countryId: "US",
            positionId: "secretary_of_defense",
            characterId: holderCharacterId,
            characterName: "Jordan Ashton",
            ministerialActions: 2,
          }
        : null
    );
    db.collectionMocks.states.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never);
  }

  function signInAs(characterId: ObjectId | null, opts?: { isAdmin?: boolean }) {
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue(
      characterId
        ? ({
            isAdmin: opts?.isAdmin ?? false,
            hasCharacter: true,
            character: { _id: characterId },
          } as never)
        : null
    );
  }

  async function getDefenceBriefing() {
    const { GET } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/briefing/route");
    return GET(
      new Request(
        "http://localhost/api/country/us/executive/cabinet/secretary_of_defense/briefing"
      ),
      { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) }
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(HEAD_OF_GOVERNMENT);
    seedSeat(HOLDER);
  });

  it("withholds the force summary from a player who does not hold the seat", async () => {
    signInAs(OUTSIDER);

    const json = (await (await getDefenceBriefing()).json()) as Record<string, unknown>;

    expect(json.canView).toBe(false);
    expect(json).not.toHaveProperty("forceSummary");
    expect(json).not.toHaveProperty("units");
    expect(json).not.toHaveProperty("nationalMetrics");
    expect(json).not.toHaveProperty("regionData");
    expect(json).not.toHaveProperty("orders");
  });

  it("withholds the office from a signed-out visitor", async () => {
    signInAs(null);

    const json = (await (await getDefenceBriefing()).json()) as Record<string, unknown>;

    expect(json.canView).toBe(false);
    expect(json).not.toHaveProperty("forceSummary");
  });

  it("keeps the letterhead readable on a withheld office", async () => {
    signInAs(OUTSIDER);

    const json = (await (await getDefenceBriefing()).json()) as {
      position: { id: string; department: string };
      member: { characterName: string } | null;
    };

    expect(json.position.id).toBe("secretary_of_defense");
    expect(json.position.department).toBeTruthy();
    expect(json.member?.characterName).toBe("Jordan Ashton");
  });

  it("does not leak how many actions the minister has left", async () => {
    signInAs(OUTSIDER);

    const json = (await (await getDefenceBriefing()).json()) as {
      member: Record<string, unknown> | null;
    };

    expect(json.member).not.toHaveProperty("ministerialActions");
  });

  it("names the offices that may view a withheld seat", async () => {
    signInAs(OUTSIDER);

    const json = (await (await getDefenceBriefing()).json()) as {
      restriction: { allowedTitles: string[]; countryName: string };
    };

    // The realm phrase, not the bare name: the notice reads "the President of
    // the United States", and `name` alone would drop the article.
    expect(json.restriction.allowedTitles).toEqual(["President"]);
    expect(json.restriction.countryName).toBe("the United States");
  });

  it("serves the full briefing to the seated officeholder", async () => {
    signInAs(HOLDER);

    const json = (await (await getDefenceBriefing()).json()) as Record<string, unknown>;

    expect(json.canView).toBe(true);
    expect(json.canAct).toBe(true);
    expect(json).toHaveProperty("forceSummary");
    expect(json).toHaveProperty("nationalMetrics");
  });

  it("serves the office to the head of government without granting the levers", async () => {
    signInAs(HEAD_OF_GOVERNMENT);

    const json = (await (await getDefenceBriefing()).json()) as Record<string, unknown>;

    expect(json.canView).toBe(true);
    expect(json.canAct).toBe(false);
    expect(json).toHaveProperty("forceSummary");
  });

  it("keeps a vacant seat readable to the head of government", async () => {
    seedSeat(null);
    signInAs(HEAD_OF_GOVERNMENT);

    const json = (await (await getDefenceBriefing()).json()) as Record<string, unknown>;

    expect(json.canView).toBe(true);
    expect(json.member).toBeNull();
  });

  it("withholds a vacant seat from everybody else", async () => {
    seedSeat(null);
    signInAs(OUTSIDER);

    const json = (await (await getDefenceBriefing()).json()) as Record<string, unknown>;

    expect(json.canView).toBe(false);
    expect(json).not.toHaveProperty("forceSummary");
  });

  // The route hands the resolver a viewerUserId, which a crowned head of state is
  // recognised by. The field is optional, so dropping the wire would typecheck
  // cleanly and silently shut every monarch out of their own government.
  it("serves a monarchy's office to the reigning monarch", async () => {
    const monarchUserId = new ObjectId().toString();
    db.collection("cabinetMembers");
    db.collection("cabinetSettings");
    db.collection("states");
    db.collection("imperialCharacters");
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue(null);
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      countryId: "UK",
      positionId: "defence_secretary",
      characterId: HOLDER,
      characterName: "Jordan Ashton",
    });
    db.collectionMocks.states.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never);
    db.collectionMocks.imperialCharacters.findOne.mockResolvedValue({ _id: new ObjectId() });
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
      userId: monarchUserId,
      isAdmin: false,
      hasCharacter: false,
    } as never);

    const { GET } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/briefing/route");
    const response = await GET(
      new Request("http://localhost/api/country/uk/executive/cabinet/defence_secretary/briefing"),
      { params: Promise.resolve({ code: "uk", positionId: "defence_secretary" }) }
    );
    const json = (await response.json()) as Record<string, unknown>;

    expect(json.canView).toBe(true);
    expect(json.canAct).toBe(false);
  });
});
