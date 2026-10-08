import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { VENTURE_DEVELOPMENT_TURNS, referenceFundingPerTurn, ventureTargetAnchor } from "./engine";
import {
  NPP_VENTURE_START_HAZARD,
  isNppDistressed,
  nppLineWeight,
  selectNppVentureStarts,
  startNppVentures,
  type NppVentureSelectionArgs,
} from "./nppStart";

const RESERVE = 50_000;
const REVENUE_PER_DAY = 24_000; // 1,000 per turn at 24 turns per day

function corp(extra: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    ceoType: "npp",
    ceoId: new ObjectId(),
    countryId: "us",
    liquidCapital: 10_000_000,
    ...extra,
  } as unknown as Corporation;
}

function mediaSector(corporationId: ObjectId, extra: Partial<CorporateSector> = {}) {
  return {
    _id: new ObjectId(),
    corporationId,
    sectorType: "media",
    strategyId: "newspaper",
    countryId: "us",
    realizedRevenue: REVENUE_PER_DAY,
    revenue: REVENUE_PER_DAY,
    ...extra,
  } as unknown as CorporateSector;
}

function args(
  corps: Corporation[],
  sectors: Map<string, CorporateSector[]>,
  extra: Partial<NppVentureSelectionArgs> = {}
): NppVentureSelectionArgs {
  return {
    turn: 100,
    corporations: corps,
    sectorsByCorp: sectors,
    exchangeRatesByCurrency: new Map(),
    enabled: { media: true, manufacturing: true },
    reserveAnchor: RESERVE,
    priceRatioOf: () => 1,
    currentYear: 1991,
    hazard: 1,
    ...extra,
  };
}

function world(n: number, cash = 10_000_000, extra: Partial<Corporation> = {}) {
  const corps = Array.from({ length: n }, () => corp({ liquidCapital: cash, ...extra }));
  const sectors = new Map(corps.map((c) => [c._id.toString(), [mediaSector(c._id)]]));
  return { corps, sectors };
}

describe("NPP venture hazard", () => {
  it("is 1/144 so about a third of idle-or-busy companies are developing", () => {
    expect(NPP_VENTURE_START_HAZARD).toBeCloseTo(1 / (2 * VENTURE_DEVELOPMENT_TURNS), 10);
  });
});

describe("selectNppVentureStarts eligibility", () => {
  it("starts a standard media venture for a rich NPP corporation", () => {
    const { corps, sectors } = world(1);
    const [start] = selectNppVentureStarts(args(corps, sectors));
    expect(start.domain).toBe("media");
    expect(start.tier).toBe("standard");
    const target = ventureTargetAnchor(start.baselineRevenueAnchor);
    expect(start.fundingPerTurnAnchor).toBeCloseTo(referenceFundingPerTurn(target), 6);
  });

  it("skips player-run and state-owned corporations", () => {
    const player = corp({ ceoType: "character" });
    const state = corp({ ownershipState: "stateOwned" });
    const sectors = new Map([
      [player._id.toString(), [mediaSector(player._id)]],
      [state._id.toString(), [mediaSector(state._id)]],
    ]);
    expect(selectNppVentureStarts(args([player, state], sectors))).toEqual([]);
  });

  it("keeps the reserve: cash after the full commitment must stay above it", () => {
    const { corps, sectors } = world(1);
    const baseline = 1_000;
    const target = ventureTargetAnchor(baseline);
    corps[0].liquidCapital = RESERVE + target - 1;
    expect(selectNppVentureStarts(args(corps, sectors))).toEqual([]);
    corps[0].liquidCapital = RESERVE + target;
    expect(selectNppVentureStarts(args(corps, sectors))).toHaveLength(1);
  });

  it("goes lean when the cash left after the commitment is thin", () => {
    const { corps, sectors } = world(1);
    const target = ventureTargetAnchor(1_000);
    corps[0].liquidCapital = RESERVE + target + RESERVE / 2;
    const [start] = selectNppVentureStarts(args(corps, sectors));
    expect(start.tier).toBe("lean");
    expect(start.fundingPerTurnAnchor).toBeCloseTo(referenceFundingPerTurn(target) * 0.5, 6);
  });

  it.each([
    ["negative cash", { liquidCapital: -1 }],
    ["financial distress", { financialDistressSinceTurn: 90 }],
    ["insolvency clock", { nppInsolventSinceTurn: 90 }],
    ["operating cash arrears", { operatingCashArrearsByCurrency: { USD: 5 } }],
    ["tax arrears", { federalTaxArrearsAnchorByCountry: { us: 5 } }],
  ])("starts nothing for a corporation in %s", (_label, extra) => {
    const { corps, sectors } = world(1, 10_000_000, extra as Partial<Corporation>);
    expect(isNppDistressed(corps[0])).toBe(true);
    expect(selectNppVentureStarts(args(corps, sectors))).toEqual([]);
  });

  it("respects one active venture per corporation and domain", () => {
    const { corps, sectors } = world(1);
    const busy = new Set([`${corps[0]._id}:media`]);
    expect(selectNppVentureStarts(args(corps, sectors), busy)).toEqual([]);
  });

  it("does nothing when the domain flag is off or there are no sectors", () => {
    const { corps, sectors } = world(1);
    expect(
      selectNppVentureStarts(
        args(corps, sectors, { enabled: { media: false, manufacturing: true } })
      )
    ).toEqual([]);
    expect(selectNppVentureStarts(args(corps, new Map()))).toEqual([]);
  });

  it("is deterministic for a corporation and turn", () => {
    const { corps, sectors } = world(20);
    const a = selectNppVentureStarts(args(corps, sectors, { hazard: 0.3 }));
    const b = selectNppVentureStarts(args(corps, sectors, { hazard: 0.3 }));
    expect(a).toEqual(b);
  });
});

describe("steady-state share", () => {
  it("lands near one in three developing under the derived hazard", () => {
    const N = 300;
    const { corps, sectors } = world(N);
    const remaining = new Map<string, number>(); // corp -> turns left in development
    let developingSum = 0;
    let samples = 0;
    const TURNS = 2_500;
    const WARMUP = 500;
    for (let turn = 1; turn <= TURNS; turn++) {
      for (const [id, left] of remaining) {
        if (left <= 1) remaining.delete(id);
        else remaining.set(id, left - 1);
      }
      const busy = new Set([...remaining.keys()].map((id) => `${id}:media`));
      const starts = selectNppVentureStarts(
        args(corps, sectors, { turn, hazard: undefined }),
        busy
      );
      for (const s of starts) remaining.set(s.corporationId, VENTURE_DEVELOPMENT_TURNS);
      if (turn > WARMUP) {
        developingSum += remaining.size;
        samples += 1;
      }
    }
    const share = developingSum / samples / N;
    expect(share).toBeGreaterThan(0.28);
    expect(share).toBeLessThan(0.38);
  });
});

describe("line weighting", () => {
  it("media is neutral and a short output outweighs a balanced one", () => {
    expect(nppLineWeight("media", "newspaper", "us", () => 3)).toBe(1);
    const short = nppLineWeight("manufacturing", "passenger_car", "us", () => 2);
    const flat = nppLineWeight("manufacturing", "passenger_car", "us", () => 1);
    const glut = nppLineWeight("manufacturing", "passenger_car", "us", () => 0.1);
    expect(short).toBe(4);
    expect(flat).toBe(1);
    expect(glut).toBe(0.25);
  });

  it("favours the undersupplied line when a plant could make several", () => {
    const c = corp();
    const sector = {
      _id: new ObjectId(),
      corporationId: c._id,
      sectorType: "manufacturing",
      industryModel: undefined,
      strategyId: "standard",
      countryId: "us",
      capitalStock: 1_000_000,
      plantCount: 5,
      realizedRevenue: REVENUE_PER_DAY,
      revenue: REVENUE_PER_DAY,
    } as unknown as CorporateSector;
    const vehicleSector = {
      ...sector,
      _id: new ObjectId(),
      industryModel: "vehicles",
    } as unknown as CorporateSector;
    const sectors = new Map([[c._id.toString(), [sector, vehicleSector]]]);
    const vehicleShare = (ratio: number) => {
      let vehicles = 0;
      let total = 0;
      for (let turn = 1; turn <= 600; turn++) {
        const [start] = selectNppVentureStarts(
          args([c], sectors, {
            turn,
            priceRatioOf: (commodity) => (commodity === "vehicles" ? ratio : 1),
          })
        );
        if (!start) continue;
        total += 1;
        if (["passenger_car", "truck", "commercial_vehicle"].includes(start.lineId)) vehicles += 1;
      }
      expect(total).toBeGreaterThan(500);
      return vehicles / total;
    };
    const flat = vehicleShare(1);
    const short = vehicleShare(3);
    expect(short).toBeGreaterThan(flat + 0.1);
  });
});

describe("startNppVentures", () => {
  function fakeDb(busy: Array<{ activeKey: string }> = []) {
    const inserted: Array<Record<string, unknown>> = [];
    let finds = 0;
    const keys = new Set(busy.map((b) => b.activeKey));
    const db = {
      collection: () => ({
        find: () => ({
          toArray: async () => {
            finds += 1;
            return [...keys].map((activeKey) => ({ activeKey }));
          },
        }),
        insertMany: async (docs: Array<Record<string, unknown>>) => {
          for (const doc of docs) {
            if (keys.has(doc.activeKey as string)) {
              throw Object.assign(new Error("dup"), {
                code: 11000,
                writeErrors: [{ code: 11000 }],
              });
            }
            keys.add(doc.activeKey as string);
            inserted.push(doc);
          }
        },
      }),
    };
    return { db: db as never, inserted, finds: () => finds };
  }

  it("makes no query when nobody rolls a start", async () => {
    const { corps, sectors } = world(5);
    const f = fakeDb();
    await startNppVentures(f.db, args(corps, sectors, { hazard: 0 }));
    expect(f.finds()).toBe(0);
    expect(f.inserted).toEqual([]);
  });

  it("uses one query for the whole phase and inserts every start", async () => {
    const { corps, sectors } = world(8);
    const f = fakeDb();
    const starts = await startNppVentures(f.db, args(corps, sectors));
    expect(starts).toHaveLength(8);
    expect(f.finds()).toBe(1);
    expect(f.inserted).toHaveLength(8);
    expect(f.inserted[0]).toMatchObject({ stage: "development", lastProcessedTurn: 100 });
  });

  it("is idempotent: a replay of the same turn adds nothing", async () => {
    const { corps, sectors } = world(4);
    const f = fakeDb();
    await startNppVentures(f.db, args(corps, sectors));
    await startNppVentures(f.db, args(corps, sectors));
    expect(f.inserted).toHaveLength(4);
  });
});
