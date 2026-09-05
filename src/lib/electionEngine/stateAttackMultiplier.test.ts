import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  PRIMARY_VOTE_SUPPRESSION_FLOOR,
  PRIMARY_VOTE_SUPPRESSION_PCT,
  stateAttackMultiplier,
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
