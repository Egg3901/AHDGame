import { describe, expect, it } from "vitest";
import { calcUnifiedBuildOrg } from "./buildOrgGain";
import {
  BUILD_ORG_BASE_GAIN,
  BUILD_ORG_CATCHUP_BONUS,
  BUILD_ORG_PS_EFFECTIVE_CEILING,
  BUILD_ORG_PS_LEVERAGE_FLOOR,
  CONTEST_LOW_ORG_TAPER,
} from "./strengthConstants";

describe("calcUnifiedBuildOrg", () => {
  it("keeps the open-state total unchanged but carves more from rivals (W=1.5)", () => {
    // SF 55.2 / UUP 8.8 / CON 8.5 / pool 27.4; SF 29 PS, UUP 6, CON 4.
    const r = calcUnifiedBuildOrg({
      ownOrgPct: 55.2,
      ownPS: 29,
      totalPartyOrgPct: 72.5,
      rivalLeadOrgPct: 8.8,
      avgRivalPS: 5,
      rivals: [
        { partyId: "uup", orgPct: 8.8, ps: 6 },
        { partyId: "con", orgPct: 8.5, ps: 4 },
      ],
    });
    // Open state: pool still dominates the throttle, so the TOTAL is unchanged
    // by the poach model (still ≈ today's Build +0.68) — the Org+PS blend only
    // reapportions which rivals bleed, it doesn't raise an open-state total.
    expect(r.totalGain).toBeCloseTo(0.68, 1);
    // …the pool slice shrinks and the two near-equal rivals each bleed ~0.14-0.15.
    expect(r.poolGain).toBeCloseTo(0.39, 1);
    expect(r.poolGain).toBeLessThan(r.totalGain);
    const uup = r.rivalPoaches.find((p) => p.partyId === "uup")!;
    const con = r.rivalPoaches.find((p) => p.partyId === "con")!;
    expect(uup.loss).toBeCloseTo(0.149, 2);
    expect(con.loss).toBeCloseTo(0.141, 2);
    // conservation: spender gain == pool + Σ rival losses
    expect(r.totalGain).toBeCloseTo(r.poolGain + uup.loss + con.loss, 5);
  });

  it("yields a sizeable poach-only gain in a fully saturated state", () => {
    // SF 60 / UUP 20 / CON 20 / pool 0 — gain comes purely from poaching. With
    // the rival-headroom weight (W=1.5) plus the Org+PS exposure blend (both
    // rivals at the lead Org → full Org-intensity), the saturated build lands
    // ~1.17 (up from ~0.355 under the original W=0.5 poach-weight).
    const r = calcUnifiedBuildOrg({
      ownOrgPct: 60,
      ownPS: 29,
      totalPartyOrgPct: 100,
      rivalLeadOrgPct: 20,
      avgRivalPS: 5,
      rivals: [
        { partyId: "uup", orgPct: 20, ps: 6 },
        { partyId: "con", orgPct: 20, ps: 4 },
      ],
    });
    expect(r.poolGain).toBe(0);
    expect(r.totalGain).toBeCloseTo(1.17, 1);
  });

  it("still produces gain in a fully saturated state by poaching only", () => {
    // SF 60 / UUP 20 / CON 20 / pool 0.
    const r = calcUnifiedBuildOrg({
      ownOrgPct: 60,
      ownPS: 29,
      totalPartyOrgPct: 100,
      rivalLeadOrgPct: 20,
      avgRivalPS: 5,
      rivals: [
        { partyId: "uup", orgPct: 20, ps: 6 },
        { partyId: "con", orgPct: 20, ps: 4 },
      ],
    });
    expect(r.poolGain).toBe(0);
    expect(r.totalGain).toBeGreaterThan(0);
    const con = r.rivalPoaches.find((p) => p.partyId === "con")!;
    const uup = r.rivalPoaches.find((p) => p.partyId === "uup")!;
    // CON has the weaker PS → it bleeds more.
    expect(con.loss).toBeGreaterThan(uup.loss);
  });

  it("still poaches a high-PS rival by its Org size (no full immunity)", () => {
    // Org+PS blend (2026-06-25): a rival whose PS >= yours is no longer immune —
    // it still exposes Org by virtue of its size, so the lead party is a target.
    const r = calcUnifiedBuildOrg({
      ownOrgPct: 30,
      ownPS: 10,
      totalPartyOrgPct: 100, // saturated so only rivals can be the source
      rivalLeadOrgPct: 40,
      avgRivalPS: 20,
      rivals: [{ partyId: "strong", orgPct: 40, ps: 20 }],
    });
    expect(r.rivalPoaches[0].loss).toBeGreaterThan(0);
    expect(r.totalGain).toBeGreaterThan(0);
    expect(r.totalGain).toBeCloseTo(r.rivalPoaches[0].loss, 5); // saturated → all from poach
  });

  it("makes the dominant rival the primary target even at PS parity", () => {
    // Saturated 2-rival state, BOTH rivals match the spender's PS (psAdvantage 0
    // for each). Under the blend the loss is driven purely by Org size, so the
    // bigger party bleeds more — the opposite of the old PS-only model where both
    // would have been immune.
    const r = calcUnifiedBuildOrg({
      ownOrgPct: 20,
      ownPS: 10,
      totalPartyOrgPct: 100,
      rivalLeadOrgPct: 50,
      avgRivalPS: 10,
      rivals: [
        { partyId: "big", orgPct: 50, ps: 10 },
        { partyId: "small", orgPct: 30, ps: 10 },
      ],
    });
    const big = r.rivalPoaches.find((p) => p.partyId === "big")!;
    const small = r.rivalPoaches.find((p) => p.partyId === "small")!;
    expect(big.loss).toBeGreaterThan(0);
    expect(big.loss).toBeGreaterThan(small.loss);
  });

  it("tapers the poach against a near-zero-Org rival (low-org damp carried over)", () => {
    const base = {
      ownOrgPct: 30,
      ownPS: 30,
      totalPartyOrgPct: 100,
      rivalLeadOrgPct: 40,
      avgRivalPS: 5,
    };
    const high = calcUnifiedBuildOrg({
      ...base,
      rivals: [{ partyId: "r", orgPct: CONTEST_LOW_ORG_TAPER, ps: 5 }],
    });
    const low = calcUnifiedBuildOrg({
      ...base,
      rivals: [{ partyId: "r", orgPct: CONTEST_LOW_ORG_TAPER / 2, ps: 5 }],
    });
    // poachable weight halves with half the Org (×org and ×lowOrgDamp both halve → quarter),
    // but the loss is still strictly smaller for the lower-Org target.
    expect(low.rivalPoaches[0].loss).toBeLessThan(high.rivalPoaches[0].loss);
  });

  it("halves a rival's poach when its defense shield is 0.5", () => {
    const mk = (shield: number) =>
      calcUnifiedBuildOrg({
        ownOrgPct: 30,
        ownPS: 30,
        totalPartyOrgPct: 100,
        rivalLeadOrgPct: 40,
        avgRivalPS: 5,
        rivals: [{ partyId: "r", orgPct: 40, ps: 5, shield }],
      });
    const shielded = mk(0.5).rivalPoaches[0].loss;
    const unshielded = mk(1).rivalPoaches[0].loss;
    expect(shielded).toBeLessThan(unshielded);
  });

  it("never lets a rival lose more Org than it holds", () => {
    const r = calcUnifiedBuildOrg({
      ownOrgPct: 0,
      ownPS: 1000,
      totalPartyOrgPct: 100,
      rivalLeadOrgPct: 0.2,
      avgRivalPS: 0.01,
      rivals: [{ partyId: "tiny", orgPct: 0.2, ps: 0 }],
    });
    expect(r.rivalPoaches[0].loss).toBeLessThanOrEqual(0.2);
    expect(r.rivalPoaches[0].loss).toBeGreaterThanOrEqual(0);
  });

  it("never exceeds the effective ceiling BASE × (PS_CEILING + CATCHUP_BONUS) = 4.0", () => {
    // Max conditions: full pool, PS hugely above rivals, trailing in org (catchup on).
    // effectiveLeverage = min(2.0, 1.5+0.5) = 2.0; ownDiminishing = 1 (org=0<50).
    // grossGain = 2.0 × 1 × 1 × 2.0 = 4.0 (tighter than old 1.5×1.5 = 4.5).
    const r = calcUnifiedBuildOrg({
      ownOrgPct: 0,
      ownPS: 1000,
      totalPartyOrgPct: 0, // full pool
      rivalLeadOrgPct: 100, // catch-up on
      avgRivalPS: 1,
      rivals: [{ partyId: "r", orgPct: 0, ps: 0 }],
    });
    const ceiling = BUILD_ORG_BASE_GAIN * BUILD_ORG_PS_EFFECTIVE_CEILING;
    expect(r.totalGain).toBeCloseTo(ceiling, 5);
    expect(r.totalGain).toBeLessThanOrEqual(ceiling + 1e-9);
  });

  it("catchup is additive — trailing party at PS floor gets neutral (1.0×), not penalised (0.75×)", () => {
    // ownPS(5) << avgRivalPS(20) → rawLeverage = PS_FLOOR = 0.5
    // rivalLeadOrg(40) > ownOrg(10) → catchupAddend = CATCHUP_BONUS = 0.5
    // effectiveLeverage = 0.5+0.5 = 1.0 (additive fix)
    // Old multiplicative: 0.5 × 1.5 = 0.75 (punished the underdog)
    const r = calcUnifiedBuildOrg({
      ownOrgPct: 10,
      ownPS: 5,
      totalPartyOrgPct: 50, // 50% pool available
      rivalLeadOrgPct: 40,
      avgRivalPS: 20,
      rivals: [{ partyId: "big", orgPct: 40, ps: 20 }],
    });
    // factors carry the raw (pre-combined) values for UI transparency
    expect(r.factors.psLeverage).toBeCloseTo(BUILD_ORG_PS_LEVERAGE_FLOOR, 5);
    expect(r.factors.catchup).toBeCloseTo(BUILD_ORG_CATCHUP_BONUS, 5);
    // effectiveLeverage = 1.0 → grossGain = 2.0 × 0.5 (poolWeight) × 1.0 × 1.0 = 1.0
    expect(r.totalGain).toBeCloseTo(1.0, 1);
    // conservation invariant still holds
    const poachSum = r.rivalPoaches.reduce((s, p) => s + p.loss, 0);
    expect(r.totalGain).toBeCloseTo(r.poolGain + poachSum, 5);
  });
});
