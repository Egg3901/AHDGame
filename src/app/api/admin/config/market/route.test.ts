import { describe, expect, it, vi, beforeEach } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn(async () => undefined) }));

function makePatchRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/config/market", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/PATCH /api/admin/config/market — extractionOutputScaleEnabled", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameConfig");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);
  });

  it("GET reflects extractionOutputScaleEnabled from gameConfig", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
      extractionOutputScaleEnabled: true,
    });

    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as { extractionOutputScaleEnabled: boolean };

    expect(body.extractionOutputScaleEnabled).toBe(true);
  });

  it("GET defaults extractionOutputScaleEnabled to false when absent", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });

    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as { extractionOutputScaleEnabled: boolean };

    expect(body.extractionOutputScaleEnabled).toBe(false);
  });

  it("PATCH sets extractionOutputScaleEnabled via $set without touching unrelated flags", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchRequest({ mode: "capital", extractionOutputScaleEnabled: true })
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.gameConfig!.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      {
        $set: expect.objectContaining({
          marketSystemMode: "capital",
          extractionOutputScaleEnabled: true,
        }),
      },
      { upsert: true }
    );
  });

  it("PATCH omits extractionOutputScaleEnabled from $set when not provided", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });

    const { PATCH } = await import("./route");
    await PATCH(makePatchRequest({ mode: "capital" }));

    const setArg = db.collectionMocks.gameConfig!.updateOne.mock.calls[0]?.[1]?.$set as Record<
      string,
      unknown
    >;
    expect(setArg).not.toHaveProperty("extractionOutputScaleEnabled");
  });

  it("GET reflects shortage-responsive sourcing and defaults it off", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
      shortageResponsiveSourcingEnabled: true,
    });
    const { GET } = await import("./route");
    const enabled = (await (await GET()).json()) as {
      shortageResponsiveSourcingEnabled: boolean;
    };
    expect(enabled.shortageResponsiveSourcingEnabled).toBe(true);

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });
    const absent = (await (await GET()).json()) as {
      shortageResponsiveSourcingEnabled: boolean;
    };
    expect(absent.shortageResponsiveSourcingEnabled).toBe(false);
  });

  it("PATCH writes the dark sourcing gate only when explicitly provided", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });
    const { PATCH } = await import("./route");
    await PATCH(
      makePatchRequest({
        mode: "capital",
        shortageResponsiveSourcingEnabled: true,
        intervention: {
          id: "issue-968-shortage-sourcing",
          issueId: 968,
          owner: "operator",
          objective: "Increase buyer intent fulfillment.",
          targets: [
            {
              metric: "intentFulfillmentRate",
              direction: "increase",
              minimumImprovement: 0.05,
            },
          ],
          guardrails: [
            {
              metric: "physicalSellThrough",
              direction: "increase",
              maximumDeterioration: 0.05,
            },
          ],
          cohort: { initialShare: 0.1, maximumShare: 1, rampTurns: 24 },
          review: { startTurn: 0, reviewTurn: 10_000 },
          rollback: {
            owner: "operator",
            trigger: "A guardrail breaches.",
            action: "Disable shortage sourcing.",
          },
        },
      })
    );
    const setArg = db.collectionMocks.gameConfig!.updateOne.mock.calls[0]?.[1]?.$set as Record<
      string,
      unknown
    >;
    expect(setArg.shortageResponsiveSourcingEnabled).toBe(true);
    expect(setArg.shortageResponsiveSourcingIntervention).toMatchObject({
      id: "issue-968-shortage-sourcing",
      issueId: 968,
    });
  });

  it("refuses an ungoverned shortage-sourcing activation", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchRequest({ mode: "capital", shortageResponsiveSourcingEnabled: true })
    );

    expect(res.status).toBe(400);
    expect(db.collectionMocks.gameConfig!.updateOne).not.toHaveBeenCalled();
  });

  it("requires and persists governance for bond liquidity", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });
    const { PATCH } = await import("./route");
    const refused = await PATCH(
      makePatchRequest({ mode: "capital", indexFundBondLiquidityEnabled: true })
    );
    expect(refused.status).toBe(400);

    const bondLiquidityIntervention = {
      id: "issue-968-bond-liquidity",
      issueId: 968,
      owner: "operator",
      objective: "Reduce unheld sovereign bond issues.",
      targets: [{ metric: "noHolderBondShare", direction: "decrease", minimumImprovement: 0.1 }],
      guardrails: [
        { metric: "fundBackingRatio", direction: "increase", maximumDeterioration: 0.05 },
      ],
      cohort: { initialShare: 0.1, maximumShare: 1, rampTurns: 24 },
      review: { startTurn: 0, reviewTurn: 10_000 },
      rollback: {
        owner: "operator",
        trigger: "Fund backing deteriorates.",
        action: "Disable bond liquidity and retain existing assets.",
      },
    };
    const accepted = await PATCH(
      makePatchRequest({
        mode: "capital",
        indexFundBondLiquidityEnabled: true,
        bondLiquidityIntervention,
      })
    );
    expect(accepted.status).toBe(200);
    const setArg = db.collectionMocks.gameConfig!.updateOne.mock.calls.at(-1)?.[1]?.$set as Record<
      string,
      unknown
    >;
    expect(setArg.indexFundBondLiquidityEnabled).toBe(true);
    expect(setArg.indexFundBondLiquidityIntervention).toEqual(bondLiquidityIntervention);
  });

  it("requires and persists governance for bounded equity liquidity", async () => {
    const { PATCH } = await import("./route");
    const refused = await PATCH(
      makePatchRequest({ mode: "capital", equityLiquidityFacilityEnabled: true })
    );
    expect(refused.status).toBe(400);

    const equityLiquidityIntervention = {
      id: "issue-990-equity-liquidity",
      issueId: 990,
      owner: "operator",
      objective: "Increase executable two-sided equity depth.",
      targets: [{ metric: "twoSidedListingShare", direction: "increase", minimumImprovement: 0.2 }],
      guardrails: [
        { metric: "fundBackingRatio", direction: "increase", maximumDeterioration: 0.02 },
      ],
      cohort: { initialShare: 0.1, maximumShare: 0.4, rampTurns: 48 },
      review: { startTurn: 0, reviewTurn: 10_000 },
      rollback: {
        owner: "operator",
        trigger: "Fund backing, concentration, or market-quality guardrails fail.",
        action: "Disable the facility and cancel all standing quotes.",
      },
    };
    const accepted = await PATCH(
      makePatchRequest({
        mode: "capital",
        equityLiquidityFacilityEnabled: true,
        equityLiquidityIntervention,
      })
    );
    expect(accepted.status).toBe(200);
    const setArg = db.collectionMocks.gameConfig!.updateOne.mock.calls.at(-1)?.[1]?.$set as Record<
      string,
      unknown
    >;
    expect(setArg.equityLiquidityFacilityEnabled).toBe(true);
    expect(setArg.equityLiquidityFacilityIntervention).toEqual(equityLiquidityIntervention);
  });

  it("requires and persists governance for NPP market coverage", async () => {
    const { PATCH } = await import("./route");
    const refused = await PATCH(
      makePatchRequest({ mode: "capital", nppMarketCoverageEnabled: true })
    );
    expect(refused.status).toBe(400);

    const marketCoverageIntervention = {
      id: "issue-991-market-coverage",
      issueId: 991,
      owner: "operator",
      objective: "Reduce facility-ready empty state-sector markets.",
      targets: [
        { metric: "facilityReadyEmptyMarketShare", direction: "decrease", minimumImprovement: 0.1 },
      ],
      guardrails: [{ metric: "pooledFillRate", direction: "increase", maximumDeterioration: 0.02 }],
      cohort: { initialShare: 0.125, maximumShare: 1, rampTurns: 48 },
      review: { startTurn: 0, reviewTurn: 10_000 },
      rollback: {
        owner: "operator",
        trigger: "Coverage or market-quality guardrails fail.",
        action: "Disable NPP market coverage routing.",
      },
    };
    const accepted = await PATCH(
      makePatchRequest({
        mode: "capital",
        nppMarketCoverageEnabled: true,
        marketCoverageIntervention,
      })
    );
    expect(accepted.status).toBe(200);
    const setArg = db.collectionMocks.gameConfig!.updateOne.mock.calls.at(-1)?.[1]?.$set as Record<
      string,
      unknown
    >;
    expect(setArg.nppMarketCoverageEnabled).toBe(true);
    expect(setArg.nppMarketCoverageIntervention).toEqual(marketCoverageIntervention);
  });
});

// MARKET_MODE_INFO[mode].live was enforced ONLY by the admin selector disabling
// the option. A direct PATCH — curl, a stale tab, a script — could flip the LIVE
// world onto an unlaunched tier with nothing on the server to stop it.
//
// Every shipped tier is now `live: true`, so there is no real mode left that
// exercises the refusal branch. Mocking the metadata rather than deleting the
// test is deliberate: the guard is a standing safety property of the ROUTE, and
// it has to keep working for whatever tier ships next. A test that could only
// be written while an unlaunched tier happened to exist would delete itself at
// exactly the moment the next one needed it.
vi.mock("@/lib/market/modes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/market/modes")>();
  return {
    ...actual,
    MARKET_MODE_INFO: {
      ...actual.MARKET_MODE_INFO,
      plants: { ...actual.MARKET_MODE_INFO.plants, live: false },
    },
  };
});

describe("PATCH /api/admin/config/market — non-live tier gate", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);
  });

  it("rejects a non-live mode (plants) with 400 and writes nothing", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchRequest({ mode: "plants" }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not live");
    expect(db.collectionMocks.gameConfig!.updateOne).not.toHaveBeenCalled();
  });

  it("accepts a non-live mode when allowNonLive is true", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchRequest({ mode: "plants", allowNonLive: true }));

    expect(res.status).toBe(200);
    expect(db.collectionMocks.gameConfig!.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      { $set: expect.objectContaining({ marketSystemMode: "plants" }) },
      { upsert: true }
    );
  });

  it("does not require allowNonLive for a live mode", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchRequest({ mode: "capital" }));

    expect(res.status).toBe(200);
    expect(db.collectionMocks.gameConfig!.updateOne).toHaveBeenCalled();
  });

  it("allowNonLive does not bypass the enum — an unknown mode is still 400", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchRequest({ mode: "teleportation", allowNonLive: true }));

    expect(res.status).toBe(400);
    expect(db.collectionMocks.gameConfig!.updateOne).not.toHaveBeenCalled();
  });

  // "off" must never be gated — it is the escape hatch back to baseline.
  it("never gates the off tier", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchRequest({ mode: "off" }));

    expect(res.status).toBe(200);
  });
});

/**
 * A mode change has to be answerable in TURNS, not just wall-clock.
 *
 * Everything an operator asks after a tier flip is turn-indexed — how much
 * soak has accumulated, which turns are the pre-flip baseline, whether the
 * plants governor ramp (anchored on `plantsStartTurn`) has finished. Turns do
 * not advance on a fixed wall clock (pauses, stalls, sim worlds), so an ISO
 * timestamp cannot be mapped back to one after the fact. The route reads the
 * turn at the moment of the flip and stamps it alongside the who and the when.
 */
describe("PATCH /api/admin/config/market — mode-change provenance", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameConfig");
    db.collection("gameState");
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 1234,
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "operator" },
    } as never);
  });

  it("stamps who, when and on WHICH TURN the mode changed", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchRequest({ mode: "plants", allowNonLive: true }));

    expect(res.status).toBe(200);
    const setArg = db.collectionMocks.gameConfig!.updateOne.mock.calls[0]?.[1]?.$set as Record<
      string,
      unknown
    >;
    expect(setArg.marketSystemMode).toBe("plants");
    expect(setArg.marketSystemModeUpdatedBy).toBe("operator");
    expect(setArg.marketSystemModeUpdatedTurn).toBe(1234);
    expect(typeof setArg.marketSystemModeUpdatedAt).toBe("string");
  });

  it("records the prior mode and the turn in the admin log", async () => {
    const { PATCH } = await import("./route");
    await PATCH(makePatchRequest({ mode: "plants", allowNonLive: true }));

    const { createAdminLog } = await import("@/lib/adminLog");
    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "market_system_set",
        adminUsername: "operator",
        details: expect.stringContaining('was "capital"'),
      })
    );
    const details = vi.mocked(createAdminLog).mock.calls[0]?.[0]?.details as string;
    expect(details).toContain("turn 1234");
  });

  it("returns the prior mode to the caller so a flip is confirmable", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchRequest({ mode: "plants", allowNonLive: true }));
    const body = (await res.json()) as { mode: string; priorMode: string };

    expect(body).toMatchObject({ mode: "plants", priorMode: "capital" });
  });

  it("stamps the turn on a rollback flip too (plants -> capital)", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 1300,
    });

    const { PATCH } = await import("./route");
    await PATCH(makePatchRequest({ mode: "capital" }));

    const setArg = db.collectionMocks.gameConfig!.updateOne.mock.calls[0]?.[1]?.$set as Record<
      string,
      unknown
    >;
    expect(setArg.marketSystemMode).toBe("capital");
    expect(setArg.marketSystemModeUpdatedTurn).toBe(1300);
  });
});
