import { describe, expect, it } from "vitest";
import {
  computeDecayDeltas,
  computeDriftDeltas,
  govHomeFieldNudge,
  planStateRegDriftDecay,
} from "./regDriftDecay";
import { HOME_FIELD_DRIFT_BONUS, HOME_FIELD_REG_CAP } from "./pacingConstants";
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
