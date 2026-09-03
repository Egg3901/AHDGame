import { describe, expect, it } from "vitest";
import {
  decideRolloutChange,
  rollbackConditions,
  type RolloutEvidence,
  type RolloutState,
} from "@/lib/banking/rules/rollout";

const clean = (turn = 100): RolloutEvidence => ({
  gateOk: true,
  gateReasons: [],
  currentTurn: turn,
  comparison: {
    turn,
    currencies: [
      {
        currency: "USD",
        legacyOwnerTotal: 1_000,
        accountOwnerTotal: 1_000,
        rowDiscrepancies: 0,
        discrepancies: 0,
      },
      {
        currency: "GBP",
        legacyOwnerTotal: 500,
        accountOwnerTotal: 400,
        rowDiscrepancies: 3,
        discrepancies: 4,
      },
    ],
  },
});

describe("decideRolloutChange", () => {
  it("always allows narrowing, and a rollback below authoritative clears the cohort", () => {
    const state: RolloutState = { mode: "authoritative", readCurrencies: ["USD"] };
    const closed = { ...clean(), gateOk: false, gateReasons: ["3 estates stuck"] };
    const toShadow = decideRolloutChange(state, { kind: "mode", mode: "shadow" }, closed);
    expect(toShadow).toMatchObject({
      allowed: true,
      direction: "narrow",
      next: { mode: "shadow", readCurrencies: [] },
    });
    const drop = decideRolloutChange(
      state,
      { kind: "remove_read_currency", currency: "USD" },
      closed
    );
    expect(drop).toMatchObject({
      allowed: true,
      direction: "narrow",
      next: { readCurrencies: [] },
    });
  });

  it("lets shadow on freely and requires evidence for authoritative", () => {
    expect(
      decideRolloutChange(
        { mode: "off", readCurrencies: [] },
        { kind: "mode", mode: "shadow" },
        clean()
      )
    ).toMatchObject({ allowed: true, direction: "widen" });
    // Off to authoritative skips the comparison.
    const jump = decideRolloutChange(
      { mode: "off", readCurrencies: [] },
      { kind: "mode", mode: "authoritative" },
      clean()
    );
    expect(jump.allowed).toBe(false);
    expect(jump.reasons.join(" ")).toMatch(/reached from shadow/);
    // Shadow to authoritative with a dirty currency anywhere is refused.
    const dirty = decideRolloutChange(
      { mode: "shadow", readCurrencies: [] },
      { kind: "mode", mode: "authoritative" },
      clean()
    );
    expect(dirty.allowed).toBe(false);
    expect(dirty.reasons.join(" ")).toMatch(/GBP/);
    // Clean everywhere, gate open, fresh: allowed.
    const evidence = clean();
    evidence.comparison!.currencies[1].discrepancies = 0;
    expect(
      decideRolloutChange(
        { mode: "shadow", readCurrencies: [] },
        { kind: "mode", mode: "authoritative" },
        evidence
      )
    ).toMatchObject({ allowed: true, next: { mode: "authoritative" } });
    // A stale comparison is no evidence.
    const stale = { ...evidence, currentTurn: 105 };
    expect(
      decideRolloutChange(
        { mode: "shadow", readCurrencies: [] },
        { kind: "mode", mode: "authoritative" },
        stale
      ).reasons.join(" ")
    ).toMatch(/No comparison/);
    // A closed gate is refused with its reasons.
    const closed = { ...evidence, gateOk: false, gateReasons: ["2 settlement(s) unfinished"] };
    expect(
      decideRolloutChange(
        { mode: "shadow", readCurrencies: [] },
        { kind: "mode", mode: "authoritative" },
        closed
      ).reasons.join(" ")
    ).toMatch(/Gate closed: 2 settlement/);
  });

  it("admits a currency to the read cohort only when migrated and clean", () => {
    const state: RolloutState = { mode: "authoritative", readCurrencies: [] };
    expect(
      decideRolloutChange(state, { kind: "add_read_currency", currency: "USD" }, clean())
    ).toMatchObject({ allowed: true, next: { readCurrencies: ["USD"] }, direction: "widen" });
    const gbp = decideRolloutChange(state, { kind: "add_read_currency", currency: "GBP" }, clean());
    expect(gbp.allowed).toBe(false);
    expect(gbp.reasons.join(" ")).toMatch(/discrepanc/);
    expect(gbp.reasons.join(" ")).toMatch(/run the migration first/);
    const unknown = decideRolloutChange(
      state,
      { kind: "add_read_currency", currency: "JPY" },
      clean()
    );
    expect(unknown.reasons.join(" ")).toMatch(/no JPY rows/);
    const shadowState: RolloutState = { mode: "shadow", readCurrencies: [] };
    expect(
      decideRolloutChange(
        shadowState,
        { kind: "add_read_currency", currency: "USD" },
        clean()
      ).reasons.join(" ")
    ).toMatch(/authoritative mode only/);
    // Already in: a no-op, allowed.
    expect(
      decideRolloutChange(
        { mode: "authoritative", readCurrencies: ["USD"] },
        { kind: "add_read_currency", currency: "USD" },
        clean()
      )
    ).toMatchObject({ allowed: true, direction: "none" });
  });
});

describe("rollbackConditions", () => {
  it("names the drift, the stuck estate and the stale record with the narrowest fix", () => {
    const state: RolloutState = { mode: "authoritative", readCurrencies: ["GBP"] };
    const evidence: RolloutEvidence = {
      ...clean(),
      gateOk: false,
      gateReasons: [
        "1 estate(s) claimed on earlier turns are still in resolution",
        "2 settlement(s) from earlier turns are unfinished (oldest x)",
      ],
    };
    const conditions = rollbackConditions(state, evidence);
    expect(conditions.map((c) => c.code)).toEqual([
      "cohort_drift",
      "stuck_estate",
      "stale_unfinished",
    ]);
    expect(conditions[0].suggested).toEqual({ kind: "remove_read_currency", currency: "GBP" });
    expect(conditions[2].suggested).toEqual({ kind: "mode", mode: "shadow" });
    expect(rollbackConditions({ mode: "off", readCurrencies: [] }, evidence)).toEqual([]);
    expect(
      rollbackConditions(
        { mode: "authoritative", readCurrencies: [] },
        { ...clean(), comparison: null }
      )[0]
    ).toMatchObject({ code: "comparison_missing" });
  });
});
