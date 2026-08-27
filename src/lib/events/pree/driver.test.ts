import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Character } from "@/lib/db/types/character";
import type { EventDefinition, EventInstance } from "@/lib/db/types/events";
import {
  registerEventHandler,
  _resetEventHandlerRegistryForTests,
} from "@/lib/events/substrate/registry";
import { processPlayerRandomEventsTurn } from "./driver";

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

const FULL_TABLE = [{ minRoll: 1, maxRoll: 100, label: "ok", effects: [] }];

function registerTestHandler() {
  registerEventHandler({
    kind: "pree.test",
    defaultOptionId: "ignore",
    options: [
      {
        id: "ignore",
        label: "Ignore",
        description: "Default",
        isDefault: true,
        outcomeTable: FULL_TABLE,
      },
    ],
    buildPayload: async () => ({ test: true }),
  });
}

function approvedDefinition(): EventDefinition {
  return {
    _id: new ObjectId(),
    kind: "pree.test",
    status: "approved",
    version: 1,
    title: "Test Event",
    headline: "Something happened",
    body: "Details",
    eligibility: ["all"],
    baseWeight: 10,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    options: [],
    defaultOptionId: "ignore",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("PREE driver", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const userId = new ObjectId();

  beforeEach(() => {
    _resetEventHandlerRegistryForTests();
    db = createMockDb();
    vi.clearAllMocks();
  });

  function wireCharacter(character: Partial<Character> = {}) {
    const doc: Character = {
      _id: characterId,
      userId,
      countryId: "US",
      name: "Test Player",
      homeState: "CA",
      politicalInfluence: 0,
      favorability: 50,
      infamy: 0,
      actions: 0,
      donorBaseLevel: 0,
      policies: { economic: 0, social: 0 },
      party: "1",
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...character,
    };

    db.collection("characters");
    db.collectionMocks.characters!.find.mockImplementation((filter) => {
      if (filter && "preeLotteryAnnuity.turnsRemaining" in filter) {
        return { toArray: vi.fn().mockResolvedValue([]) };
      }
      return createAsyncIterableCursor([doc]);
    });

    db.collection("electionCandidates");
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      // .project().toArray() feeds offer eligibility; bare .toArray() feeds the
      // debate driver (empty → no debate challenge in this test).
      toArray: vi.fn().mockResolvedValue([]),
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });

    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });

    db.collection("corporations");
    db.collectionMocks.corporations!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });

    return doc;
  }

  it("sweeps expired events when feature flag is off without offering", async () => {
    registerTestHandler();
    wireCharacter();

    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);

    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([approvedDefinition()]),
    });

    const result = await processPlayerRandomEventsTurn(db as never, 10, {
      playerRandomEventsEnabled: false,
    });

    expect(result.swept).toBe(0);
    expect(result.offered).toBe(0);
    expect(db.collectionMocks.eventInstances!.insertOne).not.toHaveBeenCalled();
  });

  it("offers an event when flag is on and templates are eligible", async () => {
    registerTestHandler();
    wireCharacter();

    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collectionMocks.eventInstances!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([approvedDefinition()]),
    });

    db.collection("eventCooldownLedger");
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    const result = await processPlayerRandomEventsTurn(db as never, 10, {
      playerRandomEventsEnabled: true,
    });

    expect(result.offered).toBe(1);
    expect(db.collectionMocks.eventInstances!.insertOne).toHaveBeenCalled();
  });

  it("never loads world-event definitions into the player random-event pool", async () => {
    registerTestHandler();
    wireCharacter();

    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    await processPlayerRandomEventsTurn(db as never, 10, {
      playerRandomEventsEnabled: true,
    });

    expect(db.collectionMocks.eventDefinitions!.find).toHaveBeenCalledWith({
      status: "approved",
      kind: { $not: /^worldEvents\./ },
    });
    expect(db.collectionMocks.eventInstances!.insertOne).not.toHaveBeenCalled();
  });

  it("auto-defaults expired pending instances on sweep", async () => {
    registerTestHandler();

    const expired: EventInstance = {
      _id: new ObjectId(),
      kind: "pree.test",
      scope: "character",
      scopeId: characterId,
      definitionVersion: 1,
      status: "pending",
      roll: 50,
      payload: {},
      offeredAtTurn: 5,
      offeredAt: new Date(Date.now() - 86_400_000),
      expiresAtRealtimeMs: Date.now() - 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([expired]),
    });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(expired);
    db.collectionMocks.eventInstances!.findOneAndUpdate.mockResolvedValue({
      ...expired,
      status: "expired",
    });

    db.collection("characters");
    db.collectionMocks.characters!.find.mockImplementation((filter) => {
      if (filter && "preeLotteryAnnuity.turnsRemaining" in filter) {
        return { toArray: vi.fn().mockResolvedValue([]) };
      }
      if (filter && "userId" in filter) {
        return createAsyncIterableCursor([]);
      }
      return {
        toArray: vi.fn().mockResolvedValue([{ _id: characterId, userId }]),
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([{ _id: characterId, userId }]),
        }),
      };
    });

    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    db.collection("eventCooldownLedger");
    db.collectionMocks.eventCooldownLedger!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
      upsertedCount: 0,
    });

    db.collection("exchangeRates");
    db.collectionMocks.exchangeRates!.findOne.mockResolvedValue({ rate: 1 });

    const result = await processPlayerRandomEventsTurn(db as never, 10, {
      playerRandomEventsEnabled: false,
    });

    expect(result.swept).toBe(1);

    // The timeout must notify the instance owner — the turn-phase sweep used
    // to run with an empty userId map and silently drop these.
    const { createNotification } = await import("@/lib/notifications");
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({ userId, type: "player_event_resolved" })
    );
  });

  it("era-gates offers by currentYear: a minYear-2005 def never fires in 1955", async () => {
    registerTestHandler();
    wireCharacter();

    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collectionMocks.eventInstances!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ ...approvedDefinition(), minYear: 2005 }]),
    });

    db.collection("eventCooldownLedger");
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    const tooEarly = await processPlayerRandomEventsTurn(db as never, 10, {
      playerRandomEventsEnabled: true,
      currentYear: 1955,
    });
    expect(tooEarly.offered).toBe(0);
    expect(db.collectionMocks.eventInstances!.insertOne).not.toHaveBeenCalled();

    const inRange = await processPlayerRandomEventsTurn(db as never, 11, {
      playerRandomEventsEnabled: true,
      currentYear: 2005,
    });
    expect(inRange.offered).toBe(1);
  });

  it("broadcast event fires for every matching character at once, only inside its window", async () => {
    registerEventHandler({
      kind: "pree.broadcast.test",
      defaultOptionId: "ignore",
      options: [
        {
          id: "ignore",
          label: "Ignore",
          description: "Default",
          isDefault: true,
          outcomeTable: FULL_TABLE,
        },
      ],
      buildPayload: async () => ({ test: true }),
    });

    const base = wireCharacter();
    const docs: Character[] = [
      { ...base, _id: new ObjectId(), userId: new ObjectId(), countryId: "US" },
      { ...base, _id: new ObjectId(), userId: new ObjectId(), countryId: "US" },
      { ...base, _id: new ObjectId(), userId: new ObjectId(), countryId: "UK" },
    ];
    db.collectionMocks.characters!.find.mockImplementation((filter) => {
      if (filter && "preeLotteryAnnuity.turnsRemaining" in filter) {
        return { toArray: vi.fn().mockResolvedValue([]) };
      }
      return createAsyncIterableCursor(docs);
    });

    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collectionMocks.eventInstances!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const broadcastDef = {
      ...approvedDefinition(),
      kind: "pree.broadcast.test",
      broadcast: "global" as const,
      minYear: 1969,
      maxYear: 1969,
    };
    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([broadcastDef]),
    });

    db.collection("eventCooldownLedger");
    // Broadcast ledger (scope "country") and character ledgers: never fired / none.
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    // Outside the window: no broadcast, and nothing else is eligible either.
    const outside = await processPlayerRandomEventsTurn(db as never, 10, {
      playerRandomEventsEnabled: true,
      currentYear: 1970,
    });
    expect(outside.offered).toBe(0);

    // Inside the window: all three characters get the moment, and the fire is recorded.
    const inside = await processPlayerRandomEventsTurn(db as never, 11, {
      playerRandomEventsEnabled: true,
      currentYear: 1969,
    });
    expect(inside.offered).toBe(3);
    expect(db.collectionMocks.eventCooldownLedger!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "country" }),
      expect.objectContaining({
        $set: expect.objectContaining({ "lastFiredTurnByKind.pree.broadcast.test": 11 }),
      }),
      expect.anything()
    );

    // Already fired (ledger has the marker): never fires again.
    db.collectionMocks.eventCooldownLedger!.findOne.mockImplementation((filter) =>
      Promise.resolve(
        filter && filter.scope === "country"
          ? { lastFiredTurnByKind: { "pree.broadcast.test": 11 } }
          : null
      )
    );
    db.collectionMocks.eventInstances!.insertOne.mockClear();
    const again = await processPlayerRandomEventsTurn(db as never, 12, {
      playerRandomEventsEnabled: true,
      currentYear: 1969,
    });
    expect(again.offered).toBe(0);
    expect(db.collectionMocks.eventInstances!.insertOne).not.toHaveBeenCalled();
  });

  it("a country broadcast reaches only that nation's characters", async () => {
    registerEventHandler({
      kind: "pree.broadcast.test",
      defaultOptionId: "ignore",
      options: [
        {
          id: "ignore",
          label: "Ignore",
          description: "Default",
          isDefault: true,
          outcomeTable: FULL_TABLE,
        },
      ],
      buildPayload: async () => ({ test: true }),
    });

    const base = wireCharacter();
    const docs: Character[] = [
      { ...base, _id: new ObjectId(), userId: new ObjectId(), countryId: "US" },
      { ...base, _id: new ObjectId(), userId: new ObjectId(), countryId: "UK" },
      { ...base, _id: new ObjectId(), userId: new ObjectId(), countryId: "RU" },
    ];
    db.collectionMocks.characters!.find.mockImplementation((filter) => {
      if (filter && "preeLotteryAnnuity.turnsRemaining" in filter) {
        return { toArray: vi.fn().mockResolvedValue([]) };
      }
      return createAsyncIterableCursor(docs);
    });

    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collectionMocks.eventInstances!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          ...approvedDefinition(),
          kind: "pree.broadcast.test",
          broadcast: "country" as const,
          requiresCountryIds: ["US"],
          minYear: 1963,
          maxYear: 1963,
        },
      ]),
    });

    db.collection("eventCooldownLedger");
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    const result = await processPlayerRandomEventsTurn(db as never, 10, {
      playerRandomEventsEnabled: true,
      currentYear: 1963,
    });
    expect(result.offered).toBe(1);
  });

  it("broadcast definitions never enter the normal weighted pool", async () => {
    registerEventHandler({
      kind: "pree.broadcast.test",
      defaultOptionId: "ignore",
      options: [
        {
          id: "ignore",
          label: "Ignore",
          description: "Default",
          isDefault: true,
          outcomeTable: FULL_TABLE,
        },
      ],
      buildPayload: async () => ({ test: true }),
    });
    wireCharacter();

    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);

    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { ...approvedDefinition(), kind: "pree.broadcast.test", broadcast: "global" as const },
        ]),
    });

    db.collection("eventCooldownLedger");
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    // No currentYear → broadcast machinery inert, and the only definition is
    // a broadcast, so nothing is offerable through the normal pool.
    const result = await processPlayerRandomEventsTurn(db as never, 10, {
      playerRandomEventsEnabled: true,
    });
    expect(result.offered).toBe(0);
  });

  it("a broadcast supersedes a character's pending event (auto-resolved on default)", async () => {
    registerTestHandler(); // kind pree.test — the pending event being cleared
    registerEventHandler({
      kind: "pree.broadcast.test",
      defaultOptionId: "ignore",
      options: [
        {
          id: "ignore",
          label: "Ignore",
          description: "Default",
          isDefault: true,
          outcomeTable: FULL_TABLE,
        },
      ],
      buildPayload: async () => ({ test: true }),
    });
    wireCharacter();

    const pending: EventInstance = {
      _id: new ObjectId(),
      kind: "pree.test",
      scope: "character",
      scopeId: characterId,
      definitionVersion: 1,
      status: "pending",
      roll: 50,
      payload: {},
      offeredAtTurn: 9,
      offeredAt: new Date(),
      expiresAtRealtimeMs: Date.now() + 86_400_000,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.collection("eventInstances");
    // Once the supersede resolves the pending instance, subsequent lookups
    // (including offerEvent's own conflict check) must see the slot as free.
    let superseded = false;
    db.collectionMocks.eventInstances!.findOne.mockImplementation(() =>
      Promise.resolve(superseded ? null : pending)
    );
    db.collectionMocks.eventInstances!.findOneAndUpdate.mockImplementation(() => {
      superseded = true;
      return Promise.resolve({
        ...pending,
        status: "expired",
        resolvedOptionId: "ignore",
      });
    });
    db.collectionMocks.eventInstances!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          ...approvedDefinition(),
          kind: "pree.broadcast.test",
          broadcast: "global" as const,
          minYear: 1969,
          maxYear: 1969,
        },
      ]),
    });

    db.collection("eventCooldownLedger");
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    const result = await processPlayerRandomEventsTurn(db as never, 10, {
      playerRandomEventsEnabled: true,
      currentYear: 1969,
    });

    // The pending event was superseded (resolved on its default option)...
    expect(db.collectionMocks.eventInstances!.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: pending._id, status: "pending" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "expired", resolvedOptionId: "ignore" }),
      }),
      expect.anything()
    );
    // ...and the broadcast was offered anyway.
    expect(result.offered).toBe(1);
    expect(db.collectionMocks.eventInstances!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "pree.broadcast.test" })
    );
  });

  it("offers events to every character, not just the first chunk", async () => {
    registerTestHandler();

    const base = wireCharacter();
    const docs: Character[] = Array.from({ length: 205 }, (_, i) => ({
      ...base,
      _id: new ObjectId(),
      userId: new ObjectId(),
      name: `Player ${i}`,
    }));

    db.collectionMocks.characters!.find.mockImplementation((filter) => {
      if (filter && "preeLotteryAnnuity.turnsRemaining" in filter) {
        return { toArray: vi.fn().mockResolvedValue([]) };
      }
      return createAsyncIterableCursor(docs);
    });

    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collectionMocks.eventInstances!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([approvedDefinition()]),
    });

    db.collection("eventCooldownLedger");
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    const result = await processPlayerRandomEventsTurn(db as never, 10, {
      playerRandomEventsEnabled: true,
    });

    expect(result.offered).toBe(205);
  });
});
