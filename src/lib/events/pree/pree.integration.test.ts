import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Character } from "@/lib/db/types/character";
import type { EventDefinition } from "@/lib/db/types/events";
import { _resetEventHandlerRegistryForTests } from "@/lib/events/substrate/registry";
import { resolveEvent } from "@/lib/events/substrate/resolve";
import { processPlayerRandomEventsTurn } from "./driver";
import "@/lib/events/pree/index";

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

const stafferDef: EventDefinition = {
  _id: new ObjectId(),
  kind: "pree.stafferScandal",
  status: "approved",
  version: 1,
  title: "Staffer Scandal",
  headline: "Staff controversy",
  body: "Body",
  eligibility: ["inElection"],
  baseWeight: 100,
  cooldownTurnsMin: 0,
  cooldownTurnsMax: 0,
  defaultOptionId: "ignore",
  options: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("PREE integration", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const userId = new ObjectId();
  const candidateId = new ObjectId();
  const electionId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("offers staffer scandal to in-election character when flag is on", async () => {
    const character: Character = {
      _id: characterId,
      userId,
      countryId: "US",
      name: "Candidate",
      homeState: "CA",
      politicalInfluence: 10,
      favorability: 50,
      infamy: 0,
      actions: 0,
      donorBaseLevel: 0,
      policies: { economic: 0, social: 0 },
      party: "1",
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.collection("characters");
    db.collectionMocks.characters!.find.mockImplementation((filter) => {
      if (filter && "preeLotteryAnnuity.turnsRemaining" in filter) {
        return { toArray: vi.fn().mockResolvedValue([]) };
      }
      return createAsyncIterableCursor([character]);
    });

    db.collection("electionCandidates");
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      // .project().toArray() feeds offer eligibility (in-election); bare
      // .toArray() feeds the debate driver (empty → no debate this test).
      toArray: vi.fn().mockResolvedValue([]),
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ characterId }]),
      }),
    });
    db.collectionMocks.electionCandidates!.findOne.mockResolvedValue({
      characterId,
      electionId,
      _id: candidateId,
      status: "active",
      support: 50,
    });

    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    db.collection("corporations");
    db.collectionMocks.corporations!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });

    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collectionMocks.eventInstances!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.eventInstances!.insertOne.mockImplementation(async (doc) => ({
      insertedId: doc._id,
    }));

    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([stafferDef]),
    });

    db.collection("eventCooldownLedger");
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    const result = await processPlayerRandomEventsTurn(db as never, 25, {
      playerRandomEventsEnabled: true,
    });

    expect(result.offered).toBe(1);
    expect(db.collectionMocks.eventInstances!.insertOne).toHaveBeenCalled();
  });

  it("resolves staffer scandal and changes favorability", async () => {
    const instanceId = new ObjectId();
    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue({
      _id: instanceId,
      kind: "pree.stafferScandal",
      scope: "character",
      scopeId: characterId,
      definitionVersion: 1,
      status: "pending",
      roll: 10,
      payload: { electionId, candidateId },
      offeredAtTurn: 20,
      offeredAt: new Date(),
      expiresAtRealtimeMs: Date.now() + 60_000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.collectionMocks.eventInstances!.findOneAndUpdate.mockResolvedValue({
      status: "resolved",
    });

    db.collection("characters");
    db.collectionMocks.characters!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: characterId,
      countryId: "US",
      favorability: 50,
      infamy: 0,
      politicalInfluence: 0,
    });
    db.collectionMocks.characters!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });

    db.collection("eventCooldownLedger");
    db.collectionMocks.eventCooldownLedger!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
      upsertedCount: 0,
    });

    db.collection("electionCandidates");
    db.collectionMocks.electionCandidates!.findOne.mockResolvedValue({
      _id: candidateId,
      support: 50,
    });
    db.collectionMocks.electionCandidates!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });

    db.collection("exchangeRates");
    db.collectionMocks.exchangeRates!.findOne.mockResolvedValue({ rate: 1 });

    await resolveEvent(db as never, instanceId, "apologize", "player", 25);

    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalled();
    const update = db.collectionMocks.characters!.updateOne.mock.calls[0]?.[1] as {
      $set?: { favorability?: number };
    };
    expect(update.$set?.favorability).toBe(40);
  });
});
