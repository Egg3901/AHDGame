import { describe, expect, it } from "vitest";
import {
  computeDecayDeltas,
  computeDriftDeltas,
  govHomeFieldNudge,
  planStateRegDriftDecay,
} from "./regDriftDecay";
import {
  HOME_FIELD_DRIFT_BONUS,
  HOME_FIELD_REG_CAP,
  PASSIVE_REG_DRIFT_RATE,
} from "./pacingConstants";
import type { StatePartyOrg, StateRegistrationPool } from "@/lib/db/types";
import { POOL_SENTINEL_PARTY_ID } from "@/lib/db/types";

function makeRow(
  partyId: string,
  organization: number,
  registration: number | undefined
): StatePartyOrg {
  return {
    _id: `state_${partyId}`,
    countryId: "US",
    stateId: "CA",
    partyId,
    organization,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    treasury: 0,
    stateTaxRate: 0,
    politicalStrength: 0,
    hasPresence: true,
    registration,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makePool(independent: number, unregistered: number): StateRegistrationPool {
  return {
    _id: "US_CA",
    countryId: "US",
    stateId: "CA",
    independent,
    unregistered,
    lastUpdatedTurn: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("computeDriftDeltas", () => {
  it("moves reg up toward org by min(rate, gap) — one-directional", () => {
    const result = computeDriftDeltas(
      [
        { rowId: "a", partyId: "1", orgPct: 30, regPct: 25 },
        { rowId: "b", partyId: "2", orgPct: 20, regPct: 22 },
      ],
      0.04
    );
    // Party 1: reg=25 < org=30 → gap=5 → drifts up 0.04
    expect(result.partyDeltas[0].delta).toBeCloseTo(0.04);
    // Party 2: reg=22 > org=20 → gap=-2 → no downward drift (one-directional)
    expect(result.partyDeltas.length).toBe(1);
  });

  it("clamps drift when gap is smaller than rate", () => {
    const result = computeDriftDeltas(
      [{ rowId: "a", partyId: "1", orgPct: 30.01, regPct: 30 }],
      0.04
    );
    expect(result.partyDeltas[0].delta).toBeCloseTo(0.01);
  });

  it("residual is the negation of the net party movement", () => {
    const result = computeDriftDeltas(
      [
        { rowId: "a", partyId: "1", orgPct: 40, regPct: 30 }, // gains 0.04
        { rowId: "b", partyId: "2", orgPct: 20, regPct: 22 }, // no drift (reg > org)
      ],
      0.04
    );
    // Only party 1 drifts up 0.04; party 2 is above org so no drift.
    expect(result.poolResidual).toBeCloseTo(-0.04);
  });

  it("zero or negative gap = zero drift (one-directional)", () => {
    const result = computeDriftDeltas([{ rowId: "a", partyId: "1", orgPct: 25, regPct: 25 }], 0.04);
    expect(result.partyDeltas.length).toBe(0);
    expect(result.poolResidual).toBeCloseTo(0);
  });

  it("with regLagBelowOrg, Reg targets (Org − lag) not Org", () => {
    // Org=30, Reg=30, lag=5 → target=25 → gap=-5 → no downward drift (one-directional).
    const result = computeDriftDeltas(
      [{ rowId: "a", partyId: "1", orgPct: 30, regPct: 30 }],
      0.04,
      5
    );
    // Reg is already above the lagged target — no upward drift.
    expect(result.partyDeltas.length).toBe(0);
    expect(result.poolResidual).toBeCloseTo(0);
  });

  it("floors target at 0 — tiny-Org parties don't target negative Reg", () => {
    // Org=3, Reg=4, lag=5 → target=max(0, -2)=0 → gap=-4 → no downward drift.
    const result = computeDriftDeltas(
      [{ rowId: "a", partyId: "1", orgPct: 3, regPct: 4 }],
      0.04,
      5
    );
    expect(result.partyDeltas.length).toBe(0);
  });

  it("at-target (Reg = Org − lag) produces no drift", () => {
    const result = computeDriftDeltas(
      [{ rowId: "a", partyId: "1", orgPct: 25, regPct: 20 }],
      0.04,
      5
    );
    expect(result.partyDeltas.length).toBe(0);
  });

  it("clamps drift when remaining gap to lagged target is smaller than rate", () => {
    // Org=30, Reg=24.99, lag=5 → target=25, gap=0.01.
    const result = computeDriftDeltas(
      [{ rowId: "a", partyId: "1", orgPct: 30, regPct: 24.99 }],
      0.04,
      5
    );
    expect(result.partyDeltas[0].delta).toBeCloseTo(0.01);
  });

  it("reg above org produces no drift (seeded registration is durable)", () => {
    // Mississippi 1953: DEM org=38, reg=87. Reg is well above Org — no downward drift.
    const result = computeDriftDeltas(
      [{ rowId: "ms_dem", partyId: "DEM", orgPct: 38, regPct: 87 }],
      0.06
    );
    expect(result.partyDeltas.length).toBe(0);
    expect(result.poolResidual).toBeCloseTo(0);
  });
});

describe("computeDecayDeltas", () => {
  it("each party loses up to rate; loss redistributed via sqrt(org) to eligible parties", () => {
    const result = computeDecayDeltas(
      [
        { rowId: "a", partyId: "1", orgPct: 36, regPct: 40 }, // eligible (>= 10)
        { rowId: "b", partyId: "2", orgPct: 16, regPct: 20 }, // eligible
      ],
      0.004,
      10
    );
    // Total lost = 0.004 + 0.004 = 0.008. Caught back by sqrt(36) + sqrt(16) = 6 + 4 = 10 weights.
    // Party 1 catches 6/10 of 0.008 = 0.0048. Net delta = -0.004 + 0.0048 = +0.0008
    // Party 2 catches 4/10 of 0.008 = 0.0032. Net delta = -0.004 + 0.0032 = -0.0008
    const p1 = result.partyDeltas.find((d) => d.partyId === "1")!;
    const p2 = result.partyDeltas.find((d) => d.partyId === "2")!;
    expect(p1.delta).toBeCloseTo(0.0008);
    expect(p2.delta).toBeCloseTo(-0.0008);
    // No pool delta since eligible parties absorbed it
    expect(result.poolDelta.independent).toBe(0);
    expect(result.poolDelta.unregistered).toBe(0);
  });

  it("if no eligible parties, lost amount routes to pool with bias", () => {
    const result = computeDecayDeltas(
      [
        { rowId: "a", partyId: "1", orgPct: 5, regPct: 20 }, // not eligible
        { rowId: "b", partyId: "2", orgPct: 8, regPct: 20 }, // not eligible
      ],
      0.004,
      10,
      1.5
    );
    // Total lost = 0.008. Bias 1.5 → independent gets 1.5/2.5 = 60%, unreg gets 40%.
    expect(result.poolDelta.independent).toBeCloseTo(0.0048);
    expect(result.poolDelta.unregistered).toBeCloseTo(0.0032);
    // Each party loses its decay; no catch
    const p1 = result.partyDeltas.find((d) => d.partyId === "1")!;
    expect(p1.delta).toBeCloseTo(-0.004);
  });

  it("party with regPct = 0 doesn't decay below 0", () => {
    const result = computeDecayDeltas(
      [{ rowId: "a", partyId: "1", orgPct: 50, regPct: 0 }],
      0.004,
      10
    );
    // Loss bounded by max(0, regPct=0). No loss → no delta to track.
    expect(result.partyDeltas).toEqual([]);
  });
});

describe("planStateRegDriftDecay", () => {
  it("returns null only when the state has no party rows at all", () => {
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties: [],
      pool: makePool(40, 10),
      turn: 100,
      now: new Date(),
    });
    expect(planned).toBeNull();
  });

  it("lets an Org-bearing party with undefined Reg start accruing (drift from 0 toward Org)", () => {
    // Design §4.2.1: drift applies to every party with a row, treating
    // undefined Reg as 0 — so a third party that built Org begins building a
    // registered base. Previously these rows were filtered out and stayed
    // undefined forever (e.g. WA DSA: Org 9.57, Reg undefined).
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      // Major party seeded; third party has Org but no Reg yet.
      parties: [makeRow("1", 36, 49), makeRow("3", 12, undefined)],
      pool: makePool(20, 8),
      turn: 100,
      now: new Date(),
    });
    expect(planned).not.toBeNull();
    if (!planned) return;
    const thirdPartyUpdate = planned.partyUpdates.find((u) => u.rowId === "state_3");
    expect(thirdPartyUpdate).toBeDefined();
    // US lag=5 → target = 12 − 5 = 7; from Reg 0 the gap is positive, so it
    // drifts UP by the drift rate (not down, not skipped).
    expect(thirdPartyUpdate!.newReg).toBeGreaterThan(0);
  });

  it("emits ledger rows for both drift and decay", () => {
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties: [makeRow("1", 36, 30), makeRow("2", 16, 20)],
      pool: makePool(30, 4),
      turn: 100,
      now: new Date(),
    });
    expect(planned).not.toBeNull();
    if (!planned) return;
    // Should have drift rows (2 parties move) + decay rows (2 parties lose)
    const driftRows = planned.ledgerRows.filter((r) => r.source === "drift");
    const decayRows = planned.ledgerRows.filter((r) => r.source === "decay");
    expect(driftRows.length).toBeGreaterThanOrEqual(2);
    expect(decayRows.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves pool sum invariant across drift + decay (when rounding)", () => {
    const parties = [makeRow("1", 30, 35), makeRow("2", 20, 25)];
    const pool = makePool(30, 10);
    const totalBefore =
      parties.reduce((s, p) => s + (p.registration ?? 0), 0) + pool.independent + pool.unregistered;

    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties,
      pool,
      turn: 100,
      now: new Date(),
    });
    if (!planned) throw new Error("expected plan");

    const newPartySum = planned.partyUpdates.reduce((s, u) => s + u.newReg, 0);
    const unmovedParties = parties
      .filter((p) => !planned.partyUpdates.find((u) => u.rowId === p._id))
      .reduce((s, p) => s + (p.registration ?? 0), 0);
    const totalAfter =
      newPartySum +
      unmovedParties +
      planned.poolUpdate.newIndependent +
      planned.poolUpdate.newUnregistered;
    expect(totalAfter).toBeCloseTo(totalBefore, 8);
  });

  it("uses POOL_SENTINEL_PARTY_ID for pool ledger rows", () => {
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties: [makeRow("1", 5, 30)], // not eligible → pool gets it
      pool: makePool(40, 30),
      turn: 100,
      now: new Date(),
    });
    if (!planned) throw new Error("expected plan");
    const poolRows = planned.ledgerRows.filter((r) => r.partyId === POOL_SENTINEL_PARTY_ID);
    expect(poolRows.length).toBeGreaterThan(0);
  });

  it("US: Reg above Org produces no downward drift (one-directional)", () => {
    // Org=25, Reg=30 → reg > org → no downward drift. Decay still runs.
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties: [makeRow("1", 25, 30)],
      pool: makePool(40, 30),
      turn: 100,
      now: new Date(),
    });
    if (!planned) throw new Error("expected plan");
    // No drift rows for party 1 (reg > org, no upward drift).
    const driftRows = planned.ledgerRows.filter((r) => r.source === "drift");
    expect(driftRows.length).toBe(0);
    // Decay runs: party loses 0.004, catches it back (eligible at org=25).
    // Net zero delta → no party update, but decay ledger rows are emitted.
    const decayRows = planned.ledgerRows.filter((r) => r.source === "decay");
    // With one eligible party, loss is caught back — no pool delta, no decay rows.
    // (The party delta is 0 after catch-back, so no party decay row either.)
    // This is correct: decay is a wash for a solo eligible party.
  });

  it("DE: Reg above Org produces no downward drift (one-directional)", () => {
    const planned = planStateRegDriftDecay({
      countryId: "DE",
      stateId: "BY",
      parties: [
        {
          _id: "de_1",
          countryId: "DE",
          stateId: "BY",
          partyId: "1",
          organization: 25,
          chairId: null,
          viceChairId: null,
          treasurerId: null,
          treasury: 0,
          stateTaxRate: 0,
          politicalStrength: 0,
          hasPresence: true,
          registration: 30, // Org=25, Reg=30 → reg > org → no downward drift
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      pool: {
        _id: "DE_BY",
        countryId: "DE",
        stateId: "BY",
        independent: 40,
        unregistered: 30,
        lastUpdatedTurn: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      turn: 100,
      now: new Date(),
    });
    if (!planned) throw new Error("expected plan");
    // No drift rows (reg > org, no upward drift).
    const driftRows = planned.ledgerRows.filter((r) => r.source === "drift");
    expect(driftRows.length).toBe(0);
  });

  it("Country not in map (BR) falls back to lag=0 — Reg targets Org exactly", () => {
    // Org=30, Reg=30 → BR (no entry) lag=0 → target=30 → no drift.
    const planned = planStateRegDriftDecay({
      countryId: "BR",
      stateId: "SP",
      parties: [
        {
          _id: "br_1",
          countryId: "BR",
          stateId: "SP",
          partyId: "1",
          organization: 30,
          chairId: null,
          viceChairId: null,
          treasurerId: null,
          treasury: 0,
          stateTaxRate: 0,
          politicalStrength: 0,
          hasPresence: true,
          registration: 30,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      pool: {
        _id: "BR_SP",
        countryId: "BR",
        stateId: "SP",
        independent: 40,
        unregistered: 30,
        lastUpdatedTurn: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      turn: 100,
      now: new Date(),
    });
    if (!planned) throw new Error("expected plan");
    // No drift rows for party 1 (zero delta); decay still loses 0.004,
    // routed via 10% eligibility (party eligible at Org=30) — caught back
    // by itself, net zero. No party update emitted.
    expect(planned.partyUpdates.length).toBe(0);
  });

  it("does not overdraw an exhausted non-party pool (ticket #1133)", () => {
    // Iowa-shaped: one party still climbing toward Org, another holding durable
    // seed registration above Org, and the Independent/Unregistered buckets
    // already empty. Uncapped drift used to mint Reg out of nothing and push
    // the pool sum above 100.
    const parties = [makeRow("dem", 77.5, 60), makeRow("flp", 7.3, 40)];
    const pool = makePool(0, 0);
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "IA",
      parties,
      pool,
      turn: 211,
      now: new Date(),
    });
    if (!planned) throw new Error("expected plan");

    const regs = new Map(parties.map((p) => [p._id, p.registration ?? 0]));
    for (const u of planned.partyUpdates) regs.set(u.rowId, u.newReg);
    const total =
      [...regs.values()].reduce((s, v) => s + v, 0) +
      planned.poolUpdate.newIndependent +
      planned.poolUpdate.newUnregistered;
    expect(total).toBeCloseTo(100, 6);
    expect(planned.poolUpdate.newIndependent).toBeGreaterThanOrEqual(0);
    expect(planned.poolUpdate.newUnregistered).toBeGreaterThanOrEqual(0);
    // Empty pool → the climbing party cannot mint its drift step out of
    // nothing; it is sourced from FLP, whose Reg (40) sits far above its Org
    // (7.3). FLP gives up what DEM gains (plus a decay-catch sliver to DEM).
    const rate = PASSIVE_REG_DRIFT_RATE;
    expect(regs.get("state_dem")!).toBeGreaterThanOrEqual(60 + rate - 1e-9);
    expect(regs.get("state_dem")!).toBeLessThan(60 + rate + 0.01);
    expect(regs.get("state_flp")!).toBeLessThanOrEqual(40 - rate + 1e-9);
  });

  it("caps upward drift to remaining pool capacity", () => {
    // DEM wants a full drift step but only 0.02 pp is left in the pool.
    const parties = [makeRow("dem", 80, 50), makeRow("gop", 40, 49.98)];
    const pool = makePool(0.02, 0);
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "IA",
      parties,
      pool,
      turn: 100,
      now: new Date(),
    });
    if (!planned) throw new Error("expected plan");

    const regs = new Map(parties.map((p) => [p._id, p.registration ?? 0]));
    for (const u of planned.partyUpdates) regs.set(u.rowId, u.newReg);
    const total =
      [...regs.values()].reduce((s, v) => s + v, 0) +
      planned.poolUpdate.newIndependent +
      planned.poolUpdate.newUnregistered;
    expect(total).toBeCloseTo(100, 6);
    expect(planned.poolUpdate.newIndependent).toBeGreaterThanOrEqual(0);
    expect(planned.poolUpdate.newUnregistered).toBeGreaterThanOrEqual(0);
    // The pool is drained to zero first; the rest of the step comes from GOP,
    // whose Reg (49.98) sits above its Org (40). Nothing is minted.
    expect(planned.poolUpdate.newIndependent).toBeCloseTo(0, 6);
    const gopSourced = planned.ledgerRows.find(
      (r) => r.source === "drift" && r.partyId === "gop" && r.delta < 0
    );
    expect(gopSourced?.delta).toBeCloseTo(-(PASSIVE_REG_DRIFT_RATE - 0.02), 6);
  });

  it("does not drive one pool bucket negative when the other still has capacity", () => {
    // US bias pulls ~70% of a 0.06 draw from Independent (0.042) even when
    // Independent only has 0.01 left. The leftover must come from Unregistered
    // rather than going negative.
    const parties = [makeRow("dem", 80, 50), makeRow("gop", 40, 44.99)];
    const pool = makePool(0.01, 5);
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "IA",
      parties,
      pool,
      turn: 100,
      now: new Date(),
    });
    if (!planned) throw new Error("expected plan");
    expect(planned.poolUpdate.newIndependent).toBeGreaterThanOrEqual(0);
    expect(planned.poolUpdate.newUnregistered).toBeGreaterThanOrEqual(0);
    const regs = new Map(parties.map((p) => [p._id, p.registration ?? 0]));
    for (const u of planned.partyUpdates) regs.set(u.rowId, u.newReg);
    const total =
      [...regs.values()].reduce((s, v) => s + v, 0) +
      planned.poolUpdate.newIndependent +
      planned.poolUpdate.newUnregistered;
    expect(total).toBeCloseTo(100, 6);
  });

  it("renormalizes an existing over-100% pool (ticket #1133 Iowa)", () => {
    // Live Iowa at report time: DEM 52.9 + FLP 55.6 = 108.5, pool empty.
    const parties = [makeRow("dem", 77.5, 52.9), makeRow("flp", 7.3, 55.6)];
    const pool = makePool(0, 0);
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "IA",
      parties,
      pool,
      turn: 211,
      now: new Date(),
    });
    if (!planned) throw new Error("expected plan");

    const regs = new Map(parties.map((p) => [p._id, p.registration ?? 0]));
    for (const u of planned.partyUpdates) regs.set(u.rowId, u.newReg);
    const total =
      [...regs.values()].reduce((s, v) => s + v, 0) +
      planned.poolUpdate.newIndependent +
      planned.poolUpdate.newUnregistered;
    expect(total).toBeCloseTo(100, 6);
    expect(planned.poolUpdate.newIndependent).toBeGreaterThanOrEqual(0);
    expect(planned.poolUpdate.newUnregistered).toBeGreaterThanOrEqual(0);
    expect(planned.ledgerRows.some((r) => r.source === "renormalize")).toBe(true);
  });
});

describe("govHomeFieldNudge", () => {
  it("returns sign × HOME_FIELD_DRIFT_BONUS when well below the cap", () => {
    expect(govHomeFieldNudge(40, 2)).toBeCloseTo(2 * HOME_FIELD_DRIFT_BONUS, 9);
    expect(govHomeFieldNudge(40, 3)).toBeCloseTo(3 * HOME_FIELD_DRIFT_BONUS, 9);
  });

  it("clamps the nudge to the remaining headroom below the cap", () => {
    // 0.005 headroom < 3×0.01 nudge → clamp to 0.005.
    expect(govHomeFieldNudge(HOME_FIELD_REG_CAP - 0.005, 3)).toBeCloseTo(0.005, 9);
  });

  it("returns 0 once Reg is at or above the cap", () => {
    expect(govHomeFieldNudge(HOME_FIELD_REG_CAP, 3)).toBe(0);
    expect(govHomeFieldNudge(HOME_FIELD_REG_CAP + 5, 3)).toBe(0);
  });
});

describe("planStateRegDriftDecay — governor home-field", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("reduces the governor party's decay and nudges its Reg up vs. baseline", () => {
    const parties = [makeRow("3", 40, 49), makeRow("4", 30, 27)];
    const withGov = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties,
      pool: makePool(16, 8),
      turn: 100,
      now,
      governor: { partyId: "3", sign: 2 },
    });
    const withoutGov = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties,
      pool: makePool(16, 8),
      turn: 100,
      now,
    });
    const govWith = withGov!.partyUpdates.find((u) => u.rowId === "state_3")!;
    const govWithout = withoutGov!.partyUpdates.find((u) => u.rowId === "state_3")!;
    expect(govWith.newReg).toBeGreaterThan(govWithout.newReg);
  });

  it("keeps the pool sum at 100 after home-field is applied", () => {
    const parties = [makeRow("3", 40, 49), makeRow("4", 30, 27)];
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties,
      pool: makePool(16, 8), // 49 + 27 + 16 + 8 = 100
      turn: 100,
      now,
      governor: { partyId: "3", sign: 2 },
    })!;
    const regById = new Map<string, number>([
      ["state_3", 49],
      ["state_4", 27],
    ]);
    for (const u of planned.partyUpdates) regById.set(u.rowId, u.newReg);
    const partySum = [...regById.values()].reduce((s, v) => s + v, 0);
    const total = partySum + planned.poolUpdate.newIndependent + planned.poolUpdate.newUnregistered;
    expect(total).toBeCloseTo(100, 6);
  });

  it("no governor → identical to baseline (no-op)", () => {
    const parties = [makeRow("3", 40, 49), makeRow("4", 30, 27)];
    const a = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties,
      pool: makePool(16, 8),
      turn: 100,
      now,
      governor: null,
    })!;
    const b = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties,
      pool: makePool(16, 8),
      turn: 100,
      now,
    })!;
    expect(a.partyUpdates).toEqual(b.partyUpdates);
    expect(a.poolUpdate).toEqual(b.poolUpdate);
  });
});

describe("long-run durability — Solid South registration stays high", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("Mississippi 1953 DEM (org=38, reg=87) stays well above 70 after 654 turns", () => {
    // Simulate 654 hourly turns (~27 days) of drift+decay on Mississippi's
    // 1953 Solid South seed: DEM org=38, reg=87; REP org=8, reg=8.
    // With one-directional drift, reg above org produces no downward pull.
    // Decay (0.004/turn): DEM loses 0.004, REP loses 0.004. DEM is the only
    // eligible catcher (org=38 >= 10), so it catches ALL lost registration
    // (0.008) — net +0.004/turn for DEM. REP's loss routes to the pool.
    let demReg = 87;
    let repReg = 8;
    let indep = 3;
    let unreg = 25;

    for (let turn = 0; turn < 654; turn++) {
      const demLoss = Math.min(0.004, demReg);
      const repLoss = Math.min(0.004, repReg);
      const totalLost = demLoss + repLoss;

      // DEM is the only eligible catcher (org=38 >= 10).
      const demCatch = totalLost;

      demReg = demReg - demLoss + demCatch; // net +repLoss
      repReg = repReg - repLoss;

      // REP's decay routes to pool with US bias (70/30 Indep/Unreg).
      indep += repLoss * (7 / 10);
      unreg += repLoss * (3 / 10);
    }

    // DEM gains 654 × 0.004 = 2.616 from catching REP's decay.
    expect(demReg).toBeCloseTo(87 + 654 * 0.004, 5);
    expect(demReg).toBeGreaterThan(80);
    // REP loses 654 × 0.004 = 2.616 to the pool.
    expect(repReg).toBeCloseTo(8 - 654 * 0.004, 5);
  });

  it("Alabama 1953 DEM (org=36, reg=84) stays well above 70 after 654 turns", () => {
    let demReg = 84;
    let repReg = 10;
    let indep = 3;
    let unreg = 22;

    for (let turn = 0; turn < 654; turn++) {
      const demLoss = Math.min(0.004, demReg);
      const repLoss = Math.min(0.004, repReg);
      const totalLost = demLoss + repLoss;

      const demCatch = totalLost;

      demReg = demReg - demLoss + demCatch;
      repReg = repReg - repLoss;

      indep += repLoss * (7 / 10);
      unreg += repLoss * (3 / 10);
    }

    expect(demReg).toBeCloseTo(84 + 654 * 0.004, 5);
    expect(demReg).toBeGreaterThan(80);
  });

  it("Solid South registration does not slide toward 50% over 654 turns", () => {
    // With the old bidirectional drift, DEM would lose 0.06/turn toward org=38,
    // losing 39.2 pp over 654 turns → 47.8. With one-directional drift, DEM
    // stays at 87 (and even gains slightly from catching REP's decay).
    let demReg = 87;
    let repReg = 8;

    for (let turn = 0; turn < 654; turn++) {
      const demLoss = Math.min(0.004, demReg);
      const repLoss = Math.min(0.004, repReg);
      const totalLost = demLoss + repLoss;

      const demCatch = totalLost;

      demReg = demReg - demLoss + demCatch;
      repReg = repReg - repLoss;
    }

    // DEM should still be well above 80, not sliding toward 50.
    expect(demReg).toBeGreaterThan(80);
    // DEM should be close to 87 + 2.616 = 89.616
    expect(demReg).toBeCloseTo(87 + 654 * 0.004, 3);
  });
});

describe("planStateRegDriftDecay — surplus sourcing when the pool is empty", () => {
  const now = new Date("2026-08-30T12:00:00Z");

  /** Georgia at live turn 499: seeded Solid South Reg, player-built Org. */
  const georgia = () => [
    makeRow("dem", 13.51, 77.432),
    makeRow("flp", 7.41, 21.328),
    makeRow("cup", 39.21, 0.196),
    makeRow("gop", 38.31, 1.044),
  ];

  function applyPlan(
    parties: StatePartyOrg[],
    pool: StateRegistrationPool,
    planned: ReturnType<typeof planStateRegDriftDecay>
  ): { parties: StatePartyOrg[]; pool: StateRegistrationPool } {
    if (!planned) throw new Error("expected plan");
    const next = parties.map((p) => ({ ...p }));
    for (const u of planned.partyUpdates) {
      const row = next.find((p) => p._id === u.rowId);
      if (row) row.registration = u.newReg;
    }
    return {
      parties: next,
      pool: {
        ...pool,
        independent: planned.poolUpdate.newIndependent,
        unregistered: planned.poolUpdate.newUnregistered,
      },
    };
  }

  function simulate(
    parties: StatePartyOrg[],
    pool: StateRegistrationPool,
    turns: number,
    governor?: { partyId: string; sign: 1 | 2 | 3 }
  ) {
    let state = { parties, pool };
    for (let turn = 1; turn <= turns; turn++) {
      const planned = planStateRegDriftDecay({
        countryId: "US",
        stateId: "GA",
        parties: state.parties,
        pool: state.pool,
        turn,
        now,
        governor,
      });
      state = applyPlan(state.parties, state.pool, planned);
    }
    return state;
  }

  const regOf = (parties: StatePartyOrg[], partyId: string) =>
    parties.find((p) => p.partyId === partyId)!.registration ?? 0;

  const poolTotal = (s: { parties: StatePartyOrg[]; pool: StateRegistrationPool }) =>
    s.parties.reduce((sum, p) => sum + (p.registration ?? 0), 0) +
    s.pool.independent +
    s.pool.unregistered;

  it("sources the climbing parties' drift from parties whose Reg exceeds Org", () => {
    const parties = georgia();
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "GA",
      parties,
      pool: makePool(0, 0),
      turn: 500,
      now,
    });
    const after = applyPlan(parties, makePool(0, 0), planned);

    // Both organised challengers get their full per-turn drift even though the
    // non-party pool is empty (a decay-catch sliver may add to that).
    const rate = PASSIVE_REG_DRIFT_RATE;
    expect(regOf(after.parties, "gop")).toBeGreaterThanOrEqual(1.044 + rate - 0.005);
    expect(regOf(after.parties, "cup")).toBeGreaterThanOrEqual(0.196 + rate - 0.005);
    // The over-registered incumbents supplied it.
    expect(regOf(after.parties, "dem")).toBeLessThan(77.432 - 0.08);
    expect(regOf(after.parties, "flp")).toBeLessThan(21.328 - 0.01);
    // Invariants: pool sum 100, buckets never negative.
    expect(poolTotal(after)).toBeCloseTo(100, 6);
    expect(after.pool.independent).toBeGreaterThanOrEqual(0);
    expect(after.pool.unregistered).toBeGreaterThanOrEqual(0);
  });

  it("splits the sourced amount across surplus parties in proportion to (Reg − Org)", () => {
    // Surplus 30 vs 10 → the first party supplies 3× as much as the second.
    const parties = [makeRow("a", 10, 40), makeRow("b", 10, 20), makeRow("c", 40, 0)];
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "GA",
      parties,
      pool: makePool(0, 0),
      turn: 500,
      now,
    });
    if (!planned) throw new Error("expected plan");
    const sourced = planned.ledgerRows.filter(
      (r) => r.source === "drift" && r.metric === "reg" && r.delta < 0
    );
    const a = sourced.find((r) => r.partyId === "a")!.delta;
    const b = sourced.find((r) => r.partyId === "b")!.delta;
    expect(a / b).toBeCloseTo(3, 6);
    expect(a + b).toBeCloseTo(-PASSIVE_REG_DRIFT_RATE, 6);
  });

  it("draws the pool first and sources only the shortfall from surplus", () => {
    const parties = [makeRow("a", 10, 40), makeRow("c", 40, 0)];
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "GA",
      parties,
      pool: makePool(0.02, 0),
      turn: 500,
      now,
    });
    if (!planned) throw new Error("expected plan");
    expect(planned.poolUpdate.newIndependent).toBeCloseTo(0, 6);
    const sourced = planned.ledgerRows.find(
      (r) => r.source === "drift" && r.partyId === "a" && r.delta < 0
    );
    expect(sourced?.delta).toBeCloseTo(-(PASSIVE_REG_DRIFT_RATE - 0.02), 6);
  });

  it("the governor's party supplies less of the shortfall (home-field relief)", () => {
    const parties = [makeRow("a", 10, 40), makeRow("b", 10, 40), makeRow("c", 40, 0)];
    const withGov = planStateRegDriftDecay({
      countryId: "US",
      stateId: "GA",
      parties,
      pool: makePool(0, 0),
      turn: 500,
      now,
      governor: { partyId: "a", sign: 2 },
    });
    if (!withGov) throw new Error("expected plan");
    const sourcedA = withGov.ledgerRows.find(
      (r) => r.source === "drift" && r.partyId === "a" && r.delta < 0
    )!.delta;
    const sourcedB = withGov.ledgerRows.find(
      (r) => r.source === "drift" && r.partyId === "b" && r.delta < 0
    )!.delta;
    // Equal surplus; governor at sign 2 contributes at (1 − 0.5) weight.
    expect(sourcedA / sourcedB).toBeCloseTo(0.5, 6);
    expect(sourcedA + sourcedB).toBeCloseTo(-PASSIVE_REG_DRIFT_RATE, 6);
  });

  it("never sources below a party's Org (surplus is the ceiling)", () => {
    // Surplus of only 0.03 available; climber wants a full step → gets 0.03.
    const parties = [makeRow("a", 10, 10.03), makeRow("c", 40, 0)];
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "GA",
      parties,
      pool: makePool(0, 0),
      turn: 500,
      now,
    });
    if (!planned) throw new Error("expected plan");
    // The drift ledger row shows exactly the surplus leaving `a`, landing it on
    // its Org; the ordinary decay step afterwards is unchanged and out of scope.
    const sourced = planned.ledgerRows.find(
      (r) => r.source === "drift" && r.partyId === "a" && r.delta < 0
    );
    expect(sourced?.delta).toBeCloseTo(-0.03, 9);
    expect(sourced?.value).toBeCloseTo(10, 9);
    const climbed = planned.ledgerRows.find(
      (r) => r.source === "drift" && r.partyId === "c" && r.delta > 0
    );
    expect(climbed?.delta).toBeCloseTo(0.03, 9);
  });

  it("a challenged stronghold falls to Lean in roughly the 200-turn design target", () => {
    const after = simulate(georgia(), makePool(0, 0), 200, { partyId: "dem", sign: 2 });
    const dem = regOf(after.parties, "dem");
    // ~0.10 pp/turn sourced from DEM: 77 → high-50s. Band is deliberately wide.
    expect(dem).toBeLessThan(63);
    expect(dem).toBeGreaterThan(50);
    expect(regOf(after.parties, "gop")).toBeGreaterThan(10);
    expect(regOf(after.parties, "cup")).toBeGreaterThan(10);
    expect(poolTotal(after)).toBeCloseTo(100, 4);
  });

  it("an unchallenged stronghold with an empty pool does not move", () => {
    // Nobody is below their Org, so there is no drift to source: seeded
    // registration stays durable exactly as before.
    const parties = [makeRow("dem", 38, 92), makeRow("rep", 8, 8)];
    const after = simulate(parties, makePool(0, 0), 654);
    expect(regOf(after.parties, "dem")).toBeGreaterThanOrEqual(92);
  });
});
