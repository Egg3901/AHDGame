import { describe, it, expect } from "vitest";
import {
  isCommandEconomy,
  isDualTrackEconomy,
  isPlannedEconomy,
  marketizationLevel,
  plannedShare,
  COMMAND_ECONOMY_REGIMES,
  COMMAND_CEILING,
  DUAL_TRACK_CEILING,
  computePolicyStance,
  isSoeSpared,
  NPP_DEFAULT_BUDGET_SOFTNESS,
  NPP_DEFAULT_INTERNAL_REPRESSION,
  internalRepressionFromReformism,
  BUDGET_SOFTNESS_FOLD_THRESHOLD,
  governmentReformismFromEconomicPosition,
  marketizationDrift,
  MARKETIZATION_DRIFT_WEIGHTS,
  blendGovernmentReformism,
  REFORMISM_PARTY_WEIGHT,
  REFORMISM_CABINET_WEIGHT,
  marketizationGravity,
  MARKETIZATION_GRAVITY_RATE,
  MARKETIZATION_GRAVITY_MAX_STEP,
  commandEconomySoeSectors,
} from "./commandEconomy";

describe("isCommandEconomy", () => {
  it("is OFF by default — flag falsey always returns false", () => {
    expect(isCommandEconomy("RU", 1960, false)).toBe(false);
    expect(isCommandEconomy("RU", 1960, undefined)).toBe(false);
    expect(isCommandEconomy("RU", 1960, null)).toBe(false);
    expect(isCommandEconomy("CN", 1953, false)).toBe(false);
  });

  it("recognises command-era cores when enabled", () => {
    expect(isCommandEconomy("RU", 1960, true)).toBe(true); // Soviet ruble era
    expect(isCommandEconomy("RU", 1991, true)).toBe(true); // through dissolution (inclusive)
    expect(isCommandEconomy("CN", 1953, true)).toBe(true); // command China
    expect(isCommandEconomy("CN", 1978, true)).toBe(true); // pre-Deng (inclusive)
  });

  it("graduates a country OUT of the regime past its threshold year", () => {
    expect(isCommandEconomy("RU", 1992, true)).toBe(false); // post-USSR
    expect(isCommandEconomy("CN", 1979, true)).toBe(false); // Deng reforms → marketizing
    expect(isCommandEconomy("CN", 2019, true)).toBe(false);
  });

  it("never applies to market economies", () => {
    expect(isCommandEconomy("US", 1953, true)).toBe(false);
    expect(isCommandEconomy("DE", 1960, true)).toBe(false);
    expect(isCommandEconomy("NG", 1991, true)).toBe(false);
  });

  it("is fail-safe on unknown/missing inputs", () => {
    expect(isCommandEconomy(null, 1960, true)).toBe(false);
    expect(isCommandEconomy(undefined, 1960, true)).toBe(false);
    expect(isCommandEconomy("RU", null, true)).toBe(false); // unknown era → no regime
    expect(isCommandEconomy("RU", undefined, true)).toBe(false);
    expect(isCommandEconomy("RU", NaN, true)).toBe(false);
    expect(isCommandEconomy("ZZ", 1960, true)).toBe(false); // unknown country
  });

  it("regime table covers the P0 cores", () => {
    expect(COMMAND_ECONOMY_REGIMES.RU?.throughYear).toBe(1991);
    expect(COMMAND_ECONOMY_REGIMES.CN?.throughYear).toBe(1978);
  });
});

describe("marketizationLevel dial", () => {
  it("places countries on the 0(command)..100(market) dial by era", () => {
    expect(marketizationLevel("RU", 1960)).toBeLessThan(COMMAND_CEILING); // Soviet command
    expect(marketizationLevel("CN", 1953)).toBeLessThan(COMMAND_CEILING); // planned China
    expect(marketizationLevel("CN", 1991)).toBeGreaterThanOrEqual(COMMAND_CEILING);
    expect(marketizationLevel("CN", 1991)).toBeLessThan(DUAL_TRACK_CEILING); // dual-track
    expect(marketizationLevel("CN", 2019)).toBeGreaterThanOrEqual(DUAL_TRACK_CEILING); // market
    expect(marketizationLevel("US", 1953)).toBe(100); // never planned
  });

  it("Soviet republics (BLR/BAL) carry the union command trajectory", () => {
    // Constituent republics of the USSR plan: command with RU through the 1991
    // dissolution, market after. They were previously absent from the schedule
    // and read as fully marketized even with the command flag on.
    for (const republic of ["BLR", "BAL"] as const) {
      expect(marketizationLevel(republic, 1953)).toBe(marketizationLevel("RU", 1953));
      expect(marketizationLevel(republic, 1979)).toBeLessThan(COMMAND_CEILING);
      expect(marketizationLevel(republic, 1992)).toBe(100);
    }
  });

  it("fails safe to full market on unknown inputs", () => {
    expect(marketizationLevel(null, 1960)).toBe(100);
    expect(marketizationLevel("RU", null)).toBe(100);
    expect(marketizationLevel("RU", NaN)).toBe(100);
    expect(marketizationLevel("ZZ", 1960)).toBe(100);
  });

  it("classifies the three bands (gated by enabled)", () => {
    // China: command 1953 → dual-track 1991 → market 2019
    expect(isCommandEconomy("CN", 1953, true)).toBe(true);
    expect(isDualTrackEconomy("CN", 1953, true)).toBe(false);

    expect(isCommandEconomy("CN", 1991, true)).toBe(false);
    expect(isDualTrackEconomy("CN", 1991, true)).toBe(true);
    expect(isPlannedEconomy("CN", 1991, true)).toBe(true); // dual-track still "planned"

    expect(isPlannedEconomy("CN", 2019, true)).toBe(false); // market
  });

  it("all band predicates are inert when the flag is off", () => {
    expect(isDualTrackEconomy("CN", 1991, false)).toBe(false);
    expect(isPlannedEconomy("CN", 1953, false)).toBe(false);
    expect(plannedShare("CN", 1953, false)).toBe(0);
  });

  it("plannedShare decreases monotonically from command → market", () => {
    const command = plannedShare("CN", 1953, true);
    const dual = plannedShare("CN", 1991, true);
    const market = plannedShare("CN", 2019, true);
    expect(command).toBeGreaterThan(dual);
    expect(dual).toBeGreaterThan(market);
    expect(market).toBe(0);
    expect(command).toBeGreaterThan(0.5); // deep command is mostly plan
  });
});

// ── Command Economy v2 (P1): real policy stance + soft-budget dial ───────────

describe("computePolicyStance", () => {
  it("is POSITIVE (reformist) for a reformist govt + disciplined Gosbank", () => {
    // reformist govt (+1), restrained credit (0.2), hard budgets (0.3).
    const stance = computePolicyStance(1, 0.2, 0.3);
    expect(stance).toBeGreaterThan(0);
  });

  it("is NEGATIVE (orthodox) for a hardline govt + credit-flooding soft Gosbank", () => {
    // orthodox govt (-1), aggressive credit (0.9), soft budgets (0.9).
    const stance = computePolicyStance(-1, 0.9, 0.9);
    expect(stance).toBeLessThan(0);
  });

  it("is ~0 for a neutral government and a centered Gosbank posture", () => {
    expect(computePolicyStance(0, 0.5, 0.5)).toBeCloseTo(0, 6);
  });

  it("stays within [-1, 1] at the extremes", () => {
    expect(computePolicyStance(1, 0, 0)).toBeLessThanOrEqual(1);
    expect(computePolicyStance(-1, 1, 1)).toBeGreaterThanOrEqual(-1);
  });

  it("hard budgets read as MORE reformist than soft budgets, all else equal", () => {
    const hard = computePolicyStance(0, 0.5, 0.2);
    const soft = computePolicyStance(0, 0.5, 0.9);
    expect(hard).toBeGreaterThan(soft);
  });
});

describe("isSoeSpared", () => {
  it("SPARES an insolvent SOE under a SOFT budget (>= threshold)", () => {
    expect(isSoeSpared(0.9)).toBe(true);
    expect(isSoeSpared(BUDGET_SOFTNESS_FOLD_THRESHOLD)).toBe(true);
  });

  it("lets an insolvent SOE FOLD under a HARD budget (< threshold)", () => {
    expect(isSoeSpared(0.2)).toBe(false);
    expect(isSoeSpared(0)).toBe(false);
  });

  it("defaults to the fairly-soft NPP default when softness is absent", () => {
    expect(isSoeSpared(undefined)).toBe(
      NPP_DEFAULT_BUDGET_SOFTNESS >= BUDGET_SOFTNESS_FOLD_THRESHOLD
    );
    expect(isSoeSpared(undefined)).toBe(true); // NPP default is soft
    expect(isSoeSpared(Number.NaN)).toBe(true);
  });
});

describe("governmentReformismFromEconomicPosition (P3 live reformism)", () => {
  it("maps a market-right ruling party to reformist (+) and command-left to hardline (−)", () => {
    expect(governmentReformismFromEconomicPosition(5)).toBe(1); // fully market-right
    expect(governmentReformismFromEconomicPosition(-5)).toBe(-1); // orthodox command-left
    expect(governmentReformismFromEconomicPosition(0)).toBe(0); // centrist
    expect(governmentReformismFromEconomicPosition(2.5)).toBeCloseTo(0.5, 5);
  });

  it("clamps beyond the −5..+5 economic axis", () => {
    expect(governmentReformismFromEconomicPosition(9)).toBe(1);
    expect(governmentReformismFromEconomicPosition(-9)).toBe(-1);
  });

  it("returns undefined (no signal) on missing / non-finite input so the caller can fall back", () => {
    expect(governmentReformismFromEconomicPosition(undefined)).toBeUndefined();
    expect(governmentReformismFromEconomicPosition(null)).toBeUndefined();
    expect(governmentReformismFromEconomicPosition(Number.NaN)).toBeUndefined();
  });
});

describe("marketizationDrift (P3 balance weights)", () => {
  it("uses the tuned weights: bm 0.34, soe 0.18, pol 0.12", () => {
    expect(MARKETIZATION_DRIFT_WEIGHTS.blackMarket).toBe(0.34);
    expect(MARKETIZATION_DRIFT_WEIGHTS.soePerformance).toBe(0.18);
    expect(MARKETIZATION_DRIFT_WEIGHTS.policyStance).toBe(0.12);
  });

  it("a healthy, orthodox, low-pressure world holds (drift ≤ 0)", () => {
    // on-plan SOEs (perf 1.0), no black market, hardline policy → non-positive.
    expect(marketizationDrift(0, 1.0, -0.5)).toBeLessThanOrEqual(0);
  });

  it("a starved, reformist, high-pressure world drifts toward market (+)", () => {
    // failing SOEs (perf 0.6), heavy black-market pressure, reformist policy.
    expect(marketizationDrift(0.8, 0.6, 0.8)).toBeGreaterThan(0);
  });

  it("all three drivers push the SAME way when aligned (each term signed)", () => {
    const onlyBm = marketizationDrift(1, 1.0, 0); // black market only
    const onlySoe = marketizationDrift(0, 0.0, 0); // max SOE shortfall only
    const onlyPol = marketizationDrift(0, 1.0, 1); // reformist policy only
    expect(onlyBm).toBeCloseTo(0.34, 5);
    expect(onlySoe).toBeCloseTo(0.18, 5); // 0.18 * (1.0 - 0.0)
    expect(onlyPol).toBeCloseTo(0.12, 5);
  });

  it("no single per-turn driver alone can spike more than ~0.34 (no death spiral)", () => {
    // Even a fully-collapsed, fully-reformist, max-pressure turn is bounded well
    // under a level-band's width, so reform takes a plausible multi-year span.
    const worst = marketizationDrift(1, 0, 1);
    expect(worst).toBeLessThan(0.65);
  });
});

describe("internalRepressionFromReformism (NPP default sign)", () => {
  it("orthodox governments repress harder than reformist ones", () => {
    const orthodox = internalRepressionFromReformism(-1); // hardline command-left
    const neutral = internalRepressionFromReformism(0);
    const reformist = internalRepressionFromReformism(1); // market-reformist
    expect(orthodox).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(reformist);
  });

  it("orthodox is moderate-to-high, reformist is low, neutral is the moderate default", () => {
    expect(internalRepressionFromReformism(-1)).toBeGreaterThanOrEqual(0.75);
    expect(internalRepressionFromReformism(0)).toBe(NPP_DEFAULT_INTERNAL_REPRESSION);
    expect(internalRepressionFromReformism(1)).toBeLessThanOrEqual(0.25);
  });

  it("clamps to [0, 1] and defaults non-finite input to the moderate level", () => {
    expect(internalRepressionFromReformism(-5)).toBeLessThanOrEqual(1);
    expect(internalRepressionFromReformism(5)).toBeGreaterThanOrEqual(0);
    expect(internalRepressionFromReformism(Number.NaN)).toBe(NPP_DEFAULT_INTERNAL_REPRESSION);
    expect(internalRepressionFromReformism(undefined)).toBe(NPP_DEFAULT_INTERNAL_REPRESSION);
  });
});

// ── The regime dial needs a LIVE input in both directions ────────────────────

describe("blendGovernmentReformism", () => {
  it("blends the chartered party line with the sitting government's live stance", () => {
    // Frozen orthodox charter (−1) + a genuinely reformist cabinet (+1) → neutral,
    // not "orthodox forever". Under the old precedence rule this was −1.
    expect(blendGovernmentReformism(-1, 1)).toBeCloseTo(0, 6);
    expect(blendGovernmentReformism(-1, -1)).toBeCloseTo(-1, 6);
    expect(blendGovernmentReformism(0, 0.4)).toBeCloseTo(0.2, 6);
  });

  it("the cabinet stance MOVES the result in both directions at a fixed party line", () => {
    const party = -1; // frozen one-party charter
    const hardline = blendGovernmentReformism(party, -1)!;
    const neutral = blendGovernmentReformism(party, 0)!;
    const reformist = blendGovernmentReformism(party, 1)!;
    expect(hardline).toBeLessThan(neutral);
    expect(neutral).toBeLessThan(reformist);
  });

  it("uses whichever single input is present, and undefined when neither is", () => {
    expect(blendGovernmentReformism(0.6, undefined)).toBeCloseTo(0.6, 6);
    expect(blendGovernmentReformism(undefined, -0.3)).toBeCloseTo(-0.3, 6);
    expect(blendGovernmentReformism(null, Number.NaN)).toBeUndefined();
    expect(blendGovernmentReformism(undefined, undefined)).toBeUndefined();
  });

  it("clamps inputs and output to [−1, 1]", () => {
    expect(blendGovernmentReformism(9, 9)).toBe(1);
    expect(blendGovernmentReformism(-9, -9)).toBe(-1);
  });

  it("weights sum to 1 so a unanimous regime keeps its full signal", () => {
    expect(REFORMISM_PARTY_WEIGHT + REFORMISM_CABINET_WEIGHT).toBeCloseTo(1, 6);
  });
});

describe("marketizationGravity (era default, not rails)", () => {
  it("is exactly zero at the scheduled level — an untouched world is unchanged", () => {
    expect(marketizationGravity(10, 10)).toBe(0);
  });

  it("pulls UP when below the era schedule and DOWN when above it", () => {
    expect(marketizationGravity(0, 10)).toBeGreaterThan(0); // sunk below history
    expect(marketizationGravity(40, 10)).toBeLessThan(0); // ran ahead of history
  });

  it("saturates at the cap so a large gap never produces a snap-back", () => {
    expect(marketizationGravity(0, 100)).toBe(MARKETIZATION_GRAVITY_MAX_STEP);
    expect(marketizationGravity(100, 0)).toBe(-MARKETIZATION_GRAVITY_MAX_STEP);
    // Rate applies below saturation.
    expect(marketizationGravity(8, 10)).toBeCloseTo(2 * MARKETIZATION_GRAVITY_RATE, 6);
  });

  it("is BEATABLE: the free drivers outrun gravity in both directions", () => {
    // A reforming government (pressure + failing plan + reformist policy) beats
    // the pull back down toward a command-era schedule...
    const reforming = marketizationDrift(0.6, 0.7, 0.5);
    expect(reforming + marketizationGravity(30, 10)).toBeGreaterThan(0);
    // ...and a hardliner running a tight plan beats the pull up toward a market
    // schedule (e.g. RU after 1991, when the schedule reads fully market).
    const entrenching = marketizationDrift(0, 1.3, -0.9);
    expect(entrenching + marketizationGravity(10, 100)).toBeLessThan(0);
  });

  it("is NaN-safe (never poisons the stored level)", () => {
    expect(marketizationGravity(Number.NaN, 10)).toBe(0);
    expect(marketizationGravity(10, Number.NaN)).toBe(0);
  });
});

// Command-economy seed-gap fix + ticket #1014: Warsaw-Pact satellites must
// resolve a full SOE sector set (one enterprise per CorporationType). Without
// that, plants-mode capacity never exists outside a short "commanding heights"
// list and private founding stays banned — ghost markets.
describe("commandEconomySoeSectors — Warsaw-Pact satellites (command-economy seed-gap fix)", () => {
  it("every Warsaw-Pact command country in MARKETIZATION_SCHEDULE resolves a non-empty SOE sector set", () => {
    for (const countryId of ["DD", "PL", "HU", "CS", "BG", "RO"] as const) {
      expect(commandEconomySoeSectors(countryId).length).toBeGreaterThan(0);
    }
  });

  it("valid types only — every listed sector is a real CorporationType, no invented ids", () => {
    const VALID_TYPES = new Set([
      "financial",
      "media",
      "manufacturing",
      "chemical_industries",
      "healthcare",
      "retail",
      "automobiles",
      "technology",
      "energy",
      "agriculture",
      "real_estate",
      "construction",
      "defense",
      "telecommunications",
      "entertainment",
      "logistics",
      "extraction",
    ]);
    for (const countryId of ["RU", "CN", "DD", "PL", "HU", "CS", "BG", "RO", "YU"] as const) {
      for (const sector of commandEconomySoeSectors(countryId)) {
        expect(VALID_TYPES.has(sector)).toBe(true);
      }
    }
  });

  it("Eastern-bloc / USSR command countries cover every CorporationType (plants need state capacity in all sectors)", async () => {
    const { CORPORATION_TYPES } = await import("@/lib/constants/corporations");
    for (const countryId of [
      "RU",
      "UKR",
      "BLR",
      "BAL",
      "DD",
      "PL",
      "HU",
      "CS",
      "BG",
      "RO",
      "YU",
    ] as const) {
      expect(commandEconomySoeSectors(countryId)).toEqual([...CORPORATION_TYPES]);
    }
  });

  it("China keeps a shorter dual-track-aware set (not Eastern-bloc full stack)", () => {
    const cn = commandEconomySoeSectors("CN");
    expect(cn.length).toBeGreaterThan(0);
    expect(cn.length).toBeLessThan(commandEconomySoeSectors("DD").length);
    expect(cn).toContain("manufacturing");
    expect(cn).toContain("retail");
  });

  it("no unknown/unrelated countries pick up a sector set", () => {
    expect(commandEconomySoeSectors("US")).toEqual([]);
    // Market democracy, not a command economy — should never pick up a set.
    expect(commandEconomySoeSectors("IE")).toEqual([]);
  });

  it("Yugoslavia has the full sector set despite not being a Warsaw-Pact member", async () => {
    const { CORPORATION_TYPES } = await import("@/lib/constants/corporations");
    expect(commandEconomySoeSectors("YU")).toEqual([...CORPORATION_TYPES]);
  });
});
