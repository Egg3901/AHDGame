import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { applyLegislationEffect } from "./legislationEffects";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// The legislative nationalize handler has its own tests; mock it here so this
// suite asserts only the enactment dispatch, not the full transition.
vi.mock("@/lib/nationalization/legislativeNationalize", () => ({
  applyNationalizeProvision: vi.fn().mockResolvedValue(undefined),
}));
// The snapshot detail helper + current-turn lookup are exercised by their own
// suites; mock them here so this suite asserts only the enactment snapshot write.
vi.mock("@/lib/nationalization/billTargetPreview", () => ({
  computeNationalizationProvisionDetail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn().mockResolvedValue(42),
}));
const allianceBarSpy = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/military/allianceBar", () => ({
  allianceBarBetween: (...a: unknown[]) => allianceBarSpy(...a),
}));

const declareWarSpy = vi.fn().mockResolvedValue({ conflict: {}, joined: false });
vi.mock("@/lib/military/declareWar", () => ({
  declareWar: (...a: unknown[]) => declareWarSpy(...a),
}));

describe("applyLegislationEffect", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("writes enacted tariff provisions into the tariffs collection", async () => {
    const billId = new ObjectId();

    await applyLegislationEffect(db as unknown as Db, {
      _id: billId,
      countryId: "UK",
      stateId: "uk_national",
      provisions: [
        {
          type: "tariff",
          scopeType: "origin_country",
          targetOriginCountryId: "US",
          rate: 15,
        },
      ],
    });

    expect(db.collectionMocks["tariffs"]?.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = db.collectionMocks["tariffs"]!.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> },
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({
      countryId: "UK",
      scopeType: "origin_country",
      targetOriginCountryId: "US",
    });
    expect(update.$set.rate).toBe(15);
    expect(update.$set.sourceBillId).toStrictEqual(billId);
    expect(options.upsert).toBe(true);
  });

  it("writes state-scoped subsidy provisions for regional bills", async () => {
    const billId = new ObjectId();

    await applyLegislationEffect(db as unknown as Db, {
      _id: billId,
      countryId: "CN",
      stateId: "XB",
      provisions: [
        {
          type: "subsidy",
          scopeType: "economy_wide",
          domesticOnly: false,
        },
      ],
    });

    const [filter] = db.collectionMocks["subsidies"]!.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
      unknown,
    ];
    expect(filter).toMatchObject({
      countryId: "CN",
      scope: "state",
      stateId: "XB",
      scopeType: "economy_wide",
    });
  });

  it("writes enacted subsidy provisions into the subsidies collection", async () => {
    const billId = new ObjectId();

    await applyLegislationEffect(db as unknown as Db, {
      _id: billId,
      countryId: "UK",
      stateId: "uk_national",
      provisions: [
        {
          type: "subsidy",
          scopeType: "sector",
          targetSectorType: "financial",
          domesticOnly: true,
        },
      ],
    });

    expect(db.collectionMocks["subsidies"]?.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = db.collectionMocks["subsidies"]!.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> },
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({
      countryId: "UK",
      scope: "national",
      stateId: "uk_national",
      scopeType: "sector",
      targetSectorType: "financial",
    });
    expect(update.$set).toMatchObject({
      domesticOnly: true,
      active: true,
      sourceBillId: billId,
    });
    expect(options.upsert).toBe(true);
  });

  it("fires sentiment pulses for sector tariffs on real enactment (rateChanged path)", async () => {
    // First-time enactment: no existing tariff doc, so applyTariffProvision
    // returns rateChanged=true and applyLegislationEffect must fire the
    // associated sector-tariff sentiment pulses (domestic boost + foreign penalty).
    db.collection("sentimentPulses");

    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: "UK",
      stateId: "uk_national",
      provisions: [
        {
          type: "tariff",
          scopeType: "sector",
          targetSectorType: "energy",
          rate: 30,
        },
      ],
    });

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock.insertOne).toHaveBeenCalledTimes(2);
  });

  it("does NOT fire sentiment pulses when enacting an unchanged sector tariff (rateChanged=false)", async () => {
    // Defensive: if applyLegislationEffect is invoked for a bill that doesn't
    // actually change the tariff rate (e.g., re-running the enactment hook on
    // an already-applied bill), pulses must not fire — that's the source of
    // the original NYSE-pegging incident, just one layer up.
    db.collection("sentimentPulses");
    db.collection("tariffs");
    db.collectionMocks["tariffs"]!.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      countryId: "UK",
      scopeType: "sector",
      targetSectorType: "energy",
      rate: 30, // already at the provision rate
      sourceBillId: new ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: "UK",
      stateId: "uk_national",
      provisions: [
        {
          type: "tariff",
          scopeType: "sector",
          targetSectorType: "energy",
          rate: 30,
        },
      ],
    });

    expect(db.collectionMocks["sentimentPulses"]?.insertOne).not.toHaveBeenCalled();
  });

  it("dispatches a nationalize provision to the legislative handler", async () => {
    const { applyNationalizeProvision } =
      await import("@/lib/nationalization/legislativeNationalize");
    const corporationId = new ObjectId();

    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: "US",
      stateId: "federal",
      provisions: [{ type: "nationalize", targetCorporationId: corporationId }],
    });

    expect(vi.mocked(applyNationalizeProvision)).toHaveBeenCalledWith(
      db,
      "US",
      expect.objectContaining({ type: "nationalize", targetCorporationId: corporationId })
    );
  });

  it("freezes the affected-corp/treasury-cost snapshot onto the bill provision at enactment", async () => {
    const billId = new ObjectId();
    const corporationId = new ObjectId();
    const snapshot = {
      kind: "corp" as const,
      corp: { name: "BYD", totalRevenuePerTurn: 1000, liquidCapitalLocal: 50 },
    };
    const { computeNationalizationProvisionDetail } =
      await import("@/lib/nationalization/billTargetPreview");
    vi.mocked(computeNationalizationProvisionDetail).mockResolvedValueOnce(snapshot as never);

    await applyLegislationEffect(db as unknown as Db, {
      _id: billId,
      countryId: "CN",
      stateId: "federal",
      provisions: [{ type: "nationalize", targetCorporationId: corporationId }],
    });

    // The snapshot is written to the bill provision...
    const updateCalls = db.collectionMocks.bills?.updateOne?.mock?.calls ?? [];
    const snapOp = updateCalls.find(
      (c: unknown[]) =>
        (c[1] as { $set?: Record<string, unknown> })?.$set?.[
          "provisions.0.nationalizationSnapshot"
        ] !== undefined
    );
    expect(snapOp).toBeDefined();
    expect(
      (snapOp![1] as { $set: Record<string, unknown> }).$set["provisions.0.nationalizationSnapshot"]
    ).toEqual(snapshot);
    // ...and the actual taking still runs.
    const { applyNationalizeProvision } =
      await import("@/lib/nationalization/legislativeNationalize");
    expect(vi.mocked(applyNationalizeProvision)).toHaveBeenCalled();
  });

  it("deactivates matching subsidies for end-subsidy bills", async () => {
    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: "UK",
      stateId: "uk_national",
      provisions: [{ type: "end_subsidy", scopeType: "economy_wide" }],
    });

    expect(db.collectionMocks["subsidies"]?.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = db.collectionMocks["subsidies"]!.updateMany.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter).toMatchObject({
      countryId: "UK",
      scope: "national",
      stateId: "uk_national",
      scopeType: "economy_wide",
      active: true,
    });
    expect(update.$set.active).toBe(false);
  });

  it("v3 Phase 7b: writes enacted union-law provisions into federalBudget, NOT tariffs (regression for the tariff-catch-all landmine)", async () => {
    const billId = new ObjectId();

    await applyLegislationEffect(db as unknown as Db, {
      _id: billId,
      countryId: "US",
      stateId: "us_national",
      provisions: [{ type: "union_law", bias: 25 }],
    });

    // The load-bearing assertion: a union_law provision must NOT fall through
    // to the trailing tariff catch-all in legislationEffects.ts (it has no
    // rate/scopeType, so being cast to TariffProvision would upsert a bogus
    // tariff record with rate: undefined). Mock collections are created
    // lazily on first access, so "tariffs" being entirely absent (never
    // touched) is the expected passing state, not just an empty call list.
    expect(db.collectionMocks["tariffs"]).toBeUndefined();

    expect(db.collectionMocks["federalBudget"]?.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter).toMatchObject({ _id: "federal" });
    expect(update.$set.unionLawBias).toBe(25);
  });
});

describe("applyLegislationEffect — union ban (player suggestion #93)", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("enacting a ban sets federalBudget.unionsBanned and suspends the country's unions, leaving unionLawBias untouched", async () => {
    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: "US",
      stateId: "us_national",
      provisions: [{ type: "union_law", bias: 0, banAction: "ban" }],
    });

    // Must not fall through to the tariff catch-all (same landmine as bias laws).
    expect(db.collectionMocks["tariffs"]).toBeUndefined();

    expect(db.collectionMocks["federalBudget"]?.updateOne).toHaveBeenCalledTimes(1);
    const [budgetFilter, budgetUpdate] = db.collectionMocks["federalBudget"]!.updateOne.mock
      .calls[0] as [Record<string, unknown>, { $set: Record<string, unknown> }];
    expect(budgetFilter).toMatchObject({ _id: "federal" });
    expect(budgetUpdate.$set.unionsBanned).toBe(true);
    // A ban action deliberately preserves the pre-ban bias for a later repeal.
    expect("unionLawBias" in budgetUpdate.$set).toBe(false);

    expect(db.collectionMocks["unions"]?.updateMany).toHaveBeenCalledTimes(1);
    const [unionFilter, unionUpdate] = db.collectionMocks["unions"]!.updateMany.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(unionFilter).toMatchObject({ countryId: "US" });
    expect(unionUpdate.$set.suspended).toBe(true);
  });

  it("enact → repeal round-trip clears unionsBanned and unsuspends unions", async () => {
    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: "US",
      stateId: "us_national",
      provisions: [{ type: "union_law", bias: 0, banAction: "ban" }],
    });
    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: "US",
      stateId: "us_national",
      provisions: [{ type: "union_law", bias: 0, banAction: "repeal_ban" }],
    });

    const budgetCalls = db.collectionMocks["federalBudget"]!.updateOne.mock.calls as Array<
      [Record<string, unknown>, { $set: Record<string, unknown> }]
    >;
    expect(budgetCalls).toHaveLength(2);
    expect(budgetCalls[1][1].$set.unionsBanned).toBe(false);

    const unionCalls = db.collectionMocks["unions"]!.updateMany.mock.calls as Array<
      [Record<string, unknown>, { $set: Record<string, unknown> }]
    >;
    expect(unionCalls).toHaveLength(2);
    expect(unionCalls[1][0]).toMatchObject({ countryId: "US" });
    expect(unionCalls[1][1].$set.suspended).toBe(false);
  });

  it("a bias-only union_law provision still writes unionLawBias and never touches the ban fields", async () => {
    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: "US",
      stateId: "us_national",
      provisions: [{ type: "union_law", bias: -30 }],
    });

    const [, update] = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set.unionLawBias).toBe(-30);
    expect("unionsBanned" in update.$set).toBe(false);
    expect(db.collectionMocks["unions"]).toBeUndefined();
  });
});

describe("applyLegislationEffect — board countries (step-6 cutover)", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    // The mock db creates collections lazily; assertions below need them to
    // exist whether or not the code under test touched them.
    db.collection("politicalMetrics");
    db.collection("stateMetrics");
    // applyBoardDelta reads the docs it will rewrite; a healed doc (residuals
    // present) is what a live world has after its first dynamics turn.
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([
        {
          _id: "KAN",
          countryId: "JP",
          values: { "education.universalSchooling": 60 },
          residuals: { "education.universalSchooling": 0 },
        },
      ]);
    db.collectionMocks["legislationTypes"] = {
      ...db.collection("legislationTypes"),
      findOne: vi.fn().mockResolvedValue({
        _id: "jp_education_act",
        effectTarget: { metricCategoryId: "education", metricId: "literacyRate" },
      }),
    } as MockDb["collectionMocks"][string];
  });

  it("shifts the board RESIDUAL, never the value, and never stateMetrics", async () => {
    // Residual, not value: the dynamics phase drifts every value toward its
    // composed target each turn, so an $inc on the value would be pulled back
    // out and the law would flicker and vanish. Moving the equilibrium is what
    // makes a legacy law behave like a new-generation one.
    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: "JP",
      stateId: "jp_national",
      legislationTypeId: "jp_education_act",
      effectDirection: 1,
    });

    expect(db.collectionMocks["stateMetrics"]?.updateMany).not.toHaveBeenCalled();
    // Scoped to the enacting country, not every non-playable region on earth.
    const findCalls = db.collectionMocks["politicalMetrics"]!.find.mock.calls;
    expect(findCalls.at(-1)?.[0]).toEqual({ countryId: "JP" });

    // Assert the effect LANDS on the dotted key, not merely that an update was
    // issued. The previous version of this test checked that an `$inc` on
    // "residuals.education.universalSchooling" was sent — which passed while
    // the write silently did nothing, because Mongo reads those dots as a path
    // and creates a nested object the read side never looks at.
    const ops = db.collectionMocks["politicalMetrics"]!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: { residuals: Record<string, number> } } };
    }>;
    expect(ops).toHaveLength(1);
    const residuals = ops[0].updateOne.update.$set.residuals;
    expect(Object.keys(residuals)).toContain("education.universalSchooling");
    expect(residuals["education.universalSchooling"]).toBeGreaterThan(0);
    // A dotted PATH would have produced a nested object instead.
    expect((residuals as Record<string, unknown>).education).toBeUndefined();
    expect(db.collectionMocks["politicalMetrics"]!.updateMany).not.toHaveBeenCalled();
  });

  it("drops a political effect when the bill has no country to attribute it to", async () => {
    // There is no legacy fallback any more: a political effect that cannot be
    // attributed to a board is dropped rather than applied to every region in
    // the world, which is what the legacy write did.
    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: undefined as never,
      stateId: "jp_national",
      legislationTypeId: "jp_education_act",
      effectDirection: 1,
    });
    expect(db.collectionMocks["stateMetrics"]?.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["politicalMetrics"]?.bulkWrite).not.toHaveBeenCalled();
  });

  it("no-ops for a legacy path the adapter does not map", async () => {
    db.collectionMocks["legislationTypes"]!.findOne = vi.fn().mockResolvedValue({
      _id: "jp_odd_act",
      effectTarget: { metricCategoryId: "governance", metricId: "notAMetric" },
    });
    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: "JP",
      stateId: "jp_national",
      legislationTypeId: "jp_odd_act",
      effectDirection: 1,
    });
    expect(db.collectionMocks["politicalMetrics"]?.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["stateMetrics"]?.updateMany).not.toHaveBeenCalled();
  });
});

describe("applyLegislationEffect — macro-metric effects are scoped to the enacting country", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("macroMetrics");
    db.collectionMocks["legislationTypes"] = {
      ...db.collection("legislationTypes"),
      findOne: vi.fn().mockResolvedValue({
        _id: "us_growth_act",
        effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth" },
      }),
    } as MockDb["collectionMocks"][string];
  });

  it("filters the macroMetrics write by countryId instead of hitting every region on earth", async () => {
    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: "US",
      stateId: "federal",
      legislationTypeId: "us_growth_act",
      effectDirection: 1,
    });
    const calls = db.collectionMocks["macroMetrics"]!.updateMany.mock.calls;
    expect(calls).toHaveLength(1);
    const [filter, update] = calls[0] as [
      Record<string, unknown>,
      { $inc: Record<string, number> },
    ];
    expect(filter).toEqual({ countryId: "US" });
    expect(Object.keys(update.$inc)).toEqual(["economic.gdpGrowth.value"]);
  });

  it("drops a macro effect when the bill has no country to attribute it to", async () => {
    await applyLegislationEffect(db as unknown as Db, {
      _id: new ObjectId(),
      countryId: undefined as never,
      stateId: "federal",
      legislationTypeId: "us_growth_act",
      effectDirection: 1,
    });
    expect(db.collectionMocks["macroMetrics"]!.updateMany).not.toHaveBeenCalled();
  });
});

describe("applyLegislationEffect — war declarations", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
    // clearAllMocks resets calls but NOT implementations, so a test that seats an
    // alliance would otherwise leak into every test after it.
    allianceBarSpy.mockResolvedValue(null);
  });

  // A declaration sits before the chambers for turns, and either country can accede to
  // the other's bloc while it does. Without this re-read, a bill filed against a
  // neutral would enact as an intra-alliance war the proposal gate had already refused.
  it("drops a ratified declaration that has become an attack on an ally", async () => {
    allianceBarSpy.mockResolvedValue("North Atlantic Treaty Organization");
    await applyLegislationEffect(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        countryId: "US",
        provisions: [{ type: "declare_war", targetCountry: "UK", warGoal: "punitive" }],
      } as never
    );
    expect(declareWarSpy).not.toHaveBeenCalled();
  });

  it("re-reads the bar for the declarer against the target", async () => {
    await applyLegislationEffect(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        countryId: "US",
        provisions: [{ type: "declare_war", targetCountry: "CN", warGoal: "punitive" }],
      } as never
    );
    expect(allianceBarSpy).toHaveBeenCalledWith(expect.anything(), "US", "CN");
  });

  it("starts the war when a declaration is enacted", async () => {
    await applyLegislationEffect(
      db as unknown as Db,
      {
        _id: new ObjectId("507f1f77bcf86cd799439011"),
        countryId: "US",
        provisions: [{ type: "declare_war", targetCountry: "CN", warGoal: "punitive" }],
      } as never
    );

    expect(declareWarSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        declarer: "US",
        defender: "CN",
        warGoal: "punitive",
        billId: "507f1f77bcf86cd799439011",
        currentTurn: 42,
      })
    );
  });

  it("does not treat a declaration as a policy provision", async () => {
    // isPolicyProvision identifies policy by EXCLUDING every other type. Without
    // declare_war in that chain the provision would never reach the branch above
    // and would be written into a policy record instead.
    await applyLegislationEffect(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        countryId: "US",
        provisions: [{ type: "declare_war", targetCountry: "CN", warGoal: "punitive" }],
      } as never
    );
    expect(declareWarSpy).toHaveBeenCalledTimes(1);
  });

  it("leaves other bills alone", async () => {
    await applyLegislationEffect(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        countryId: "US",
        provisions: [{ type: "embargo", targetCountry: "CN", commodity: "all", direction: "both" }],
      } as never
    );
    expect(declareWarSpy).not.toHaveBeenCalled();
  });
});
