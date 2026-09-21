/**
 * Dense coverage for the pure NPP product decision module (#2236/#2237/#2238).
 *
 * Every case constructs plain inputs and asserts the recommended action: no
 * database, no clock, no randomness. The replay and neutrality cases pin the
 * conservative policy: V0-V3 and flag-off stay neutral, a second active
 * product is never started, cash below the floor never commits, and
 * retirement needs sustained failure evidence.
 */
import { describe, it, expect } from "vitest";
import type { CorporationType } from "@/lib/constants/corporations";
import type { NppAutonomyLevel } from "@/lib/db/types/gameState";
import { getProductKind } from "@/lib/products/catalog";
import { queryProductCatalog } from "@/lib/products/queries";
import type { CorporationProduct } from "@/lib/products/types";
import {
  decideNppProduct,
  NPP_PRODUCT_RETIRE_FAILING_TURNS,
  type NppProductAction,
  type NppProductDecisionInput,
} from "./nppProductDecision";

const RICH_CASH = {
  cashLocal: 10_000_000,
  cashFloorLocal: 250_000,
  minStartSurplusLocal: 625_000,
};

function base(overrides: Partial<NppProductDecisionInput> = {}): NppProductDecisionInput {
  const corporationType = overrides.corporationType ?? "manufacturing";
  return {
    enabled: true,
    autonomyLevel: "v4",
    corporationId: "corp-1",
    corporationType,
    currentYear: 2027,
    plants: [
      corporationType === "automobiles"
        ? { sectorType: "automobiles", strategyId: "standard", capacity: 100 }
        : { sectorType: "manufacturing", strategyId: "electronics_manufacturing", capacity: 100 },
    ],
    expansionAllowed: true,
    ...RICH_CASH,
    ...overrides,
  };
}

function activeProduct(overrides: Partial<CorporationProduct> = {}): CorporationProduct {
  return {
    id: "prod-1",
    corporationId: "corp-1",
    kindId: "passenger_car",
    name: "Passenger Car",
    stage: "development",
    startedTurn: 100,
    developmentSpendAnchor: 0,
    developmentAdvertisingAnchor: 0,
    developmentAdvertisingTurns: 0,
    ...overrides,
  };
}

/** Every numeric value carried by an action must be finite. */
function expectFiniteNumbers(action: NppProductAction): void {
  const seen: number[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "number") seen.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
  };
  walk(action);
  for (const n of seen) {
    expect(Number.isFinite(n)).toBe(true);
  }
}

describe("decideNppProduct feature flag", () => {
  it("stays neutral when the flag is off, even for a rich V5 corp with no product", () => {
    expect(decideNppProduct(base({ enabled: false, autonomyLevel: "v5" }))).toEqual({
      kind: "none",
      reason: "feature_disabled",
    });
  });

  it("stays neutral when the flag is off, even with an active product", () => {
    expect(decideNppProduct(base({ enabled: false, activeProduct: activeProduct() }))).toEqual({
      kind: "none",
      reason: "feature_disabled",
    });
  });
});

describe("decideNppProduct autonomy tiers", () => {
  it.each(["off", "v0", "v1", "v2", "v3"] as const)(
    "stays neutral at %s",
    (level: NppAutonomyLevel) => {
      expect(decideNppProduct(base({ autonomyLevel: level }))).toEqual({
        kind: "none",
        reason: "below_v4",
      });
    }
  );

  it("stays neutral when the level is absent", () => {
    expect(decideNppProduct(base({ autonomyLevel: undefined }))).toEqual({
      kind: "none",
      reason: "unknown_level",
    });
  });

  it.each(["v4", "v5"] as const)("acts at %s for an eligible industrial corp", (level) => {
    const action = decideNppProduct(base({ autonomyLevel: level }));
    expect(action.kind).toBe("start_product");
  });
});

describe("decideNppProduct one-active-product invariant", () => {
  it.each(["development", "launch", "growth", "mature", "decline"] as const)(
    "never starts a second product while a %s product is active",
    (stage) => {
      const action = decideNppProduct(base({ activeProduct: activeProduct({ stage }) }));
      expect(action).toEqual({ kind: "continue_product", productId: "prod-1" });
    }
  );

  it("never acquires an operating model while a product is active", () => {
    const action = decideNppProduct(
      base({
        corporationType: "media",
        operatingModels: [],
        activeProduct: activeProduct({ kindId: "news_story" }),
      })
    );
    expect(action).toEqual({ kind: "continue_product", productId: "prod-1" });
  });

  it("treats a retired product as a free slot", () => {
    const action = decideNppProduct(base({ activeProduct: activeProduct({ stage: "retired" }) }));
    expect(action.kind).toBe("start_product");
  });
});

describe("decideNppProduct legal selection", () => {
  it("starts the first tech-legal industrial kind for a manufacturing corp", () => {
    const action = decideNppProduct(base({ corporationType: "manufacturing" }));
    expect(action).toEqual({
      kind: "start_product",
      kindId: "consumer_electronics",
      name: "Consumer Electronics",
      maxSpendLocal: Math.floor((10_000_000 - 250_000) * 0.5),
    });
  });

  it("starts an industrial kind for an automobiles corp", () => {
    const action = decideNppProduct(base({ corporationType: "automobiles" }));
    expect(action.kind).toBe("start_product");
    if (action.kind !== "start_product") return;
    const kind = getProductKind(action.kindId);
    expect(kind?.family).toBe("industrial_manufacturing");
  });

  it("keeps industrial recommendations inside the industrial output catalog only", () => {
    for (const corporationType of ["manufacturing", "automobiles"] as const) {
      const action = decideNppProduct(base({ corporationType }));
      expect(action.kind).toBe("start_product");
      if (action.kind !== "start_product") continue;
      const kind = getProductKind(action.kindId);
      expect(kind).toBeDefined();
      expect(kind?.family).toBe("industrial_manufacturing");
      expect(["vehicles", "electronics", "steel", "building_materials"]).toContain(
        kind?.outputCommodity
      );
    }
  });

  it("recommends only kinds the catalog query itself returns", () => {
    const action = decideNppProduct(base({ corporationType: "manufacturing" }));
    expect(action.kind).toBe("start_product");
    if (action.kind !== "start_product") return;
    const legal = queryProductCatalog({ family: "industrial_manufacturing" }).map((k) => k.id);
    expect(legal).toContain(action.kindId);
  });

  it("acquires the first model that unlocks a product for a model-less media corp", () => {
    const action = decideNppProduct(base({ corporationType: "media", operatingModels: [] }));
    expect(action).toEqual({
      kind: "acquire_operating_model",
      operatingModel: "newspaper",
      maxSpendLocal: Math.floor((10_000_000 - 250_000) * 0.5),
    });
  });

  it("starts a model-legal product for a single-model media corp", () => {
    const action = decideNppProduct(
      base({ corporationType: "media", operatingModels: ["newspaper"] })
    );
    expect(action).toEqual({
      kind: "start_product",
      kindId: "news_story",
      name: "News Story",
      maxSpendLocal: Math.floor((10_000_000 - 250_000) * 0.5),
    });
  });

  it("unions legal products across several owned models", () => {
    const action = decideNppProduct(
      base({
        corporationType: "entertainment",
        operatingModels: ["music_label", "publishing_house"],
      })
    );
    expect(action.kind).toBe("start_product");
    if (action.kind !== "start_product") return;
    expect(action.kindId).toBe("book");
  });

  it("ignores unknown operating model names and acquires a real one", () => {
    const action = decideNppProduct(
      base({ corporationType: "media", operatingModels: ["bogus_model"] })
    );
    expect(action.kind).toBe("acquire_operating_model");
  });

  it("passes requirement-free kinds through technology filtering", () => {
    // Requirement-free kinds (news, books) ignore the unlock list: an
    // explicit empty list still yields the same legal product. Kinds with
    // requirements need every required id present.
    const action = decideNppProduct(
      base({
        corporationType: "media",
        operatingModels: ["newspaper"],
        unlockedTechnologyIds: [],
      })
    );
    expect(action.kind).toBe("start_product");
    if (action.kind !== "start_product") return;
    expect(action.kindId).toBe("news_story");
  });

  it("withholds technology-locked kinds from an empty unlock list", () => {
    // A radio-only media corp with no research cannot start its gated kind.
    const action = decideNppProduct(
      base({
        corporationType: "media",
        operatingModels: ["radio_network"],
        unlockedTechnologyIds: [],
      })
    );
    expect(action).toEqual({ kind: "none", reason: "no_legal_product" });
  });

  it("unlocks the model slate once its research lands", () => {
    // News sorts first in catalog order; the gated radio kind becomes legal
    // alongside it (pinned directly in the media rules tests).
    const action = decideNppProduct(
      base({
        corporationType: "media",
        operatingModels: ["radio_network"],
        unlockedTechnologyIds: ["media-1940-1"],
      })
    );
    expect(action.kind).toBe("start_product");
    if (action.kind !== "start_product") return;
    expect(action.kindId).toBe("news_story");
  });

  it("withholds era-locked kinds before their decade", () => {
    const action = decideNppProduct(
      base({
        corporationType: "entertainment",
        operatingModels: ["live_entertainment"],
        unlockedTechnologyIds: ["entertainment-1960-1"],
        currentYear: 1955,
      })
    );
    expect(action).toEqual({ kind: "none", reason: "no_legal_product" });
  });

  it("never acquires a model unfitting the corporation type", () => {
    // An entertainment corp skips newspaper (a media-only model) and takes
    // the publishing house instead.
    const action = decideNppProduct(
      base({ corporationType: "entertainment", operatingModels: [] })
    );
    expect(action).toEqual({
      kind: "acquire_operating_model",
      operatingModel: "publishing_house",
      maxSpendLocal: Math.floor((10_000_000 - 250_000) * 0.5),
    });
  });

  it.each(["financial", "retail", "technology", "energy", "healthcare"] as const)(
    "stays neutral for ineligible corporation type %s",
    (corporationType: CorporationType) => {
      expect(decideNppProduct(base({ corporationType }))).toEqual({
        kind: "none",
        reason: "ineligible_corporation_type",
      });
    }
  );
});

describe("decideNppProduct cash-floor protection", () => {
  it("stays neutral at the floor", () => {
    expect(decideNppProduct(base({ cashLocal: 250_000, cashFloorLocal: 250_000 }))).toEqual({
      kind: "none",
      reason: "below_cash_floor",
    });
  });

  it("stays neutral below the floor", () => {
    expect(decideNppProduct(base({ cashLocal: 100_000, cashFloorLocal: 250_000 }))).toEqual({
      kind: "none",
      reason: "below_cash_floor",
    });
  });

  it("stays neutral when the surplus clears the floor but not the start bar", () => {
    expect(
      decideNppProduct(
        base({ cashLocal: 500_000, cashFloorLocal: 250_000, minStartSurplusLocal: 625_000 })
      )
    ).toEqual({ kind: "none", reason: "insufficient_surplus" });
  });

  it("stays neutral when strategy forbids expansion, even when rich", () => {
    expect(decideNppProduct(base({ expansionAllowed: false }))).toEqual({
      kind: "none",
      reason: "expansion_blocked_by_strategy",
    });
    expect(decideNppProduct(base({ expansionAllowed: undefined }))).toEqual({
      kind: "none",
      reason: "expansion_blocked_by_strategy",
    });
  });

  it.each([
    { cashLocal: NaN, cashFloorLocal: 250_000, minStartSurplusLocal: 625_000 },
    { cashLocal: 10_000_000, cashFloorLocal: NaN, minStartSurplusLocal: 625_000 },
    { cashLocal: 10_000_000, cashFloorLocal: 250_000, minStartSurplusLocal: NaN },
    { cashLocal: Infinity, cashFloorLocal: 250_000, minStartSurplusLocal: 625_000 },
    { cashLocal: 10_000_000, cashFloorLocal: -Infinity, minStartSurplusLocal: 625_000 },
    { cashLocal: undefined, cashFloorLocal: 250_000, minStartSurplusLocal: 625_000 },
  ])("stays neutral on non-finite cash input %o", (cash) => {
    expect(decideNppProduct(base({ ...cash }))).toEqual({
      kind: "none",
      reason: "non_finite_cash",
    });
  });
});

describe("decideNppProduct numeric safety", () => {
  it("emits only finite numbers across hostile numeric inputs", () => {
    const hostile = [NaN, Infinity, -Infinity, -1, 0, Number.MAX_VALUE];
    for (const cashLocal of hostile) {
      for (const cashFloorLocal of hostile) {
        for (const minStartSurplusLocal of hostile) {
          for (const failingTurns of [...hostile, undefined]) {
            const action = decideNppProduct(
              base({
                cashLocal,
                cashFloorLocal,
                minStartSurplusLocal,
                failingTurns,
                activeProduct: activeProduct(),
              })
            );
            expectFiniteNumbers(action);
          }
        }
      }
    }
  });

  it("bounds start spend to half the post-floor surplus", () => {
    const action = decideNppProduct(
      base({ cashLocal: 1_250_000, cashFloorLocal: 250_000, minStartSurplusLocal: 625_000 })
    );
    expect(action.kind).toBe("start_product");
    if (action.kind !== "start_product") return;
    expect(action.maxSpendLocal).toBe(Math.floor(1_000_000 * 0.5));
    expect(action.maxSpendLocal).toBeLessThan(1_250_000 - 250_000);
  });
});

describe("decideNppProduct determinism", () => {
  it("replays identically for identical inputs", () => {
    const input = base({
      corporationType: "media",
      operatingModels: ["radio_network", "newspaper"],
      unlockedTechnologyIds: ["tech-b", "tech-a"],
    });
    expect(decideNppProduct(input)).toEqual(decideNppProduct(input));
    expect(decideNppProduct(structuredClone(input))).toEqual(decideNppProduct(input));
  });

  it("ignores operating-model and technology ordering", () => {
    const left = decideNppProduct(
      base({
        corporationType: "media",
        operatingModels: ["radio_network", "newspaper"],
        unlockedTechnologyIds: ["tech-b", "tech-a"],
      })
    );
    const right = decideNppProduct(
      base({
        corporationType: "media",
        operatingModels: ["newspaper", "radio_network", "newspaper"],
        unlockedTechnologyIds: ["tech-a", "tech-b"],
      })
    );
    expect(left).toEqual(right);
  });
});

describe("decideNppProduct retirement", () => {
  it("continues when failure evidence is missing", () => {
    expect(decideNppProduct(base({ activeProduct: activeProduct() }))).toEqual({
      kind: "continue_product",
      productId: "prod-1",
    });
  });

  it("continues below the sustained-failure threshold", () => {
    expect(
      decideNppProduct(
        base({
          activeProduct: activeProduct(),
          failingTurns: NPP_PRODUCT_RETIRE_FAILING_TURNS - 1,
        })
      )
    ).toEqual({ kind: "continue_product", productId: "prod-1" });
  });

  it("retires only at or above the sustained-failure threshold", () => {
    expect(
      decideNppProduct(
        base({
          activeProduct: activeProduct(),
          failingTurns: NPP_PRODUCT_RETIRE_FAILING_TURNS,
        })
      )
    ).toEqual({
      kind: "retire_product",
      productId: "prod-1",
      failingTurns: NPP_PRODUCT_RETIRE_FAILING_TURNS,
    });
  });

  it("treats non-finite or negative failure evidence as healthy", () => {
    for (const failingTurns of [NaN, Infinity, -Infinity, -3, undefined]) {
      expect(decideNppProduct(base({ activeProduct: activeProduct(), failingTurns }))).toEqual({
        kind: "continue_product",
        productId: "prod-1",
      });
    }
  });

  it("never retires a retired product", () => {
    const action = decideNppProduct(
      base({
        activeProduct: activeProduct({ stage: "retired" }),
        failingTurns: NPP_PRODUCT_RETIRE_FAILING_TURNS * 10,
      })
    );
    expect(action.kind).toBe("start_product");
  });
});
