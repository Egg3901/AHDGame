import { describe, expect, it } from "vitest";
import type { SettlementSeatState } from "@/lib/db/types/settlementCrisis";
import { getPlay, getSeat } from "@/lib/constants/settlementCrisis";
import { canCharacterAfford, canSeatAfford, seatBudgetFor } from "./affordability";

const ddState: SettlementSeatState = {
  id: "DD",
  capital: 20,
  actions: 3,
  lastActedTurn: null,
  committedPoints: 0,
};

describe("seatBudgetFor", () => {
  it("reports the BANK, not a per-turn allowance", () => {
    expect(seatBudgetFor({ ...ddState, actions: 1 }, "DD")).toEqual({
      actionsPerTurn: 3,
      actionsRemaining: 1,
      actionsBankCap: 9,
      capital: 20,
    });
  });

  it("lets a saved bank exceed the per-turn grant", () => {
    // The whole point of banking: a secondary saves for a play it cannot
    // afford out of one turn's income.
    const saved = seatBudgetFor({ ...ddState, id: "RU", actions: 2 }, "RU");
    expect(saved.actionsPerTurn).toBe(1);
    expect(saved.actionsRemaining).toBe(2);
  });

  it("never reports negative remaining actions", () => {
    expect(seatBudgetFor({ ...ddState, actions: -4 }, "DD").actionsRemaining).toBe(0);
  });

  it("reads an empty bank for a document written before banking existed", () => {
    const legacy = { ...ddState } as Partial<SettlementSeatState>;
    delete legacy.actions;
    expect(seatBudgetFor(legacy as SettlementSeatState, "DD").actionsRemaining).toBe(0);
  });

  it("reports a zero allowance for an unknown seat rather than guessing one", () => {
    expect(seatBudgetFor({ ...ddState, id: "ZZ" as never }, "ZZ" as never)).toEqual({
      actionsPerTurn: 0,
      actionsRemaining: 3,
      actionsBankCap: 0,
      capital: 20,
    });
  });
});

describe("canSeatAfford", () => {
  const budget = seatBudgetFor(ddState, "DD");

  it("allows a play inside every budget", () => {
    // `aid`: 1 AP, 0 capital, ℳ45M.
    expect(canSeatAfford(getPlay("aid")!, budget, 100_000_000)).toEqual({ ok: true });
  });

  it("refuses a play the seat cannot action", () => {
    const spent = seatBudgetFor({ ...ddState, actions: 0 }, "DD");
    expect(canSeatAfford(getPlay("aid")!, spent, 1e12)).toEqual({
      ok: false,
      reason: "actions",
    });
  });

  it("refuses a play the seat cannot fund from capital", () => {
    // `referendum`: 22 capital against a 20-point bank.
    expect(canSeatAfford(getPlay("referendum")!, budget, 1e12)).toEqual({
      ok: false,
      reason: "capital",
    });
  });

  it("refuses a play the treasury cannot cover", () => {
    expect(canSeatAfford(getPlay("aid")!, budget, 1_000)).toEqual({
      ok: false,
      reason: "funds",
    });
  });

  it("allows a play costing exactly what is left", () => {
    const exact = seatBudgetFor({ ...ddState, capital: 22, actions: 3 }, "DD");
    expect(canSeatAfford(getPlay("referendum")!, exact, 30_000_000)).toEqual({ ok: true });
  });

  it("reports the action shortfall before the capital one", () => {
    // Deterministic ordering matters: the UI shows one reason, not a set.
    const broke = seatBudgetFor({ ...ddState, capital: 0, actions: 0 }, "DD");
    expect(canSeatAfford(getPlay("referendum")!, broke, 0).reason).toBe("actions");
  });

  it("reports the capital shortfall before the funds one", () => {
    const noCapital = seatBudgetFor({ ...ddState, capital: 0 }, "DD");
    expect(canSeatAfford(getPlay("referendum")!, noCapital, 0).reason).toBe("capital");
  });
});

describe("canCharacterAfford", () => {
  it("spends the character's own actions, not a seat budget", () => {
    // `rally`: 2 AP and $5k of personal funds.
    expect(canCharacterAfford(getPlay("rally")!, 2, 10_000)).toEqual({ ok: true });
    expect(canCharacterAfford(getPlay("rally")!, 1, 10_000)).toEqual({
      ok: false,
      reason: "actions",
    });
    expect(canCharacterAfford(getPlay("rally")!, 2, 100)).toEqual({
      ok: false,
      reason: "funds",
    });
  });

  it("ignores capital cost entirely — no personal play has one", () => {
    for (const id of ["oped", "rally", "letter"]) {
      expect(getPlay(id)!.capitalCost).toBe(0);
    }
    expect(canCharacterAfford(getPlay("oped")!, 1, 0)).toEqual({ ok: true });
  });

  it("refuses a character with no actions left", () => {
    expect(canCharacterAfford(getPlay("oped")!, 0, 0)).toEqual({
      ok: false,
      reason: "actions",
    });
  });
});

describe("config sanity", () => {
  it("gives DD the action allowance the budget helper assumes", () => {
    expect(getSeat("DD")!.actionsPerTurn).toBe(3);
  });
});
