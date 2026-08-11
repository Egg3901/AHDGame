import { describe, expect, it } from "vitest";
import { sectorSignal, spendSignal, lawSignal, affinity, driftScore, classify } from "./classify";
import { MODEL_ARCHETYPES, AFFINITY_WEIGHTS, SCORE_INERTIA } from "@/lib/constants/economicModels";

const mic = MODEL_ARCHETYPES.militaryIndustrial;
const socialMarket = MODEL_ARCHETYPES.socialMarket;
const financialized = MODEL_ARCHETYPES.financialized;

describe("sectorSignal (graded weighted-share)", () => {
  it("stays resolved across [0,1] — 15% vs 35% primary are distinguishable and both < 1", () => {
    const at15 = sectorSignal(mic, { defense: 15 }, 100);
    const at35 = sectorSignal(mic, { defense: 35 }, 100);
    expect(at35).toBeGreaterThan(at15);
    expect(at15).toBeLessThan(1);
    expect(at35).toBeLessThan(1);
    expect(at15).toBeCloseTo(0.15, 6); // (3·15)/(3·100)
  });

  it("adds secondary revenue and clamps at 1", () => {
    const s = sectorSignal(mic, { defense: 90, manufacturing: 90 }, 100);
    expect(s).toBe(1); // (3·90 + 1·90)/(3·100) = 360/300 → clamp 1
  });

  it("is 0 for the structureless mixed model and when total revenue is 0", () => {
    expect(sectorSignal(MODEL_ARCHETYPES.mixed, { defense: 50 }, 100)).toBe(0);
    expect(sectorSignal(mic, { defense: 50 }, 0)).toBe(0);
  });
});

describe("spendSignal (normalized weighted overlap)", () => {
  it("matches a hand-computed weighted overlap", () => {
    // sig {healthcare:0.5, welfare:0.3, socialSecurity:0.2}; share {healthcare:0.4, welfare:0.2, defense:0.4}
    // (0.4·0.5 + 0.2·0.3 + 0·0.2) / 1.0 = 0.26
    const s = spendSignal(socialMarket, { healthcare: 0.4, welfare: 0.2, defense: 0.4 });
    expect(s).toBeCloseTo(0.26, 6);
  });

  it("is 0 when the model has no spending signature (no divide-by-zero)", () => {
    expect(spendSignal(financialized, { defense: 0.9 })).toBe(0);
  });
});

describe("lawSignal", () => {
  it("is the active fraction of the model's flagship laws", () => {
    expect(lawSignal(mic, new Set(["defense_buildup"]))).toBeCloseTo(0.5, 6); // 1 of 2
    expect(lawSignal(mic, new Set(["defense_buildup", "military_procurement"]))).toBe(1);
    expect(lawSignal(mic, new Set())).toBe(0);
  });

  it("is 0 for a model with no flagship laws (mixed)", () => {
    expect(lawSignal(MODEL_ARCHETYPES.mixed, new Set(["anything"]))).toBe(0);
  });
});

describe("affinity + drift", () => {
  it("blends 0.4·sector + 0.4·spend + 0.2·law", () => {
    expect(affinity({ sector: 1, spend: 0, law: 0 })).toBeCloseTo(AFFINITY_WEIGHTS.sector, 6);
    expect(affinity({ sector: 0.5, spend: 0.5, law: 0.5 })).toBeCloseTo(0.5, 6);
  });

  it("drifts the prior score toward 100·affinity at the inertia rate", () => {
    expect(driftScore(50, 0.8)).toBeCloseTo(SCORE_INERTIA * 50 + (1 - SCORE_INERTIA) * 80, 6);
  });
});

describe("classify", () => {
  it("cold-starts each score at 100·affinity (no drift lag on turn 0)", () => {
    const out = classify(
      {},
      {
        revenueByType: { defense: 40, manufacturing: 10 },
        totalRevenue: 100,
        spendingShare: { defense: 1 },
        activeLawTags: new Set(["defense_buildup", "military_procurement"]),
      }
    );
    expect(out.leader).toBe("militaryIndustrial");
    expect(out.intensity).toBeGreaterThan(0);
    // cold-start score == 100·affinity for the leader
    expect(out.scores.militaryIndustrial).toBeCloseTo(100 * out.affinities.militaryIndustrial, 4);
  });

  it("Spending alone does not outscore a model with Sector + Spending support", () => {
    // MIC gets a spend match (defense) but NO aligned sectors; agrarian gets BOTH
    // an aligned sector base AND a spend match. The sector+spend model must win.
    const out = classify(
      {},
      {
        revenueByType: { agriculture: 60, extraction: 10, logistics: 10 },
        totalRevenue: 100,
        spendingShare: { agriculture: 0.5, defense: 0.5 },
        activeLawTags: new Set(),
      }
    );
    expect(out.scores.agrarian).toBeGreaterThan(out.scores.militaryIndustrial);
    expect(out.leader).toBe("agrarian");
  });
});

describe("State-Capitalist ownership lever", () => {
  const noEnergy = {
    revenueByType: { retail: 50, technology: 50 }, // no energy/command sector dominance
    totalRevenue: 100,
    spendingShare: {},
    activeLawTags: new Set<string>(),
  };

  it("activates State-Capitalist when state ownership ≥ 67% (overrides the weak sector signal)", () => {
    const out = classify({}, { ...noEnergy, stateOwnershipShare: 0.7 });
    expect(out.leader).toBe("stateCapitalist");
    expect(out.scores.stateCapitalist).toBeCloseTo(70, 0); // 100·0.7
  });

  it("does NOT activate via ownership below the 67% threshold", () => {
    const out = classify({}, { ...noEnergy, stateOwnershipShare: 0.5 });
    expect(out.leader).not.toBe("stateCapitalist");
    // falls back to its weak generic signal, not the 50% ownership
    expect(out.scores.stateCapitalist).toBeLessThan(50);
  });

  it("is unaffected (parity) when no ownership share is supplied", () => {
    const out = classify({}, noEnergy);
    expect(out.scores.stateCapitalist).toBeLessThan(30); // weak generic only
  });
});

describe("open-loop stability (steady inputs converge, no oscillation)", () => {
  it("scores drift monotonically to 100·affinity and the leader is stable", () => {
    const input = {
      revenueByType: { defense: 40, manufacturing: 10 },
      totalRevenue: 100,
      spendingShare: { defense: 1 },
      activeLawTags: new Set<string>(),
    };
    let scores: Partial<Record<string, number>> = {};
    let prevLeaderScore = -1;
    const deltas: number[] = [];
    for (let t = 0; t < 400; t++) {
      const r = classify(scores as never, input);
      scores = r.scores;
      deltas.push(
        Math.abs(r.scores[r.leader] - (prevLeaderScore < 0 ? r.scores[r.leader] : prevLeaderScore))
      );
      prevLeaderScore = r.scores[r.leader];
    }
    const final = classify(scores as never, input);
    expect(final.leader).toBe("militaryIndustrial");
    // converged to the fixed point 100·affinity (within a hair)
    expect(final.scores.militaryIndustrial).toBeCloseTo(
      100 * final.affinities.militaryIndustrial,
      2
    );
    // late-turn movement is negligible (monotone convergence, not oscillation)
    expect(deltas.slice(-5).every((d) => d < 0.01)).toBe(true);
  });
});
