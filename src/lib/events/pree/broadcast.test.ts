import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { EventDefinition } from "@/lib/db/types/events";
import {
  registerEventHandler,
  _resetEventHandlerRegistryForTests,
} from "@/lib/events/substrate/registry";
import { broadcastMatchesCharacter, findDueBroadcast } from "./broadcast";
import type { CharacterEventContext } from "./eligibility";

const FULL_TABLE = [{ minRoll: 1, maxRoll: 100, label: "ok", effects: [] }];

function def(overrides: Partial<EventDefinition> = {}): EventDefinition {
  return {
    _id: new ObjectId(),
    kind: "pree.broadcast.test",
    status: "approved",
    version: 1,
    title: "Test",
    headline: "Test",
    body: "Test",
    eligibility: ["all"],
    baseWeight: 1,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    options: [{ id: "nothing", label: "Nothing", description: "Nothing.", isDefault: true }],
    defaultOptionId: "nothing",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function registerBroadcastHandler(kind = "pree.broadcast.test") {
  registerEventHandler({
    kind,
    defaultOptionId: "nothing",
    options: [
      {
        id: "nothing",
        label: "Nothing",
        description: "Nothing.",
        isDefault: true,
        outcomeTable: FULL_TABLE,
      },
    ],
  });
}

function ctx(overrides: Partial<CharacterEventContext> = {}): CharacterEventContext {
  return {
    characterId: new ObjectId(),
    countryId: "US",
    isPolitician: false,
    isCeo: false,
    isInElection: false,
    ...overrides,
  };
}

describe("findDueBroadcast", () => {
  it("returns null when currentYear is unknown", () => {
    registerBroadcastHandler();
    expect(findDueBroadcast([def({ broadcast: "global" })], null, undefined)).toBeNull();
    _resetEventHandlerRegistryForTests();
  });

  it("returns a global broadcast inside its year window", () => {
    registerBroadcastHandler();
    const d = def({ broadcast: "global", minYear: 1969, maxYear: 1969 });
    expect(findDueBroadcast([d], null, 1969)?.kind).toBe("pree.broadcast.test");
    expect(findDueBroadcast([d], null, 1970)).toBeNull();
    _resetEventHandlerRegistryForTests();
  });

  it("skips broadcasts that already fired", () => {
    registerBroadcastHandler();
    const d = def({ broadcast: "global", minYear: 1969, maxYear: 1969 });
    const ledger = { lastFiredTurnByKind: { "pree.broadcast.test": 100 } } as never;
    expect(findDueBroadcast([d], ledger, 1969)).toBeNull();
    _resetEventHandlerRegistryForTests();
  });

  it("skips broadcasts without a registered handler", () => {
    const d = def({ broadcast: "global", minYear: 1969, maxYear: 1969 });
    expect(findDueBroadcast([d], null, 1969)).toBeNull();
  });

  it("ignores non-broadcast definitions", () => {
    expect(findDueBroadcast([def({ minYear: 1969, maxYear: 1969 })], null, 1969)).toBeNull();
  });
});

describe("broadcastMatchesCharacter", () => {
  it("global reaches any country", () => {
    const d = def({ broadcast: "global" });
    expect(broadcastMatchesCharacter(d, ctx({ countryId: "US" }))).toBe(true);
    expect(broadcastMatchesCharacter(d, ctx({ countryId: "RU" }))).toBe(true);
  });

  it("country reaches only requiresCountryIds", () => {
    const d = def({ broadcast: "country", requiresCountryIds: ["US"] });
    expect(broadcastMatchesCharacter(d, ctx({ countryId: "US" }))).toBe(true);
    expect(broadcastMatchesCharacter(d, ctx({ countryId: "UK" }))).toBe(false);
  });

  it("returns false for non-broadcast definitions", () => {
    expect(broadcastMatchesCharacter(def(), ctx())).toBe(false);
  });
});
