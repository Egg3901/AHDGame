import { describe, expect, it } from "vitest";
import { resetCabinetActions } from "../catalog";
import {
  actionEligibility,
  actionOperatingCost,
  activateAction,
  combineActiveActionEffects,
  mergeApplicableActionEffects,
  rechargeActionCharges,
  useCabinetAction,
} from "./actions";

const ops = resetCabinetActions.find((action) => action.id === "US:secretary_of_state:1")!;
const staff = resetCabinetActions.find((action) => action.id === "US:secretary_of_state:2")!;

function eligibleInput(action = ops) {
  return {
    action,
    turn: 10,
    seatActive: true,
    legalAuthority: true,
    capacityAvailable: true,
    charges: 4,
    annualNationalGdp: 1_000_000_000_000,
    flexibleOperatingFunds: 100_000_000,
    active: [],
    history: [],
  };
}

describe("reset ministerial action rules", () => {
  it("recharges by game turn up to four, independently of offices held", () => {
    expect(rechargeActionCharges(1, 0, 23)).toMatchObject({ charges: 1, nextRechargeTurn: 24 });
    expect(rechargeActionCharges(1, 0, 48)).toMatchObject({ charges: 3, lastRechargeTurn: 48 });
    expect(rechargeActionCharges(1, 0, 240)).toMatchObject({ charges: 4 });
    expect(() => rechargeActionCharges(5, 0, 1)).toThrow();
  });
  it("charges the correct one-time operating amount and expires on schedule", () => {
    expect(actionEligibility(eligibleInput())).toMatchObject({
      allowed: true,
      operatingCost: 10_000_000,
      durationTurns: 24,
      expiresTurn: 34,
    });
    expect(actionEligibility(eligibleInput(staff))).toMatchObject({
      allowed: true,
      operatingCost: 0,
      durationTurns: 12,
      expiresTurn: 22,
    });
    expect(activateAction(ops, 10).expiresTurn).toBe(34);
    expect(actionOperatingCost(ops, 1_000_000_000_001)).toBe(10_000_000);
  });

  it("blocks missing authority, capacity, cash, charges, and a busy office independently", () => {
    const input = eligibleInput();
    expect(actionEligibility({ ...input, legalAuthority: false }).reason).toBe("no_authority");
    expect(actionEligibility({ ...input, capacityAvailable: false }).reason).toBe("no_capacity");
    expect(actionEligibility({ ...input, flexibleOperatingFunds: 0 }).reason).toBe(
      "insufficient_funds"
    );
    expect(actionEligibility({ ...input, charges: 0 }).reason).toBe("no_charges");
    expect(() => actionEligibility({ ...input, charges: 5 })).toThrow();
    expect(actionEligibility({ ...input, active: [activateAction(ops, 9)] }).reason).toBe(
      "seat_busy"
    );
  });

  it("uses per-office cooldown, not a country-wide concurrent-action cap", () => {
    const input = eligibleInput();
    const prior = activateAction(ops, 0);
    expect(actionEligibility({ ...input, turn: 24, history: [prior] }).reason).toBe("cooldown");
    expect(actionEligibility({ ...input, turn: 48, history: [prior] }).allowed).toBe(true);
    const otherOffice = resetCabinetActions.find(
      (action) => action.id === "US:secretary_of_treasury:1"
    )!;
    expect(
      actionEligibility({
        ...input,
        action: otherOffice,
        turn: 10,
        active: [prior],
        history: [prior],
      }).allowed
    ).toBe(true);
    const fiveOtherOffices = resetCabinetActions
      .filter((action) => action.country === "US" && action.seatId !== otherOffice.seatId)
      .filter(
        (action, index, all) =>
          all.findIndex((candidate) => candidate.seatId === action.seatId) === index
      )
      .slice(0, 5)
      .map((action) => activateAction(action, 9));
    expect(
      actionEligibility({ ...input, action: otherOffice, active: fiveOtherOffices }).allowed
    ).toBe(true);
  });

  it("spends one shared actor charge while another office remains eligible", () => {
    const first = useCabinetAction({
      ...eligibleInput(),
      actor: { charges: 2, lastRechargeTurn: 0 },
    });
    expect(first).toMatchObject({
      allowed: true,
      actor: { charges: 1 },
      operatingDebit: 10_000_000,
    });
    if (!first.allowed) throw new Error("first action should be allowed");
    const otherOffice = resetCabinetActions.find(
      (action) => action.id === "US:secretary_of_treasury:1"
    )!;
    const second = useCabinetAction({
      ...eligibleInput(otherOffice),
      actor: first.actor,
      active: first.active,
      history: first.history,
    });
    expect(second).toMatchObject({ allowed: true, actor: { charges: 0 } });
    expect(second.active).toHaveLength(2);
    expect(second.history).toHaveLength(2);
  });

  it("recharges on a blocked attempt but never spends or creates an action", () => {
    const denied = useCabinetAction({
      ...eligibleInput(),
      turn: 48,
      actor: { charges: 0, lastRechargeTurn: 0 },
      legalAuthority: false,
    });
    expect(denied).toMatchObject({
      allowed: false,
      reason: "no_authority",
      actor: { charges: 2, lastRechargeTurn: 48 },
      operatingDebit: 0,
      active: [],
      history: [],
    });
  });

  it("diminishes same-target help and caps the combined temporary effect", () => {
    const first = { ...activateAction(ops, 0), target: "M38+M57", strength: 0.14 };
    const second = { ...first, actionId: "other", seatId: "other", strength: 0.12 };
    const third = { ...first, actionId: "third", seatId: "third", strength: 0.14 };
    expect(
      combineActiveActionEffects([first, second], 1).find((effect) => effect.target === "M38")
        ?.favorableNormalizedPoints
    ).toBeCloseTo(0.17);
    expect(
      combineActiveActionEffects([first, second, third], 1).find(
        (effect) => effect.target === "M38"
      )?.favorableNormalizedPoints
    ).toBe(0.2);
    expect(
      combineActiveActionEffects([first], 1).find((effect) => effect.target === "M57")
        ?.favorableNormalizedPoints
    ).toBeCloseTo(0.07);
    expect(combineActiveActionEffects([first], 24)).toEqual([]);
    expect(
      combineActiveActionEffects([first, first], 1).find((effect) => effect.target === "M38")
        ?.favorableNormalizedPoints
    ).toBeCloseTo(0.14);
  });

  it("never stacks one country's actions into another country's metric", () => {
    const us = { ...activateAction(ops, 0), target: "M47", strength: 0.14 };
    const uk = { ...us, country: "UK" as const, actionId: "UK:other:1" };
    const effects = combineActiveActionEffects([us, uk], 1);
    expect(effects).toHaveLength(2);
    expect(effects.map((effect) => effect.favorableNormalizedPoints)).toEqual([0.14, 0.14]);
  });

  it("combines applicable national and regional effects without losing either scope", () => {
    expect(
      mergeApplicableActionEffects([
        {
          country: "UK",
          scope: "Nat",
          target: "M38",
          favorableNormalizedPoints: 0.14,
          contributingActions: ["national"],
        },
        {
          country: "UK",
          scope: "SCT",
          target: "M38",
          favorableNormalizedPoints: 0.1,
          contributingActions: ["regional", "national"],
        },
      ])
    ).toEqual([
      {
        target: "M38",
        favorableNormalizedPoints: 0.2,
        contributingActions: ["national", "regional"],
      },
    ]);
  });

  it("rejects non-finite effect strength before it can poison a metric", () => {
    expect(() => activateAction({ ...ops, strength: Number.NaN }, 1)).toThrow();
    expect(() =>
      combineActiveActionEffects([{ ...activateAction(ops, 1), strength: Number.NaN }], 1)
    ).toThrow();
  });
});
