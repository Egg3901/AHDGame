import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { liveActionFilter } from "./primaryStateActions";
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
