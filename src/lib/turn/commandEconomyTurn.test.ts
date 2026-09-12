import { describe, it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { processCommandEconomyTurn } from "./commandEconomyTurn";

type BudgetDoc = {
  _id: ObjectId;
  countryId: string;
  economicFactors: {
    gdpGrowth: number;
    wageGrowth: number;
    inflationRate: number;
    tradeGrowth: number;
    lastUpdated: Date;
    monetaryOverhang?: number;
    shortageIndex?: number;
    blackMarketPremium?: number;
    secondEconomyShare?: number;
    internalRepression?: number;
    repressionLegitimacyCost?: number;
    blackMarketPressureBase?: number;
    blackMarketPressureEffective?: number;
    repressionDirective?: { level?: number };
    marketizationLevel?: number;
  };
};

type UpdateOneCall = {
  filter: { _id: ObjectId };
  update: { $set: Record<string, number>; $unset?: Record<string, string> };
};

function makeBudget(
  countryId: string,
  overrides: Partial<BudgetDoc["economicFactors"]> = {}
): BudgetDoc {
  return {
    _id: new ObjectId(),
    countryId,
    economicFactors: {
      gdpGrowth: 4,
      wageGrowth: 10,
      inflationRate: 3,
      tradeGrowth: 2,
      lastUpdated: new Date("1953-01-01T00:00:00Z"),
      ...overrides,
    },
  };
}

/**
 * Minimal fake Db mirroring nppInsolvencyDissolution.test.ts:
 * `collection(name)` switch with findOne / find().toArray() / updateOne.
 */
function makeDb(
  config: {
    commandEconomyEnabled?: boolean;
    commandEconomySecondEconomyTolerance?: number;
    marketSystemMode?: string;
  } | null,
  budgets: BudgetDoc[],
  commodityFlows: Array<{ turn: number; byCountry: Record<string, unknown> }> = []
) {
  const updateOnes: UpdateOneCall[] = [];
  const federalBudget = {
    find: () => ({ toArray: async () => budgets }),
    updateOne: async (
      filter: { _id: ObjectId },
      update: { $set: Record<string, number>; $unset?: Record<string, string> }
    ) => {
      updateOnes.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const db = {
    collection: (name: string) => {
      if (name === "gameConfig") {
        return {
          findOne: async () => config,
        };
      }
      if (name === "federalBudget") {
        return federalBudget;
      }
      if (name === "commodityFlows") {
        return {
          find: () => ({ toArray: async () => commodityFlows }),
        };
      }
      // Per-country commandStance read — null ⇒ fall back to global tolerance.
      if (name === "governmentFormations") {
        return {
          find: () => ({ toArray: async () => [] }),
        };
      }
      // Registered-country gate (getRegisteredCountryIds) — no overrides means
      // every static country is registered and none dissolved.
      if (name === "countryGameStates") {
        return {
          find: () => ({ toArray: async () => [] }),
        };
      }
      // v2 P0 SOE refresh — no SOEs seeded in these fixtures.
      if (name === "corporations" || name === "corporateSectors") {
        return {
          find: () => ({ toArray: async () => [] }),
          updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 }),
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  } as unknown as Db;
  return { db, updateOnes };
}

const TURN = 1;
const YEAR_1953 = 1953;

describe("processCommandEconomyTurn", () => {
  it("flag OFF → countriesUpdated 0 and no updateOne calls", async () => {
    const cn = makeBudget("CN");
    const { db, updateOnes } = makeDb({ commandEconomyEnabled: false }, [cn]);

    const res = await processCommandEconomyTurn(db, TURN, YEAR_1953);

    expect(res).toEqual({ countriesUpdated: 0 });
    expect(updateOnes).toHaveLength(0);
  });

  it("flag OFF when config is missing → no writes", async () => {
    const { db, updateOnes } = makeDb(null, [makeBudget("CN")]);
    const res = await processCommandEconomyTurn(db, TURN, YEAR_1953);
    expect(res).toEqual({ countriesUpdated: 0 });
    expect(updateOnes).toHaveLength(0);
  });

  it("flag ON + CN budget in 1953 → writes overhang/shortage/premium/second-economy fields", async () => {
    const cn = makeBudget("CN", {
      monetaryOverhang: 5,
      shortageIndex: 10,
      blackMarketPremium: 0.1,
      secondEconomyShare: 0.05,
    });
    const { db, updateOnes } = makeDb({ commandEconomyEnabled: true }, [cn]);

    const res = await processCommandEconomyTurn(db, TURN, YEAR_1953);

    expect(res.countriesUpdated).toBeGreaterThanOrEqual(1);
    expect(updateOnes.length).toBeGreaterThanOrEqual(1);

    const cnUpdate = updateOnes.find((u) => u.filter._id.equals(cn._id));
    expect(cnUpdate).toBeDefined();
    const set = cnUpdate!.update.$set;
    expect(set).toHaveProperty("economicFactors.monetaryOverhang");
    expect(set).toHaveProperty("economicFactors.shortageIndex");
    expect(set).toHaveProperty("economicFactors.blackMarketPremium");
    expect(set).toHaveProperty("economicFactors.secondEconomyShare");

    for (const key of [
      "economicFactors.monetaryOverhang",
      "economicFactors.shortageIndex",
      "economicFactors.blackMarketPremium",
      "economicFactors.secondEconomyShare",
    ] as const) {
      expect(Number.isFinite(set[key])).toBe(true);
    }
    expect(cnUpdate!.update.$unset).toEqual({
      "economicFactors.physicalDemandSupplyGapPct": "",
    });
  });

  it("flag ON + US (market) budget → US is skipped", async () => {
    const us = makeBudget("US");
    const cn = makeBudget("CN");
    const { db, updateOnes } = makeDb({ commandEconomyEnabled: true }, [us, cn]);

    const res = await processCommandEconomyTurn(db, TURN, YEAR_1953);

    expect(res.countriesUpdated).toBeGreaterThanOrEqual(1);
    const usUpdate = updateOnes.find((u) => u.filter._id.equals(us._id));
    const cnUpdate = updateOnes.find((u) => u.filter._id.equals(cn._id));
    expect(usUpdate).toBeUndefined();
    expect(cnUpdate).toBeDefined();
  });

  it("uses the prior country-scoped physical gap and does not pool countries", async () => {
    const cn = makeBudget("CN");
    const ru = makeBudget("RU");
    const flows = [
      {
        turn: TURN,
        byCountry: {
          CN: {
            basis: "country_scoped_ledger",
            supply: 100,
            demand: 200,
            price: 1,
          },
          RU: {
            basis: "country_scoped_ledger",
            supply: 100,
            demand: 100,
            price: 1,
          },
        },
      },
    ];
    const { db, updateOnes } = makeDb(
      { commandEconomyEnabled: true, marketSystemMode: "ledger" },
      [cn, ru],
      flows
    );

    await processCommandEconomyTurn(db, TURN + 1, YEAR_1953);

    const cnGap = updateOnes.find((u) => u.filter._id.equals(cn._id))!.update.$set[
      "economicFactors.physicalDemandSupplyGapPct"
    ];
    const ruGap = updateOnes.find((u) => u.filter._id.equals(ru._id))!.update.$set[
      "economicFactors.physicalDemandSupplyGapPct"
    ];
    expect(cnGap).toBeGreaterThan(0);
    expect(ruGap).toBe(0);
  });

  it("a stored planned level survives the compiled schedule (post-reunification DE)", async () => {
    // DE is absent from MARKETIZATION_SCHEDULE (always market by seed), but a
    // reunification carried the GDR's regime onto it: the persisted level must
    // win over the schedule, or the carried command economy silently stops
    // being simulated on the first restart.
    const de = makeBudget("DE", { marketizationLevel: 0 });
    const { db, updateOnes } = makeDb({ commandEconomyEnabled: true }, [de]);

    const res = await processCommandEconomyTurn(db, TURN, YEAR_1953);

    expect(res.countriesUpdated).toBeGreaterThanOrEqual(1);
    const deUpdate = updateOnes.find((u) => u.filter._id.equals(de._id));
    expect(deUpdate).toBeDefined();
    expect(deUpdate!.update.$set).toHaveProperty("economicFactors.marketizationLevel");
  });

  it("a stored MARKET level does not drag a market country into the planned loop", async () => {
    // Symmetric guard: persisting a high level (e.g. a healed field) must not
    // start simulating a market country as planned.
    const us = makeBudget("US", { marketizationLevel: 95 });
    const { db, updateOnes } = makeDb({ commandEconomyEnabled: true }, [us]);

    await processCommandEconomyTurn(db, TURN, YEAR_1953);

    expect(updateOnes.find((u) => u.filter._id.equals(us._id))).toBeUndefined();
  });

  it("flag ON → persists an endogenous marketizationLevel", async () => {
    const cn = makeBudget("CN");
    const { db, updateOnes } = makeDb({ commandEconomyEnabled: true }, [cn]);
    await processCommandEconomyTurn(db, TURN, YEAR_1953);
    const set = updateOnes.find((u) => u.filter._id.equals(cn._id))!.update.$set;
    expect(set).toHaveProperty("economicFactors.marketizationLevel");
    expect(Number.isFinite(set["economicFactors.marketizationLevel"])).toBe(true);
  });

  // ── Internal repression (v2 hardliner lever) ───────────────────────────────
  const shortageSeed = {
    monetaryOverhang: 60,
    shortageIndex: 50,
    blackMarketPremium: 1.2,
    secondEconomyShare: 0.3,
    wageGrowth: 12,
    gdpGrowth: 2,
  };

  function runWithRepression(level: number) {
    const cn = makeBudget("CN", { ...shortageSeed, repressionDirective: { level } });
    const { db, updateOnes } = makeDb({ commandEconomyEnabled: true }, [cn]);
    return { cn, db, updateOnes };
  }

  it("repression lowers the EFFECTIVE black-market pressure below the base", async () => {
    const { cn, db, updateOnes } = runWithRepression(0.9);
    await processCommandEconomyTurn(db, TURN, YEAR_1953);
    const set = updateOnes.find((u) => u.filter._id.equals(cn._id))!.update.$set;
    expect(set["economicFactors.internalRepression"]).toBe(0.9);
    const base = set["economicFactors.blackMarketPressureBase"];
    const effective = set["economicFactors.blackMarketPressureEffective"];
    expect(Number.isFinite(base)).toBe(true);
    expect(effective).toBeLessThan(base);
    // Repression incurs a legitimacy cost (negative) since shortage is present.
    expect(set["economicFactors.repressionLegitimacyCost"]).toBeLessThan(0);
  });

  it("repression does NOT change the persisted overhang or shortage (only the expression)", async () => {
    const none = runWithRepression(0);
    const heavy = runWithRepression(1);
    await processCommandEconomyTurn(none.db, TURN, YEAR_1953);
    await processCommandEconomyTurn(heavy.db, TURN, YEAR_1953);
    const setNone = none.updateOnes.find((u) => u.filter._id.equals(none.cn._id))!.update.$set;
    const setHeavy = heavy.updateOnes.find((u) => u.filter._id.equals(heavy.cn._id))!.update.$set;
    // Overhang + shortage are byte-identical regardless of repression (the cause).
    expect(setHeavy["economicFactors.monetaryOverhang"]).toBe(
      setNone["economicFactors.monetaryOverhang"]
    );
    expect(setHeavy["economicFactors.shortageIndex"]).toBe(
      setNone["economicFactors.shortageIndex"]
    );
    expect(setHeavy["economicFactors.secondEconomyShare"]).toBe(
      setNone["economicFactors.secondEconomyShare"]
    );
    // But the effective pressure fed to the drift IS lower under heavy repression.
    expect(setHeavy["economicFactors.blackMarketPressureEffective"]).toBeLessThan(
      setNone["economicFactors.blackMarketPressureEffective"]
    );
    // ...which yields a lower (more entrenching) next marketization level.
    expect(setHeavy["economicFactors.marketizationLevel"]).toBeLessThan(
      setNone["economicFactors.marketizationLevel"]
    );
  });
});

// ── SOE refresh + endogenous drift direction (v2 P0) ─────────────────────────

type SoeCorp = {
  _id: ObjectId;
  countryId: string;
  soe: { sector: string; capacity: number; output: number; planTarget: number };
};
type SoeSector = { corporationId: ObjectId; revenue: number; realizedRevenue: number };

function makeSoeDb(
  budgets: BudgetDoc[],
  corps: SoeCorp[],
  sectors: SoeSector[]
): { db: Db; budgetSets: Record<string, number>[] } {
  const budgetSets: Record<string, number>[] = [];
  const db = {
    collection: (name: string) => {
      if (name === "gameConfig") return { findOne: async () => ({ commandEconomyEnabled: true }) };
      if (name === "governmentFormations") return { find: () => ({ toArray: async () => [] }) };
      if (name === "federalBudget")
        return {
          find: () => ({ toArray: async () => budgets }),
          updateOne: async (_f: unknown, u: { $set: Record<string, number> }) => {
            budgetSets.push(u.$set);
            return { matchedCount: 1 };
          },
        };
      if (name === "corporations")
        return {
          find: () => ({ toArray: async () => corps }),
          updateOne: async () => ({ matchedCount: 1 }),
          bulkWrite: async () => ({ ok: 1 }),
        };
      if (name === "corporateSectors")
        return { find: () => ({ toArray: async () => sectors }), updateOne: async () => ({}) };
      // Registered-country gate — nothing dissolved in these fixtures.
      if (name === "countryGameStates") return { find: () => ({ toArray: async () => [] }) };
      throw new Error(`unexpected collection: ${name}`);
    },
  } as unknown as Db;
  return { db, budgetSets };
}

describe("SOE performance drives marketization direction", () => {
  const YEAR_1979 = 1979; // RU command era, schedule level 10

  function runWith(realizedFraction: number) {
    const ru = makeBudget("RU");
    const corpId = new ObjectId();
    const corp: SoeCorp = {
      _id: corpId,
      countryId: "RU",
      soe: { sector: "energy", capacity: 1_100, output: 1_000, planTarget: 1_000 },
    };
    const sector: SoeSector = {
      corporationId: corpId,
      revenue: 1_000,
      realizedRevenue: Math.round(1_000 * realizedFraction),
    };
    return makeSoeDb([ru], [corp], [sector]);
  }

  it("a STARVED SOE (low realized output) pushes marketization above the seed", async () => {
    const { db, budgetSets } = runWith(0.4); // plan fulfillment 0.4
    await processCommandEconomyTurn(db, 1, YEAR_1979);
    const level = budgetSets[0]["economicFactors.marketizationLevel"];
    expect(level).toBeGreaterThan(10); // drifted UP toward market from seed=10
  });

  it("a HEALTHY on-plan SOE holds/entrenches (does not rise above the seed)", async () => {
    const { db, budgetSets } = runWith(1.0); // plan fulfillment 1.0
    await processCommandEconomyTurn(db, 1, YEAR_1979);
    const level = budgetSets[0]["economicFactors.marketizationLevel"];
    expect(level).toBeLessThanOrEqual(10); // holds at / below the command seed
  });
});

// ── P1: active Gosbank — directed credit + softness persisted on the country ──

describe("active Gosbank writes directed-credit + softness to the country", () => {
  it("allocates credit to the SOE sector and persists the softness dial + issuance", async () => {
    const ru = makeBudget("RU");
    const corpId = new ObjectId();
    const corp: SoeCorp = {
      _id: corpId,
      countryId: "RU",
      soe: { sector: "energy", capacity: 1_100, output: 1_000, planTarget: 1_000 },
    };
    const sector: SoeSector = { corporationId: corpId, revenue: 1_000, realizedRevenue: 1_000 };
    const { db, budgetSets } = makeSoeDb([ru], [corp], [sector]);

    await processCommandEconomyTurn(db, 1, 1979);

    const set = budgetSets[0] as Record<string, unknown>;
    // Budget-softness dial persisted for nppInsolvencyDissolution to read.
    expect(typeof set["economicFactors.budgetSoftness"]).toBe("number");
    // Directed-credit readout carries the funded sector with a positive amount.
    const directed = set["economicFactors.directedCredit"] as Record<string, number>;
    expect(directed.energy).toBeGreaterThan(0);
    // Monetized issuance (the money-printing slice) is recorded and non-negative.
    expect(set["economicFactors.directedCreditIssuance"] as number).toBeGreaterThanOrEqual(0);
  });
});

// ── P3: LIVE government reformism (elected ruling party moves marketization) ──

type CommandStanceDoc = {
  secondEconomyTolerance?: number;
  creditAggressiveness?: number;
  budgetSoftness?: number;
  reformism?: number;
  internalRepression?: number;
};
type GovForm = {
  _id: string;
  governingPartyId?: string | null;
  commandStance?: CommandStanceDoc;
};
type PartyDoc = { countryId: string; sequentialId: number; economicPosition: number };

function makeGovDb(
  budgets: BudgetDoc[],
  corps: SoeCorp[],
  sectors: SoeSector[],
  formations: GovForm[],
  parties: PartyDoc[]
): { db: Db; budgetSets: Record<string, number>[] } {
  const budgetSets: Record<string, number>[] = [];
  const db = {
    collection: (name: string) => {
      if (name === "gameConfig") return { findOne: async () => ({ commandEconomyEnabled: true }) };
      if (name === "governmentFormations")
        return { find: () => ({ toArray: async () => formations }) };
      if (name === "politicalParties") return { find: () => ({ toArray: async () => parties }) };
      if (name === "federalBudget")
        return {
          find: () => ({ toArray: async () => budgets }),
          updateOne: async (_f: unknown, u: { $set: Record<string, number> }) => {
            budgetSets.push(u.$set);
            return { matchedCount: 1 };
          },
        };
      if (name === "corporations")
        return {
          find: () => ({ toArray: async () => corps }),
          updateOne: async () => ({ matchedCount: 1 }),
          bulkWrite: async () => ({ ok: 1 }),
        };
      if (name === "corporateSectors")
        return { find: () => ({ toArray: async () => sectors }), updateOne: async () => ({}) };
      // Registered-country gate — nothing dissolved in these fixtures.
      if (name === "countryGameStates") return { find: () => ({ toArray: async () => [] }) };
      throw new Error(`unexpected collection: ${name}`);
    },
  } as unknown as Db;
  return { db, budgetSets };
}

describe("live government reformism (P3) drives the marketization policy stance", () => {
  const YEAR_1979 = 1979; // RU command era, schedule seed 10

  function runWithRulingParty(economicPosition: number) {
    const ru = makeBudget("RU");
    const corpId = new ObjectId();
    // On-plan SOE so the SOE channel is neutral and the POLICY channel dominates.
    const corp: SoeCorp = {
      _id: corpId,
      countryId: "RU",
      soe: { sector: "energy", capacity: 1_100, output: 1_000, planTarget: 1_000 },
    };
    const sector: SoeSector = { corporationId: corpId, revenue: 1_000, realizedRevenue: 1_000 };
    const formations: GovForm[] = [{ _id: "RU", governingPartyId: "1" }];
    const parties: PartyDoc[] = [{ countryId: "RU", sequentialId: 1, economicPosition }];
    return makeGovDb([ru], [corp], [sector], formations, parties);
  }

  it("a market-right ruling party persists reformism +1 and pushes marketization UP", async () => {
    const { db, budgetSets } = runWithRulingParty(5); // fully market-right
    await processCommandEconomyTurn(db, 1, YEAR_1979);
    const set = budgetSets[0];
    expect(set["economicFactors.governmentReformism"]).toBe(1);
    expect(set["economicFactors.marketizationLevel"]).toBeGreaterThan(10);
  });

  it("an orthodox command-left ruling party persists reformism −1 and entrenches (level ≤ seed)", async () => {
    const { db, budgetSets } = runWithRulingParty(-5); // fully command-left
    await processCommandEconomyTurn(db, 1, YEAR_1979);
    const set = budgetSets[0];
    expect(set["economicFactors.governmentReformism"]).toBe(-1);
    expect(set["economicFactors.marketizationLevel"]).toBeLessThanOrEqual(10);
  });

  it("a reformist government reforms FASTER than an orthodox one, all else equal", async () => {
    const reformist = runWithRulingParty(5);
    const orthodox = runWithRulingParty(-5);
    await processCommandEconomyTurn(reformist.db, 1, YEAR_1979);
    await processCommandEconomyTurn(orthodox.db, 1, YEAR_1979);
    expect(reformist.budgetSets[0]["economicFactors.marketizationLevel"]).toBeGreaterThan(
      orthodox.budgetSets[0]["economicFactors.marketizationLevel"]
    );
  });

  it("no governing party resolvable → reformism falls back to the neutral NPP default (0)", async () => {
    const ru = makeBudget("RU");
    const corpId = new ObjectId();
    const corp: SoeCorp = {
      _id: corpId,
      countryId: "RU",
      soe: { sector: "energy", capacity: 1_100, output: 1_000, planTarget: 1_000 },
    };
    const sector: SoeSector = { corporationId: corpId, revenue: 1_000, realizedRevenue: 1_000 };
    // Formation with no governingPartyId, and no matching party doc.
    const { db, budgetSets } = makeGovDb([ru], [corp], [sector], [{ _id: "RU" }], []);
    await processCommandEconomyTurn(db, 1, YEAR_1979);
    expect(budgetSets[0]["economicFactors.governmentReformism"]).toBe(0);
  });
});

// ── The dial has a LIVE input: the sitting government moves it BOTH ways ──────
//
// Regression cover for the "no input" bug. `politicalParties.economicPosition`
// is written only by the player-only committee `positionShift` path, so in an
// NPP-run one-party state it is a CONSTANT for the whole game. While it took
// absolute precedence over the sitting government's live command stance, the
// policy channel was frozen: with a chartered line at −5 the gov term
// contributed −0.6, which the ±0.4 Gosbank channel can never outweigh, so every
// bloc country ratcheted monotonically to the 0 floor no matter how it was
// played. These fixtures hold the party line FROZEN at −5 and vary only the
// live cabinet stance.

describe("a frozen one-party charter no longer pins the dial", () => {
  const YEAR_1979 = 1979; // RU command era, schedule seed 10
  /** Neutral Gosbank (both dials centred) so ONLY reformism varies. */
  const neutralGosbank = { creditAggressiveness: 0.5, budgetSoftness: 0.5 };

  function runWithCabinet(cabinetReformism: number) {
    const ru = makeBudget("RU");
    const corpId = new ObjectId();
    // On-plan SOE so the SOE channel is neutral and the POLICY channel dominates.
    const corp: SoeCorp = {
      _id: corpId,
      countryId: "RU",
      soe: { sector: "energy", capacity: 1_100, output: 1_000, planTarget: 1_000 },
    };
    const sector: SoeSector = { corporationId: corpId, revenue: 1_000, realizedRevenue: 1_000 };
    const formations: GovForm[] = [
      {
        _id: "RU",
        governingPartyId: "1",
        commandStance: { ...neutralGosbank, reformism: cabinetReformism },
      },
    ];
    // FROZEN orthodox charter — the value that never moves in an NPP world.
    const parties: PartyDoc[] = [{ countryId: "RU", sequentialId: 1, economicPosition: -5 }];
    return makeGovDb([ru], [corp], [sector], formations, parties);
  }

  it("a REFORMIST cabinet lifts the dial ABOVE the seed despite the −5 charter", async () => {
    const { db, budgetSets } = runWithCabinet(1);
    await processCommandEconomyTurn(db, 1, YEAR_1979);
    const set = budgetSets[0];
    // Blend of the frozen −1 charter and a +1 cabinet → neutral, not hardline.
    expect(set["economicFactors.governmentReformism"]).toBeCloseTo(0, 6);
    expect(set["economicFactors.marketizationLevel"]).toBeGreaterThan(10);
  });

  it("a HARDLINE cabinet entrenches BELOW the seed under the same charter", async () => {
    const { db, budgetSets } = runWithCabinet(-1);
    await processCommandEconomyTurn(db, 1, YEAR_1979);
    const set = budgetSets[0];
    expect(set["economicFactors.governmentReformism"]).toBeCloseTo(-1, 6);
    expect(set["economicFactors.marketizationLevel"]).toBeLessThan(10);
  });

  it("the cabinet stance is MONOTONIC in the dial with the charter held frozen", async () => {
    const hardline = runWithCabinet(-1);
    const neutral = runWithCabinet(0);
    const reformist = runWithCabinet(1);
    await processCommandEconomyTurn(hardline.db, 1, YEAR_1979);
    await processCommandEconomyTurn(neutral.db, 1, YEAR_1979);
    await processCommandEconomyTurn(reformist.db, 1, YEAR_1979);
    const level = (r: { budgetSets: Record<string, number>[] }) =>
      r.budgetSets[0]["economicFactors.marketizationLevel"];
    expect(level(hardline)).toBeLessThan(level(neutral));
    expect(level(neutral)).toBeLessThan(level(reformist));
  });
});

// ── Era gravity: history is the DEFAULT, not a rail ──────────────────────────

describe("era gravity restores the schedule when nobody intervenes", () => {
  const YEAR_1979 = 1979; // RU schedule seed 10

  /**
   * Fully inert fixture: no SOEs (SOE channel neutral, no directed credit), no
   * wage/GDP growth and no seeded overhang (black-market channel zero), and a
   * neutral Gosbank + neutral cabinet (policy channel zero). Whatever the dial
   * does here is gravity alone.
   */
  function runInert(persistedLevel: number) {
    const ru = makeBudget("RU", {
      wageGrowth: 0,
      gdpGrowth: 0,
      monetaryOverhang: 0,
      shortageIndex: 0,
      blackMarketPremium: 0,
      secondEconomyShare: 0,
      marketizationLevel: persistedLevel,
    });
    const formations: GovForm[] = [
      {
        _id: "RU",
        commandStance: { creditAggressiveness: 0.5, budgetSoftness: 0.5, reformism: 0 },
      },
    ];
    return makeGovDb([ru], [], [], formations, []);
  }

  async function nextLevel(persistedLevel: number): Promise<number> {
    const { db, budgetSets } = runInert(persistedLevel);
    await processCommandEconomyTurn(db, 1, YEAR_1979);
    return budgetSets[0]["economicFactors.marketizationLevel"];
  }

  it("a country sunk to the 0 floor climbs back toward its era level", async () => {
    expect(await nextLevel(0)).toBeGreaterThan(0);
  });

  it("a country that ran ahead of its era is pulled back down", async () => {
    expect(await nextLevel(30)).toBeLessThan(30);
  });

  it("a country sitting AT its era level does not move (no rail, no jitter)", async () => {
    expect(await nextLevel(10)).toBeCloseTo(10, 10);
  });

  it("gravity is weak: a determined reformist government beats it", async () => {
    // Same starting point as the pull-back-down case (30, above the seed), but
    // with a starved plan + reformist cabinet the dial rises anyway.
    const ru = makeBudget("RU", { marketizationLevel: 30, wageGrowth: 14, gdpGrowth: 1 });
    const corpId = new ObjectId();
    const corp: SoeCorp = {
      _id: corpId,
      countryId: "RU",
      soe: { sector: "energy", capacity: 1_100, output: 1_000, planTarget: 1_000 },
    };
    const sector: SoeSector = { corporationId: corpId, revenue: 1_000, realizedRevenue: 400 };
    const formations: GovForm[] = [
      {
        _id: "RU",
        commandStance: { creditAggressiveness: 0.1, budgetSoftness: 0.1, reformism: 1 },
      },
    ];
    const { db, budgetSets } = makeGovDb([ru], [corp], [sector], formations, []);
    await processCommandEconomyTurn(db, 1, YEAR_1979);
    expect(budgetSets[0]["economicFactors.marketizationLevel"]).toBeGreaterThan(30);
  });
});
