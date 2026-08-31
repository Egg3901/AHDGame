import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { getLastFiredTurn, isCharacterEligibleForOffer, PREE_COOLDOWN_TURNS_MAX } from "./cooldown";

describe("event substrate cooldown", () => {
  it("treats missing ledger as eligible", () => {
    expect(isCharacterEligibleForOffer(null, 100)).toBe(true);
  });

  it("blocks offers before nextEligibleTurn", () => {
    expect(
      isCharacterEligibleForOffer(
        {
          _id: new ObjectId(),
          scope: "character",
          scopeId: new ObjectId(),
          lastExpiredAtTurn: 50,
          nextEligibleTurn: 70,
          perKindCooldowns: {},
          updatedAt: new Date(),
        },
        69
      )
    ).toBe(false);
    expect(
      isCharacterEligibleForOffer(
        {
          _id: new ObjectId(),
          scope: "character",
          scopeId: new ObjectId(),
          lastExpiredAtTurn: 50,
          nextEligibleTurn: 70,
          perKindCooldowns: {},
          updatedAt: new Date(),
        },
        70
      )
    ).toBe(true);
  });

  it("uses a 10–20 turn spacing band", () => {
    expect(PREE_COOLDOWN_TURNS_MAX).toBe(20);
  });
});

describe("getLastFiredTurn (World Events v1 Phase 1 scheduler)", () => {
  it("returns undefined for a null ledger", () => {
    expect(getLastFiredTurn(null, "worldEvents.royalEvent")).toBeUndefined();
  });

  it("returns undefined when the kind has never fired", () => {
    expect(
      getLastFiredTurn(
        { lastFiredTurnByKind: { "worldEvents.papalVisit": 40 } },
        "worldEvents.royalEvent"
      )
    ).toBeUndefined();
  });

  it("returns undefined when lastFiredTurnByKind itself is absent", () => {
    expect(getLastFiredTurn({}, "worldEvents.royalEvent")).toBeUndefined();
  });

  it("returns the recorded turn for a kind that has fired", () => {
    expect(
      getLastFiredTurn(
        { lastFiredTurnByKind: { "worldEvents.royalEvent": 40 } },
        "worldEvents.royalEvent"
      )
    ).toBe(40);
  });

  it("reads the nested shape MongoDB creates for dotted kind names", () => {
    expect(
      getLastFiredTurn(
        {
          lastFiredTurnByKind: {
            worldEvents: { highTensionShared: 438 },
          } as unknown as Record<string, number>,
        },
        "worldEvents.highTensionShared"
      )
    ).toBe(438);
  });
});
