import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { liveActionFilter, localFavorabilityDrainByTarget } from "./primaryStateActions";
import type { PrimaryStateAction } from "@/lib/db/types";

const ELECTION = new ObjectId();

function action(over: Partial<PrimaryStateAction> = {}): PrimaryStateAction {
  return {
    _id: new ObjectId(),
    electionId: ELECTION,
    actorCandidateId: new ObjectId(),
    targetCandidateId: new ObjectId(),
    targetCharacterId: new ObjectId(),
    stateId: "IA",
    kind: "localFavorability",
    magnitude: 0.4,
    shieldApplied: 0,
    appliedTurn: 10,
    expiresTurn: 18,
    createdAt: new Date(),
    ...over,
  };
}

describe("liveActionFilter", () => {
  it("asks only for rows that have not expired", () => {
    const filter = liveActionFilter(ELECTION, 12);
    expect(filter.electionId).toBe(ELECTION);
    expect(filter.expiresTurn).toEqual({ $gt: 12 });
  });
});

describe("localFavorabilityDrainByTarget", () => {
  it("keys on the character id, which is what the favourability map expects", () => {
    // campaignTurn resolves its keys against characters/npps. Keying on the
    // candidate row id would charge the player and move nobody.
    const character = new ObjectId();
    const drain = localFavorabilityDrainByTarget([
      action({ targetCandidateId: new ObjectId(), targetCharacterId: character }),
    ]);
    expect(drain.get(character.toString())).toBeCloseTo(0.4, 5);
  });

  it("sums a target's drain across the states they are being hit in", () => {
    const target = new ObjectId();
    const drain = localFavorabilityDrainByTarget([
      action({ targetCharacterId: target, stateId: "IA" }),
      action({ targetCharacterId: target, stateId: "NH" }),
    ]);
    expect(drain.get(target.toString())).toBeCloseTo(0.8, 5);
  });

  it("applies the shield that was stamped at purchase", () => {
    const target = new ObjectId();
    const drain = localFavorabilityDrainByTarget([
      action({ targetCharacterId: target, shieldApplied: 0.25 }),
    ]);
    expect(drain.get(target.toString())).toBeCloseTo(0.3, 5);
  });

  it("keeps each target's drain to itself", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const drain = localFavorabilityDrainByTarget([
      action({ targetCharacterId: a }),
      action({ targetCharacterId: b, magnitude: 1 }),
    ]);
    expect(drain.get(a.toString())).toBeCloseTo(0.4, 5);
    expect(drain.get(b.toString())).toBeCloseTo(1, 5);
  });

  it("ignores kinds that do not drain favourability", () => {
    const target = new ObjectId();
    const drain = localFavorabilityDrainByTarget([
      action({ targetCharacterId: target, kind: "voteSuppression" }),
    ]);
    expect(drain.has(target.toString())).toBe(false);
  });

  it("returns an empty map for no actions", () => {
    expect(localFavorabilityDrainByTarget([]).size).toBe(0);
  });

  it("reports nothing for a shield that absorbed the whole hit", () => {
    const target = new ObjectId();
    const drain = localFavorabilityDrainByTarget([
      action({ targetCharacterId: target, shieldApplied: 1 }),
    ]);
    expect(drain.get(target.toString())).toBe(0);
  });
});
