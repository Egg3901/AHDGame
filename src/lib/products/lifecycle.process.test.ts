import { describe, expect, it } from "vitest";
import { PRODUCT_KINDS } from "./catalog";
import {
  PRODUCT_DECLINE_TURNS,
  PRODUCT_DEMAND_MAX,
  PRODUCT_DEMAND_MIN,
  PRODUCT_DEVELOPMENT_TURNS,
  PRODUCT_GROWTH_TURNS,
  PRODUCT_LAUNCH_TURNS,
  PRODUCT_MATURE_TURNS,
  PRODUCT_POST_LAUNCH_TURNS,
  PRODUCT_PRICE_DEFENSE_MAX,
  PRODUCT_PRICE_DEFENSE_MIN,
  processProductLifecycle,
  type ProcessProductLifecycleArgs,
} from "./lifecycle";
import type { CorporationProduct, ProductLifecycleStage } from "./types";

const STARTED_TURN = 1000;

function makeProduct(
  kindId = "passenger_car",
  overrides: Partial<CorporationProduct> = {}
): CorporationProduct {
  return {
    id: "product-1",
    corporationId: "corp-1",
    kindId,
    name: "Model One",
    stage: "development",
    startedTurn: STARTED_TURN,
    developmentSpendAnchor: 0,
    developmentAdvertisingAnchor: 0,
    developmentAdvertisingTurns: 0,
    ...overrides,
  };
}

function baseArgs(
  product: CorporationProduct,
  turn: number,
  overrides: Partial<ProcessProductLifecycleArgs> = {}
): ProcessProductLifecycleArgs {
  return {
    enabled: true,
    product,
    turn,
    sectorQuality: 60,
    productRnDAnchor: 0,
    deliveredAdvertisingAnchor: 0,
    ...overrides,
  };
}

/** Drive a product through consecutive turns with per-turn input. */
function drive(
  product: CorporationProduct,
  turns: number,
  input: (turn: number) => Partial<ProcessProductLifecycleArgs> = () => ({})
): { product: CorporationProduct; stages: ProductLifecycleStage[] } {
  let current = product;
  const stages: ProductLifecycleStage[] = [];
  for (let t = product.startedTurn; t < product.startedTurn + turns; t += 1) {
    const result = processProductLifecycle(baseArgs(current, t, input(t)));
    current = result.product;
    stages.push(current.stage);
  }
  return { product: current, stages };
}

function launchWith(args: {
  kindId?: string;
  sectorQuality?: number | null;
  rndPerTurn?: number;
  adsPerTurn?: number;
}): CorporationProduct {
  let current = makeProduct(args.kindId ?? "passenger_car");
  for (let t = STARTED_TURN; t <= STARTED_TURN + PRODUCT_DEVELOPMENT_TURNS; t += 1) {
    const result = processProductLifecycle(
      baseArgs(current, t, {
        sectorQuality: args.sectorQuality ?? 60,
        productRnDAnchor: args.rndPerTurn ?? 0,
        deliveredAdvertisingAnchor: args.adsPerTurn ?? 0,
      })
    );
    current = result.product;
  }
  return current;
}

describe("processProductLifecycle flag-off neutrality", () => {
  it("returns identity effects and never advances state while disabled", () => {
    const midLife = launchWith({ rndPerTurn: 500, adsPerTurn: 200 });
    const before = { ...midLife };
    const result = processProductLifecycle(
      baseArgs(midLife, (midLife.launchedTurn ?? STARTED_TURN) + 2, {
        enabled: false,
        sectorQuality: 95,
        productRnDAnchor: 1e9,
        deliveredAdvertisingAnchor: 1e9,
      })
    );
    expect(result.product).toEqual(before);
    expect(result.product.lastProcessedTurn).toBe(before.lastProcessedTurn);
    expect(result.demandMultiplier).toBe(1);
    expect(result.priceDefenseMultiplier).toBe(1);
    expect(result.accounting).toEqual({
      developmentSpendDelta: 0,
      developmentAdvertisingDelta: 0,
      amortizationDelta: 0,
    });
    expect(result.advanced).toBe(false);
  });

  it("does not accumulate development spend or advertising while disabled", () => {
    const product = makeProduct();
    const result = processProductLifecycle(
      baseArgs(product, STARTED_TURN, {
        enabled: false,
        productRnDAnchor: 1000,
        deliveredAdvertisingAnchor: 500,
      })
    );
    expect(result.product).toEqual(product);
  });
});

describe("zero-budget product", () => {
  it("launches at the sector base with zero brand and finite identity-bounded effects", () => {
    const launched = launchWith({ sectorQuality: 60 });
    expect(launched.stage).toBe("launch");
    expect(launched.launchQuality).toBe(60);
    expect(launched.productBrand).toBe(0);
    expect(launched.developmentSpendAnchor).toBe(0);
    expect(launched.developmentAdvertisingTurns).toBe(0);
  });

  it("amortizes nothing when nothing was spent", () => {
    const launched = launchWith({ sectorQuality: 60 });
    const result = processProductLifecycle(
      baseArgs(launched, (launched.launchedTurn ?? STARTED_TURN) + 1)
    );
    expect(result.accounting.amortizationDelta).toBe(0);
  });
});

describe("quality monotonicity", () => {
  it("higher sector quality launches higher and earns stronger post-launch effects", () => {
    const low = launchWith({ sectorQuality: 30, adsPerTurn: 100 });
    const high = launchWith({ sectorQuality: 80, adsPerTurn: 100 });
    expect(high.launchQuality).toBeGreaterThan(low.launchQuality!);

    const lowNext = processProductLifecycle(
      baseArgs(low, (low.launchedTurn ?? STARTED_TURN) + 1, { sectorQuality: 30 })
    );
    const highNext = processProductLifecycle(
      baseArgs(high, (high.launchedTurn ?? STARTED_TURN) + 1, { sectorQuality: 80 })
    );
    expect(highNext.demandMultiplier).toBeGreaterThan(lowNext.demandMultiplier);
    expect(highNext.priceDefenseMultiplier).toBeGreaterThan(lowNext.priceDefenseMultiplier);
  });

  it("product R&D lifts launch quality exactly once, then freezes", () => {
    const plain = launchWith({ sectorQuality: 60 });
    const funded = launchWith({ sectorQuality: 60, rndPerTurn: 5000 });
    expect(funded.launchQuality).toBeGreaterThan(plain.launchQuality!);

    const frozen = funded.launchQuality;
    let current = funded;
    for (let t = (funded.launchedTurn ?? STARTED_TURN) + 1; t < STARTED_TURN + 30; t += 1) {
      const result = processProductLifecycle(
        baseArgs(current, t, { sectorQuality: 95, productRnDAnchor: 1e6 })
      );
      current = result.product;
    }
    expect(current.launchQuality).toBe(frozen);
    expect(current.developmentSpendAnchor).toBe(funded.developmentSpendAnchor);
  });

  it("unlocked technologies are neutral for the current catalog (no required nodes)", () => {
    const without = launchWith({ sectorQuality: 60, rndPerTurn: 1000 });
    let current = makeProduct();
    for (let t = STARTED_TURN; t <= STARTED_TURN + PRODUCT_DEVELOPMENT_TURNS; t += 1) {
      current = processProductLifecycle(
        baseArgs(current, t, {
          sectorQuality: 60,
          productRnDAnchor: 1000,
          unlockedTechnologyIds: ["anything-at-all", "another-id"],
        })
      ).product;
    }
    expect(current.launchQuality).toBe(without.launchQuality);
  });
});

describe("advertising monotonicity", () => {
  it("higher effective advertising averages into higher productBrand and stronger demand", () => {
    const low = launchWith({ sectorQuality: 60, adsPerTurn: 100 });
    const high = launchWith({ sectorQuality: 60, adsPerTurn: 1000 });
    expect(high.productBrand).toBeGreaterThan(low.productBrand!);

    const lowNext = processProductLifecycle(baseArgs(low, (low.launchedTurn ?? STARTED_TURN) + 1));
    const highNext = processProductLifecycle(
      baseArgs(high, (high.launchedTurn ?? STARTED_TURN) + 1)
    );
    expect(highNext.demandMultiplier).toBeGreaterThan(lowNext.demandMultiplier);
  });

  it("zero-advertising turns do not dilute the average", () => {
    let current = makeProduct();
    const ads = [1000, 0, 0, 0, 0, 0, 0];
    ads.forEach((deliveredAdvertisingAnchor, i) => {
      current = processProductLifecycle(
        baseArgs(current, STARTED_TURN + i, { deliveredAdvertisingAnchor })
      ).product;
    });
    expect(current.stage).toBe("launch");
    expect(current.developmentAdvertisingTurns).toBe(1);
    expect(current.productBrand).toBe(1000);
  });
});

describe("bounds", () => {
  it("keeps multipliers inside hard bounds under extreme but finite inputs", () => {
    const launched = launchWith({
      sectorQuality: 100,
      rndPerTurn: 1e12,
      adsPerTurn: 1e12,
    });
    let current = launched;
    for (let t = (launched.launchedTurn ?? STARTED_TURN) + 1; t < STARTED_TURN + 80; t += 1) {
      const result = processProductLifecycle(
        baseArgs(current, t, {
          sectorQuality: 100,
          productRnDAnchor: 1e12,
          deliveredAdvertisingAnchor: 1e12,
        })
      );
      current = result.product;
      for (const m of [result.demandMultiplier, result.priceDefenseMultiplier]) {
        expect(Number.isFinite(m)).toBe(true);
      }
      expect(result.demandMultiplier).toBeGreaterThanOrEqual(PRODUCT_DEMAND_MIN);
      expect(result.demandMultiplier).toBeLessThanOrEqual(PRODUCT_DEMAND_MAX);
      expect(result.priceDefenseMultiplier).toBeGreaterThanOrEqual(PRODUCT_PRICE_DEFENSE_MIN);
      expect(result.priceDefenseMultiplier).toBeLessThanOrEqual(PRODUCT_PRICE_DEFENSE_MAX);
    }
  });

  it("keeps launch quality within 0-100 under extreme inputs", () => {
    const launched = launchWith({ sectorQuality: 100, rndPerTurn: 1e12 });
    expect(launched.launchQuality).toBeLessThanOrEqual(100);
    const worst = launchWith({ sectorQuality: 0 });
    expect(worst.launchQuality).toBeGreaterThanOrEqual(0);
  });
});

describe("deterministic stage transitions", () => {
  it("walks development, launch, growth, mature, decline, retired on exact turn counts", () => {
    const { stages } = drive(makeProduct(), 70);
    const expected: ProductLifecycleStage[] = [
      ...Array<ProductLifecycleStage>(PRODUCT_DEVELOPMENT_TURNS).fill("development"),
      ...Array<ProductLifecycleStage>(PRODUCT_LAUNCH_TURNS).fill("launch"),
      ...Array<ProductLifecycleStage>(PRODUCT_GROWTH_TURNS).fill("growth"),
      ...Array<ProductLifecycleStage>(PRODUCT_MATURE_TURNS).fill("mature"),
      ...Array<ProductLifecycleStage>(PRODUCT_DECLINE_TURNS).fill("decline"),
    ];
    expect(stages.slice(0, expected.length)).toEqual(expected);
    expect(stages[expected.length]).toBe("retired");
    expect(stages.slice(expected.length + 1).every((s) => s === "retired")).toBe(true);
  });

  it("advances one processing per turn and stamps lastProcessedTurn", () => {
    let current = makeProduct();
    const first = processProductLifecycle(baseArgs(current, STARTED_TURN));
    expect(first.advanced).toBe(true);
    expect(first.product.lastProcessedTurn).toBe(STARTED_TURN);
    current = first.product;
    const second = processProductLifecycle(baseArgs(current, STARTED_TURN + 1));
    expect(second.advanced).toBe(true);
    expect(second.product.lastProcessedTurn).toBe(STARTED_TURN + 1);
  });
});

describe("same-turn replay idempotency", () => {
  it("replaying a development turn changes nothing and banks nothing twice", () => {
    const product = makeProduct();
    const first = processProductLifecycle(
      baseArgs(product, STARTED_TURN, { productRnDAnchor: 500, deliveredAdvertisingAnchor: 200 })
    );
    const replay = processProductLifecycle(
      baseArgs(first.product, STARTED_TURN, {
        productRnDAnchor: 500,
        deliveredAdvertisingAnchor: 200,
      })
    );
    expect(replay.replayed).toBe(true);
    expect(replay.advanced).toBe(false);
    expect(replay.product).toEqual(first.product);
    expect(replay.accounting).toEqual({
      developmentSpendDelta: 0,
      developmentAdvertisingDelta: 0,
      amortizationDelta: 0,
    });
    expect(replay.demandMultiplier).toBe(first.demandMultiplier);
    expect(replay.priceDefenseMultiplier).toBe(first.priceDefenseMultiplier);
  });

  it("replaying a post-launch turn returns identical effects with zero deltas", () => {
    const launched = launchWith({ rndPerTurn: 500, adsPerTurn: 200 });
    const turn = (launched.launchedTurn ?? STARTED_TURN) + 3;
    const first = processProductLifecycle(baseArgs(launched, turn));
    const replay = processProductLifecycle(baseArgs(first.product, turn));
    expect(replay.replayed).toBe(true);
    expect(replay.product).toEqual(first.product);
    expect(replay.demandMultiplier).toBe(first.demandMultiplier);
    expect(replay.priceDefenseMultiplier).toBe(first.priceDefenseMultiplier);
    expect(replay.accounting.amortizationDelta).toBe(0);
  });

  it("treats stale turns as replays", () => {
    const launched = launchWith({});
    const turn = (launched.launchedTurn ?? STARTED_TURN) + 5;
    const advanced = processProductLifecycle(baseArgs(launched, turn));
    const stale = processProductLifecycle(baseArgs(advanced.product, turn - 2));
    expect(stale.replayed).toBe(true);
    expect(stale.product).toEqual(advanced.product);
  });

  it("does not mutate its input", () => {
    const product = makeProduct();
    const snapshot = { ...product };
    processProductLifecycle(
      baseArgs(product, STARTED_TURN, { productRnDAnchor: 500, deliveredAdvertisingAnchor: 200 })
    );
    expect(product).toEqual(snapshot);
  });
});

describe("multi-era and product-kind matrix", () => {
  const eraStarts = [0, 500, 2000];

  it.each(PRODUCT_KINDS.map((kind) => kind.id))(
    "runs a full bounded life for kind %s across eras",
    (kindId) => {
      for (const startedTurn of eraStarts) {
        const { product, stages } = drive(makeProduct(kindId, { startedTurn }), 70, (t) => ({
          sectorQuality: 40 + ((t + startedTurn) % 40),
          productRnDAnchor: 250,
          deliveredAdvertisingAnchor: 120,
        }));
        expect(product.stage).toBe("retired");
        expect(product.lastProcessedTurn).toBe(product.retiredTurn);
        expect(Number.isFinite(product.launchQuality)).toBe(true);
        expect(Number.isFinite(product.productBrand)).toBe(true);

        let current = makeProduct(kindId, { startedTurn });
        for (let t = startedTurn; t < startedTurn + 70; t += 1) {
          const result = processProductLifecycle(
            baseArgs(current, t, { sectorQuality: 60, productRnDAnchor: 250 })
          );
          current = result.product;
          expect(Number.isFinite(result.demandMultiplier)).toBe(true);
          expect(Number.isFinite(result.priceDefenseMultiplier)).toBe(true);
          expect(result.demandMultiplier).toBeGreaterThanOrEqual(PRODUCT_DEMAND_MIN);
          expect(result.demandMultiplier).toBeLessThanOrEqual(PRODUCT_DEMAND_MAX);
        }
        expect(stages[stages.length - 1]).toBe("retired");
      }
    }
  );

  it("conserves industrial outputs: no new commodities enter through the lifecycle", () => {
    const allowed = new Set(["vehicles", "electronics", "steel", "building_materials"]);
    for (const kind of PRODUCT_KINDS.filter((k) => k.family === "industrial_manufacturing")) {
      const launched = launchWith({ kindId: kind.id });
      const result = processProductLifecycle(
        baseArgs(launched, (launched.launchedTurn ?? STARTED_TURN) + 1)
      );
      expect(result.outputCommodity).toBe(kind.outputCommodity);
      expect(allowed.has(result.outputCommodity!)).toBe(true);
    }
  });

  it("keeps media outputs on their catalog commodities", () => {
    for (const kind of PRODUCT_KINDS.filter((k) => k.family === "media_entertainment")) {
      const launched = launchWith({ kindId: kind.id });
      const result = processProductLifecycle(
        baseArgs(launched, (launched.launchedTurn ?? STARTED_TURN) + 1)
      );
      expect(result.outputCommodity).toBe(kind.outputCommodity);
    }
  });
});

describe("nasty inputs", () => {
  it("never emits NaN or Infinity", () => {
    const nasties: Array<Partial<ProcessProductLifecycleArgs>> = [
      { sectorQuality: Number.NaN, productRnDAnchor: Number.NaN, deliveredAdvertisingAnchor: NaN },
      {
        sectorQuality: Number.POSITIVE_INFINITY,
        productRnDAnchor: Infinity,
        deliveredAdvertisingAnchor: Infinity,
      },
      {
        sectorQuality: -1e308,
        productRnDAnchor: -500,
        deliveredAdvertisingAnchor: -500,
      },
      { sectorQuality: null, productRnDAnchor: 1e308, deliveredAdvertisingAnchor: 1e308 },
    ];
    for (const nasty of nasties) {
      let current = makeProduct();
      for (let t = STARTED_TURN; t < STARTED_TURN + 70; t += 1) {
        const result = processProductLifecycle(baseArgs(current, t, nasty));
        current = result.product;
        for (const value of [
          result.demandMultiplier,
          result.priceDefenseMultiplier,
          result.accounting.developmentSpendDelta,
          result.accounting.developmentAdvertisingDelta,
          result.accounting.amortizationDelta,
          current.developmentSpendAnchor,
          current.developmentAdvertisingAnchor,
          current.productBrand ?? 0,
          current.launchQuality ?? 0,
        ]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(result.demandMultiplier).toBeGreaterThanOrEqual(PRODUCT_DEMAND_MIN);
        expect(result.demandMultiplier).toBeLessThanOrEqual(PRODUCT_DEMAND_MAX);
      }
    }
  });

  it("ignores a non-finite turn without advancing state", () => {
    const product = makeProduct();
    const result = processProductLifecycle(baseArgs(product, Number.NaN));
    expect(result.advanced).toBe(false);
    expect(result.product).toEqual(product);
    expect(result.demandMultiplier).toBe(1);
  });

  it("returns null commodity and identity effects for unknown kinds", () => {
    const product = makeProduct("bus");
    const result = processProductLifecycle(baseArgs(product, STARTED_TURN));
    expect(result.outputCommodity).toBeNull();
    expect(result.demandMultiplier).toBe(1);
    expect(result.advanced).toBe(false);
    expect(result.product).toEqual(product);
  });
});

describe("retirement", () => {
  it("applies no product effect once retired, even with aggressive inputs", () => {
    const { product: retired } = drive(makeProduct(), 70);
    expect(retired.stage).toBe("retired");
    const result = processProductLifecycle(
      baseArgs(retired, (retired.retiredTurn ?? STARTED_TURN) + 10, {
        sectorQuality: 100,
        productRnDAnchor: 1e9,
        deliveredAdvertisingAnchor: 1e9,
      })
    );
    expect(result.demandMultiplier).toBe(1);
    expect(result.priceDefenseMultiplier).toBe(1);
    expect(result.accounting).toEqual({
      developmentSpendDelta: 0,
      developmentAdvertisingDelta: 0,
      amortizationDelta: 0,
    });
    expect(result.advanced).toBe(false);
    expect(result.product).toEqual(retired);
  });

  it("amortization over the full post-launch life returns the capitalized spend", () => {
    let total = 0;
    let current = makeProduct();
    for (let t = STARTED_TURN; t < STARTED_TURN + 70; t += 1) {
      const result = processProductLifecycle(
        baseArgs(current, t, { sectorQuality: 60, productRnDAnchor: 520 })
      );
      current = result.product;
      total += result.accounting.amortizationDelta;
    }
    expect(current.stage).toBe("retired");
    expect(total).toBeCloseTo(current.developmentSpendAnchor, 6);
    expect(PRODUCT_POST_LAUNCH_TURNS).toBe(
      PRODUCT_LAUNCH_TURNS + PRODUCT_GROWTH_TURNS + PRODUCT_MATURE_TURNS + PRODUCT_DECLINE_TURNS
    );
  });
});
