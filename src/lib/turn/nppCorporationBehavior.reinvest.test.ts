/**
 * NPP capacity reinvestment under the plants tier.
 *
 * Under `capital` the NPP brain kept capacity topped up implicitly, through
 * `targetGrowthRate` → `advanceCapitalStock`. Plants retires that slider, and
 * this module only ever placed a build order when FOUNDING a sector — so
 * `CAPITAL_DEPRECIATION_PER_TURN` ran one-way and the AI economy decayed with
 * zero outstanding build queues at turn 96 of a controlled A/B.
 *
 * These tests pin the replacement decision: fires on a high-fill sector with
 * headroom, stays out of every case where it should not, conserves headroom
 * against units ordered, prices in the corp's own currency, and leaves the
 * non-plants path untouched.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  makeNppCorpDecision,
  type CommodityPriceRatioFn,
  type NppPlantsContext,
} from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import {
  CAPACITY_ANCHOR_YEAR,
  CAPACITY_BUILD_TURNS,
  computeBuildCost,
} from "@/lib/constants/capacityEconomy";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";
import { foundingStarterUnits } from "@/lib/corporations/foundingPlant";
import type { PlacementSignals } from "@/lib/turn/npp/marketSignals";

const noPrices: CommodityPriceRatioFn = () => null;
const noState = new Set<string>();
const TURN = 200;

const POOL_REVENUE = 40_000_000;
const POOL_UNITS = computeUnownedHeadroomUnits("manufacturing", POOL_REVENUE, 1);

const plantsCtx: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

/** The pool for the bucket the corp's OWN manufacturing sector sits in. */
function pool(overrides: Partial<UnownedSector> = {}): UnownedSector {
  return {
    _id: new ObjectId(),
    stateId: "CA",
    countryId: "US",
    sectorType: "manufacturing",
    revenue: POOL_REVENUE,
    headroomUnits: POOL_UNITS,
    ...overrides,
  } as unknown as UnownedSector;
}

function corp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    name: "Acme",
    countryId: "US",
    type: "manufacturing",
    headquartersState: "CA",
    liquidCapital: 500_000_000,
    ceoType: "npp",
    ...overrides,
  } as unknown as Corporation;
}

/**
 * A healthy, selling-out manufacturing plant in CA. `capitalStock` is what the
 * reinvestment is sized off; `producedUnits`/`soldUnits` are the demand
 * evidence.
 */
function sector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    sectorType: "manufacturing",
    countryId: "US",
    stateId: "CA",
    revenue: 10_000_000,
    profitMargin: 30,
    effectiveProfitMargin: 30,
    targetGrowthRate: 3,
    capitalStock: 1_000,
    producedUnits: 1_000,
    soldUnits: 1_000,
    ...overrides,
  } as unknown as CorporateSector;
}

function decide(
  c: Corporation,
  sectors: CorporateSector[],
  pools: UnownedSector[],
  plants: NppPlantsContext | null = plantsCtx,
  extra: {
    fxRate?: number;
    stateControlled?: Set<string>;
    placementSignals?: PlacementSignals;
    prices?: CommodityPriceRatioFn;
  } = {}
) {
  return makeNppCorpDecision(
    {
      corp: c,
      sectors,
      turn: TURN,
      now: new Date(),
      fxRate: extra.fxRate,
      modifiers: ceoArchetypeModifiers("cautious"),
    },
    new Map<string, UnownedSector[]>([["US", pools]]),
    extra.stateControlled ?? noState,
    extra.prices ?? noPrices,
    plants ?? undefined,
    extra.placementSignals
  );
}

/**
 * Reinvestment orders are the build-queue writes; growth/policy writes are not.
 * The write is a DELTA (`$push` + `$inc`), never a whole-array `$set` — a `$set`
 * would land after `sectorTurn`'s `$pull` of completed orders and resurrect
 * them. That shape is part of the contract, so the helper asserts it.
 */
function queueWrites(decision: ReturnType<typeof makeNppCorpDecision>) {
  const writes = decision.sectorUpdates.filter((u) => u.update.$push?.buildQueue !== undefined);
  for (const w of writes) {
    expect(w.update.$set).not.toHaveProperty("buildQueue");
    expect(w.update.$set).not.toHaveProperty("constructionInProgressAnchor");
  }
  return writes;
}

/** The single order a reinvestment write pushes. */
function pushedOrder(write: ReturnType<typeof queueWrites>[number]) {
  return write.update.$push!.buildQueue as Record<string, number>;
}

describe("NPP capacity reinvestment — fires on a selling-out sector with headroom", () => {
  it("buys at least one whole factory when discretionary growth is justified", () => {
    const decision = decide(corp(), [sector()], [pool()]);
    const growthUnits = decision.unownedDraws?.[0]?.units ?? 0;

    expect(growthUnits).toBeGreaterThanOrEqual(foundingStarterUnits("manufacturing"));
  });

  it("queues replacement plus at least one whole factory of chosen growth", () => {
    const s = sector();
    const decision = decide(corp(), [s], [pool()]);

    const writes = queueWrites(decision);
    expect(writes).toHaveLength(1);
    const order = pushedOrder(writes[0]);

    // fill == 1 ⇒ fillScale 1; AGGRESSION 1.
    const expectedUnits =
      (s.capitalStock ?? 0) * CAPITAL_DEPRECIATION_PER_TURN + foundingStarterUnits("manufacturing");
    expect(order.unitsOrdered).toBeCloseTo(expectedUnits, 6);
    expect(order.startTurn).toBe(TURN);
    expect(order.onlineTurn).toBe(TURN + CAPACITY_BUILD_TURNS("manufacturing"));
    expect(order.costPaidAnchor).toBeGreaterThan(0);

    // CIP moves by exactly what this order costs — an increment, so it composes
    // with the turn processor's own CIP decrement for orders that landed.
    expect(writes[0].update.$inc!.constructionInProgressAnchor).toBe(
      Math.round(order.costPaidAnchor)
    );

    // Charged, and above the cash floor.
    expect(decision.updates.liquidCapital as number).toBeLessThan(500_000_000);
    expect(decision.reinvestments).toHaveLength(1);
    expect(decision.reinvestments![0].sectorId).toEqual(s._id);
  });

  it("pushes onto an existing queue without restating it", () => {
    const existing = { unitsOrdered: 5, costPaidAnchor: 1_000, startTurn: 1, onlineTurn: 2 };
    const decision = decide(corp(), [sector({ buildQueue: [existing] })], [pool()]);
    const write = queueWrites(decision)[0];
    // A single order, pushed — the pre-existing order is never re-sent, so a
    // concurrent landing or a player build cannot be clobbered.
    expect(pushedOrder(write).startTurn).toBe(TURN);
    expect(JSON.stringify(write.update)).not.toContain('"unitsOrdered":5,');
  });

  it("caps at one sector per corp per turn, best fill × headroom first", () => {
    const weak = sector({ stateId: "CA", producedUnits: 1_000, soldUnits: 900 });
    const strong = sector({ stateId: "NY", producedUnits: 1_000, soldUnits: 1_000 });
    const decision = decide(
      corp(),
      [weak, strong],
      [pool({ stateId: "CA" }), pool({ stateId: "NY" })]
    );
    const writes = queueWrites(decision);
    expect(writes).toHaveLength(1);
    expect(writes[0].filter._id).toEqual(strong._id);
  });

  it("reallocates the existing build slot to critically short freight capacity", () => {
    const manufacturing = sector({
      stateId: "CA",
      producedUnits: 1_000,
      soldUnits: 1_000,
    });
    const logistics = sector({
      sectorType: "logistics",
      stateId: "NY",
      producedUnits: 1_000,
      soldUnits: 900,
    });
    const pools = [pool({ stateId: "CA" }), pool({ stateId: "NY", sectorType: "logistics" })];
    const treatment = decide(corp(), [manufacturing, logistics], pools, plantsCtx, {
      placementSignals: { preferFragileMarketSupply: true },
      prices: (commodity) => (commodity === "freight" ? 2 : 1),
    });

    const writes = queueWrites(treatment);
    expect(writes).toHaveLength(1);
    expect(writes[0].filter._id).toEqual(logistics._id);
  });

  it("does not buy fractional growth when the bucket cannot fit one factory", () => {
    // A huge plant next to a nearly exhausted pool. Maintenance still runs,
    // but discretionary growth waits until a whole facility fits.
    const tinyPool = pool({ headroomUnits: 4, revenue: 1 });
    const decision = decide(
      corp(),
      [sector({ capitalStock: 100_000_000, producedUnits: 1_000, soldUnits: 1_000 })],
      [tinyPool]
    );
    const order = pushedOrder(queueWrites(decision)[0]);
    const replacement = 1_000 * CAPITAL_DEPRECIATION_PER_TURN;
    expect(order.unitsOrdered).toBeCloseTo(replacement, 6);
    expect(decision.unownedDraws).toBeUndefined();
  });
});

describe("NPP capacity reinvestment — does not fire", () => {
  const cases: Array<[string, () => ReturnType<typeof makeNppCorpDecision>]> = [
    [
      "broke (cannot clear the cash floor)",
      () => decide(corp({ liquidCapital: 1 }), [sector()], [pool()]),
    ],
    ["mothballed", () => decide(corp(), [sector({ mothballed: true })], [pool()])],
    [
      "already carrying the max queue depth",
      () =>
        decide(
          corp(),
          [
            sector({
              buildQueue: Array.from({ length: 20 }, () => ({
                unitsOrdered: 1,
                costPaidAnchor: 1,
                startTurn: 1,
                onlineTurn: 2,
              })),
            }),
          ],
          [pool()]
        ),
    ],
    [
      "selling below the minimum fill",
      () => decide(corp(), [sector({ producedUnits: 1_000, soldUnits: 500 })], [pool()]),
    ],
    [
      "no units telemetry (no evidence of demand)",
      () => decide(corp(), [sector({ producedUnits: undefined, soldUnits: undefined })], [pool()]),
    ],
    [
      "nothing built yet (capitalStock 0)",
      () => decide(corp(), [sector({ capitalStock: 0 })], [pool()]),
    ],
    [
      "a private corp in a state-controlled bucket",
      () =>
        decide(corp(), [sector()], [pool()], plantsCtx, {
          stateControlled: new Set(["CA:manufacturing"]),
        }),
    ],
  ];

  for (const [label, run] of cases) {
    it(label, () => {
      const decision = run();
      expect(queueWrites(decision)).toHaveLength(0);
      expect(decision.reinvestments).toBeUndefined();
    });
  }

  it("does not add growth to a plant whose canonical physical P&L is negative", () => {
    const losing = sector({
      plantsPnl: {
        revenue: 1_000,
        inventoryRevenue: 0,
        inventoryCarry: 0,
        inputs: 700,
        labour: 300,
        upkeep: 100,
        compliance: 0,
        otherOpex: 0,
        financialLegs: 0,
        policyCredit: 0,
        policyPp: 0,
        operatingCost: 1_000,
        totalCost: 1_100,
        profit: -100,
        turn: TURN - 1,
      },
    });
    const decision = decide(corp(), [losing], [pool()]);

    expect(decision.unownedDraws).toBeUndefined();
  });

  // SUPERSEDED. This used to assert "an SOE MAY build into its own nationalized
  // bucket" — the carve-out that let a state enterprise through the private,
  // cash-rationed path. It cannot any more: an SOE has no operating cash of its
  // own to ration (the treasury backs only its OPERATING loss), so paying for
  // its own capex here is what drove 38 command SOEs permanently insolvent in
  // the plants A/B. Its capacity is funded by the state instead — see the
  // exclusion block below and `soeCapexChannel.test.ts`.
  it("an SOE in its own nationalized bucket still places no order", () => {
    const decision = decide(
      corp({ ownershipState: "stateOwned" }),
      [sector()],
      [pool()],
      plantsCtx,
      { stateControlled: new Set(["CA:manufacturing"]) }
    );
    expect(queueWrites(decision)).toHaveLength(0);
    // And it spends nothing: no state enterprise pays for plant out of its own
    // operating cash on this path.
    expect(decision.updates.liquidCapital).toBeUndefined();
  });
});

describe("NPP capacity reinvestment — conservation and pricing", () => {
  it("draws the GROWTH leg out of the unowned pool, and only that leg", () => {
    const s = sector();
    const decision = decide(corp(), [s], [pool()]);
    const order = pushedOrder(queueWrites(decision)[0]);
    expect(decision.unownedDraws).toHaveLength(1);
    expect(decision.unownedDraws![0]).toMatchObject({
      stateId: "CA",
      sectorType: "manufacturing",
      countryId: "US",
    });
    const growth = foundingStarterUnits("manufacturing");
    const replacement = (s.producedUnits ?? 0) * CAPITAL_DEPRECIATION_PER_TURN;
    expect(order.unitsOrdered).toBeCloseTo(growth + replacement, 10);
    // Replacement buys back capacity that already existed in this market and
    // was never returned to the pool when it depreciated — charging the pool
    // for it would bill the same demand twice.
    expect(decision.unownedDraws![0].units).toBeCloseTo(growth, 10);
  });

  it("prices the build at the non-founding list price in the corp's own currency", () => {
    const s = sector();
    const fxRate = 360; // JPY-scale
    // The cash floor is fx-scaled too, so a JPY corp needs a JPY-scale balance.
    const OPENING = 500_000_000_000;
    const c = corp({
      liquidCurrencyCode: "JPY",
      liquidCapital: OPENING,
    } as Partial<Corporation>);
    const decision = decide(c, [s], [pool()], plantsCtx, { fxRate });

    const order = pushedOrder(queueWrites(decision)[0]);
    const units = order.unitsOrdered;
    const bucketTotal = (s.capitalStock ?? 0) + POOL_UNITS;
    const expectedAnchor = computeBuildCost({
      eraUnitScale: 1,
      sectorType: "manufacturing",
      units,
      year: CAPACITY_ANCHOR_YEAR,
      marketSharePercent: (100 * (s.capitalStock ?? 0)) / bucketTotal,
      primeRate: 0,
      founding: false,
    }).totalAnchor;

    expect(order.costPaidAnchor).toBeCloseTo(expectedAnchor, 4);
    // The CHARGE is fx-converted; the stored order cost stays in ₳.
    const charged = OPENING - (decision.updates.liquidCapital as number);
    expect(charged / (expectedAnchor * fxRate)).toBeCloseTo(1, 9);
  });

  it("an anchor-currency corp is charged the anchor amount unchanged", () => {
    const decision = decide(corp(), [sector()], [pool()]);
    const charged = 500_000_000 - (decision.updates.liquidCapital as number);
    expect(charged).toBeCloseTo(decision.reinvestments![0].costAnchor, 6);
  });
});

describe("NPP capacity reinvestment — a full bucket still gets MAINTENANCE", () => {
  // THE 96-TURN ZERO-BUILD REGRESSION. A bucket an incumbent fills has zero
  // unowned headroom by construction, and nothing ever puts headroom back:
  // depreciation destroys owned capacity without returning it to the pool. The
  // first cut gated the whole build on `headroomUnits > 0`, so the sectors that
  // most needed replacement could never buy it. Measured on the controlled A/B
  // (`ab4_plants`, turn 135): 237 of the 238 NPP sectors that passed every other
  // gate were refused here, and the world carried ZERO build queues.
  const noRoom: Array<[string, UnownedSector[]]> = [
    ["an exhausted pool", [pool({ headroomUnits: 0, revenue: 0 })]],
    ["no pool doc for the bucket at all", []],
  ];

  for (const [label, pools] of noRoom) {
    it(`still replaces depreciation with ${label}`, () => {
      const s = sector();
      const decision = decide(corp(), [s], pools);
      const writes = queueWrites(decision);
      expect(writes).toHaveLength(1);
      // Replacement only — no growth leg is possible with no headroom.
      expect(pushedOrder(writes[0]).unitsOrdered).toBeCloseTo(
        (s.producedUnits ?? 0) * CAPITAL_DEPRECIATION_PER_TURN,
        10
      );
      // ...and nothing is drawn from a pool it did not consume.
      expect(decision.unownedDraws).toBeUndefined();
    });
  }

  it("replaces only the capacity it actually RUNS, not idle nameplate", () => {
    // 15% of this plant is idle (throughput-bound), and idle capacity already
    // costs IDLE_UPKEEP_FRACTION every turn. Buying it back each turn would
    // fund that drag in perpetuity.
    const s = sector({ capitalStock: 1_000, producedUnits: 850, soldUnits: 850 });
    const decision = decide(corp(), [s], [pool({ headroomUnits: 0, revenue: 0 })]);
    expect(pushedOrder(queueWrites(decision)[0]).unitsOrdered).toBeCloseTo(
      850 * CAPITAL_DEPRECIATION_PER_TURN,
      10
    );
  });
});

describe("NPP capacity reinvestment — the two cash rails", () => {
  /** Cost of the maintenance-only build the base fixture places. */
  function maintenanceCost(): number {
    const decision = decide(corp(), [sector()], [pool({ headroomUnits: 0, revenue: 0 })]);
    return decision.reinvestments![0].costAnchor;
  }

  it("a corp far below the entry cash floor still funds maintenance", () => {
    // The death spiral this closes: below the floor a corp could not spend one
    // unit, so its plant decayed, revenue fell, cash fell, and it could never
    // re-qualify. 317 of 395 NPP corps sat here at turn 135 of the A/B.
    const cost = maintenanceCost();
    const c = corp({ liquidCapital: cost * 10 }); // way under CASH_FLOOR
    const decision = decide(c, [sector()], [pool({ headroomUnits: 0, revenue: 0 })]);
    expect(queueWrites(decision)).toHaveLength(1);
    expect(decision.updates.liquidCapital as number).toBeGreaterThan(0);
  });

  it("but never more than a quarter of what it holds", () => {
    const cost = maintenanceCost();
    const decision = decide(
      corp({ liquidCapital: cost * 3 }), // cost is a THIRD of cash — too much
      [sector()],
      [pool({ headroomUnits: 0, revenue: 0 })]
    );
    expect(queueWrites(decision)).toHaveLength(0);
  });

  it("a build carrying a GROWTH leg still faces the full entry floor", () => {
    const cost = maintenanceCost();
    // Same balance that funded maintenance above, now with headroom available:
    // the growth leg makes it a discretionary bet, and the floor bites.
    const decision = decide(corp({ liquidCapital: cost * 10 }), [sector()], [pool()]);
    expect(queueWrites(decision)).toHaveLength(0);
  });
});

describe("NPP capacity reinvestment — a multi-turn world keeps building", () => {
  /**
   * The test that would have caught "zero builds in a 96-turn world". A single
   * corp is run forward turn by turn against its own decisions: orders land on
   * their `onlineTurn`, capacity depreciates every turn, and cash is charged.
   * The bucket is FULL (no headroom) — the state the A/B world was actually in.
   */
  it("places an order on most turns and roughly holds capacity over 96 turns", () => {
    const TURNS = 96;
    let capital = 5_000_000; // well below the ₳2,000,000 entry floor after fx? no: above.
    let stock = 1_000;
    const queue: Array<{ units: number; onlineTurn: number; startTurn: number }> = [];
    const id = new ObjectId();
    const corpId = new ObjectId();
    let ordersPlaced = 0;
    let lastOrderTurn = 0;
    let longestSilence = 0;
    const startStock = stock;

    for (let turn = 1; turn <= TURNS; turn++) {
      // Deliveries first, then depreciation — the same order sectorTurn uses.
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].onlineTurn <= turn) {
          stock += queue[i].units;
          queue.splice(i, 1);
        }
      }
      stock = Math.max(0, stock * (1 - CAPITAL_DEPRECIATION_PER_TURN));

      const produced = stock; // fully utilized, sells out
      const decision = makeNppCorpDecision(
        {
          corp: {
            _id: corpId,
            name: "Acme",
            countryId: "US",
            type: "manufacturing",
            headquartersState: "CA",
            liquidCapital: capital,
            ceoType: "npp",
          } as unknown as Corporation,
          sectors: [
            sector({
              _id: id,
              capitalStock: stock,
              producedUnits: produced,
              soldUnits: produced,
              buildQueue: queue.map((q) => ({
                unitsOrdered: q.units,
                costPaidAnchor: 0,
                startTurn: q.startTurn,
                onlineTurn: q.onlineTurn,
              })),
            }),
          ],
          turn,
          now: new Date(),
          modifiers: ceoArchetypeModifiers("cautious"),
        },
        new Map<string, UnownedSector[]>([["US", [pool({ headroomUnits: 0, revenue: 0 })]]]),
        noState,
        noPrices,
        plantsCtx
      );

      const writes = queueWrites(decision);
      if (writes.length > 0) {
        ordersPlaced++;
        const order = pushedOrder(writes[0]);
        queue.push({
          units: order.unitsOrdered,
          onlineTurn: order.onlineTurn,
          startTurn: order.startTurn,
        });
        capital = decision.updates.liquidCapital as number;
        longestSilence = Math.max(longestSilence, turn - lastOrderTurn);
        lastOrderTurn = turn;
      }
    }

    // THE ASSERTION THAT WAS MISSING: a plants world builds. Zero orders in 96
    // turns is the exact regression this file exists to prevent.
    expect(ordersPlaced).toBeGreaterThan(0);
    // ...and it never goes quiet for a whole build cycle — the queue ceiling
    // may throttle the cadence, but a landing always frees it again.
    expect(longestSilence).toBeLessThanOrEqual(CAPACITY_BUILD_TURNS("manufacturing"));
    expect(capital).toBeGreaterThan(0);
    // And the plant roughly HOLDS. Not a boom: replacement cannot fully beat
    // depreciation over a horizon shorter than the build lag.
    expect(stock).toBeGreaterThan(startStock * 0.95);
    expect(stock).toBeLessThan(startStock * 1.05);
  });
});

describe("NPP capacity reinvestment — non-plants worlds are unchanged", () => {
  it("places no build order and spends nothing when plants is off", () => {
    const decision = decide(corp(), [sector()], [pool()], null);
    expect(queueWrites(decision)).toHaveLength(0);
    expect(decision.reinvestments).toBeUndefined();
    expect(decision.unownedDraws).toBeUndefined();
  });

  it("is identical with an explicitly disabled plants context", () => {
    const decision = decide(corp(), [sector()], [pool()], {
      ...plantsCtx,
      enabled: false,
    });
    expect(queueWrites(decision)).toHaveLength(0);
    expect(decision.reinvestments).toBeUndefined();
  });
});

describe("state-owned enterprises are excluded from cash-rationed reinvestment", () => {
  // Everything in section 6 rations the build against the corp's OWN liquid
  // cash, because a private corp's capex comes out of retained earnings. An
  // SOE's does not — a state enterprise funds capacity from state channels
  // (Gosbank directed credit, or the budgeted treasury capex grant), and its
  // treasury backstop deliberately refuses to pay for build orders. Running one
  // through this path charges it cash the state never gave it and leaves it
  // permanently insolvent: 38 of the 51 insolvent corps in the plants A/B.
  const healthy = () => sector();

  it("a command-economy national enterprise (countryOwnerId, no ownershipState) places no order", () => {
    const soe = corp({ countryOwnerId: "RU", ceoType: "npp" } as Partial<Corporation>);
    const decision = decide(soe, [healthy()], [pool()]);
    expect(queueWrites(decision)).toHaveLength(0);
    expect(decision.reinvestments ?? []).toHaveLength(0);
  });

  it("an explicitly stateOwned corp places no order", () => {
    const soe = corp({ ownershipState: "stateOwned", ceoType: "npp" } as Partial<Corporation>);
    expect(queueWrites(decide(soe, [healthy()], [pool()]))).toHaveLength(0);
  });

  it("an identical PRIVATE NPP corp is unchanged and still reinvests", () => {
    const decision = decide(corp(), [healthy()], [pool()]);
    expect(queueWrites(decision).length).toBeGreaterThan(0);
  });
});
