import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  PRIMARY_VOTE_SUPPRESSION_FLOOR,
  PRIMARY_VOTE_SUPPRESSION_PCT,
  stateAttackMultiplier,
  stateFavorabilityDeltas,
  stateFavorabilityPenalty,
} from "./constants";
import type { PrimaryStateAction } from "@/lib/db/types";

const TARGET = new ObjectId();
const OTHER = new ObjectId();

function row(over: Partial<PrimaryStateAction> = {}): PrimaryStateAction {
  return {
    _id: new ObjectId(),
    electionId: new ObjectId(),
    actorCandidateId: new ObjectId(),
    targetCandidateId: TARGET,
    targetCharacterId: new ObjectId(),
    stateId: "IA",
    kind: "voteSuppression",
    magnitude: PRIMARY_VOTE_SUPPRESSION_PCT,
    shieldApplied: 0,
    appliedTurn: 10,
    expiresTurn: 18,
    createdAt: new Date(),
    ...over,
  } as PrimaryStateAction;
}

const ask = (actions: PrimaryStateAction[]) =>
  stateAttackMultiplier({
    actions,
    candidateId: TARGET.toString(),
    stateId: "IA",
    currentTurn: 12,
  });

describe("stateAttackMultiplier", () => {
  it("is exactly 1 with no rows", () => {
    // The no-op guarantee: the vote path must be byte-identical for every
    // candidate nobody has attacked.
    expect(ask([])).toBe(1);
  });

  it("is exactly 1 for a row aimed at someone else", () => {
    expect(ask([row({ targetCandidateId: OTHER })])).toBe(1);
  });

  it("is exactly 1 for a row in another state", () => {
    expect(ask([row({ stateId: "NH" })])).toBe(1);
  });

  it("is exactly 1 for a favourability attack, which campaignTurn already applies", () => {
    // Applying it here as well would charge one purchase to two mechanics.
    expect(ask([row({ kind: "localFavorability" })])).toBe(1);
  });

  it("is exactly 1 for a row that has expired", () => {
    // expiresTurn is exclusive, matching liveActionFilter: a row expiring on
    // turn 12 is live on 11 and gone on 12.
    expect(ask([row({ expiresTurn: 12 })])).toBe(1);
  });

  it("removes the row's magnitude from the target's vote", () => {
    expect(ask([row({ magnitude: 2.5 })])).toBeCloseTo(0.975, 6);
  });

  it("keeps the shield stamped at purchase rather than re-applying one", () => {
    expect(ask([row({ magnitude: 2.5, shieldApplied: 0.4 })])).toBeCloseTo(0.985, 6);
  });

  it("stacks several attackers", () => {
    expect(ask([row({ magnitude: 2.5 }), row({ magnitude: 2.5 })])).toBeCloseTo(0.95, 6);
  });

  it("floors the combined hit however many rivals converge", () => {
    // The one-live-attack-per-pair rule limits a single attacker. Nothing
    // limited the field until this floor did.
    const many = Array.from({ length: 20 }, () => row({ magnitude: 2.5 }));
    expect(ask(many)).toBe(PRIMARY_VOTE_SUPPRESSION_FLOOR);
  });
});

describe("stateFavorabilityPenalty", () => {
  const ask = (actions: PrimaryStateAction[], stateId = "IA") =>
    stateFavorabilityPenalty({
      actions,
      candidateId: TARGET.toString(),
      stateId,
      currentTurn: 12,
    });

  it("is zero with no rows", () => {
    expect(ask([])).toBe(0);
  });

  it("only counts the state it was bought in", () => {
    // The whole point of the rework: an attack bought in Iowa used to move
    // every state in the country, because the drain fed the national scalar.
    const iowaAttack = [row({ kind: "localFavorability", stateId: "IA", magnitude: 6 })];
    expect(ask(iowaAttack, "IA")).toBe(6);
    expect(ask(iowaAttack, "NH")).toBe(0);
  });

  it("ignores vote suppression, which the multiplier applies instead", () => {
    expect(ask([row({ kind: "voteSuppression", magnitude: 2.5 })])).toBe(0);
  });

  it("ignores an expired row", () => {
    expect(ask([row({ kind: "localFavorability", magnitude: 6, expiresTurn: 12 })])).toBe(0);
  });

  it("keeps the shield stamped at purchase", () => {
    expect(ask([row({ kind: "localFavorability", magnitude: 6, shieldApplied: 0.5 })])).toBe(3);
  });

  it("stacks several attackers in the same state", () => {
    expect(
      ask([
        row({ kind: "localFavorability", magnitude: 6 }),
        row({ kind: "localFavorability", magnitude: 6 }),
      ])
    ).toBe(12);
  });
});

describe("stateFavorabilityDeltas", () => {
  it("is undefined when nobody is under attack there, so the option is a no-op", () => {
    expect(
      stateFavorabilityDeltas({
        actions: [],
        candidateIds: [TARGET.toString(), OTHER.toString()],
        stateId: "IA",
        currentTurn: 12,
      })
    ).toBeUndefined();
  });

  it("names only the attacked candidate, and negatively", () => {
    expect(
      stateFavorabilityDeltas({
        actions: [row({ kind: "localFavorability", magnitude: 6 })],
        candidateIds: [TARGET.toString(), OTHER.toString()],
        stateId: "IA",
        currentTurn: 12,
      })
    ).toEqual({ [TARGET.toString()]: -6 });
  });
});
