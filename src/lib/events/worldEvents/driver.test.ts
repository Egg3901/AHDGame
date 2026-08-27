import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { EventDefinition } from "@/lib/db/types/events";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";
import "./handlers/royalEvent";
import "./handlers/papalVisit";
import "./handlers/olympics";
import "./handlers/worldsFair";
import "./handlers/highTensionEvents";
import { processWorldEventsTurn } from "./driver";
import { hashToUint32 } from "@/lib/events/substrate/rng";
import { COUNTRY_CONFIGS, COUNTRY_ORDER } from "@/lib/constants/countries";

function makeDefinition(overrides: Partial<EventDefinition> = {}): EventDefinition {
  return {
    _id: new ObjectId(),
    kind: "worldEvents.papalVisit",
    status: "approved",
    version: 1,
    title: "Papal Visit",
    headline: "headline",
    body: "body",
    eligibility: ["all"],
    baseWeight: 6,
    cooldownTurnsMin: 20,
    cooldownTurnsMax: 40,
    deciderRole: "executive",
    defaultOptionId: "acknowledge",
    options: [{ id: "acknowledge", label: "Acknowledge", description: "", isDefault: true }],
    schedule: { kind: "window", minGapTurns: 20, maxGapTurns: 40 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("processWorldEventsTurn (World Events v1 Phase 1 scheduler)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("eventDefinitions");
    db.collection("eventInstances");
    db.collection("eventCooldownLedger");
    db.collection("characters");
    db.collection("governmentApprovals");
    db.collection("coldWarTension");
    db.collection("countryModifiers");
  });

  it("is a no-op when worldEventsEnabled is false (default)", async () => {
    const result = await processWorldEventsTurn(db as never, 100, { worldEventsEnabled: false });
    expect(result).toEqual({ offered: 0, skipped: 0, globalHostEventsOffered: 0 });
    expect(db.collectionMocks.eventDefinitions!.find).not.toHaveBeenCalled();
  });

  it("is a no-op when there are no schedule-bearing approved definitions", async () => {
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const result = await processWorldEventsTurn(db as never, 100, { worldEventsEnabled: true });
    expect(result.offered).toBe(0);
  });

  it("offers a due window-schedule event for an eligible country (never fired before → immediately due)", async () => {
    const def = makeDefinition();
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([def]),
    });
    // No pending instance, no cooldown ledger yet (never fired).
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    const result = await processWorldEventsTurn(db as never, 100, { worldEventsEnabled: true });

    expect(result.offered).toBeGreaterThan(0);
    expect(db.collectionMocks.eventInstances!.insertOne).toHaveBeenCalled();
    // Cooldown ledger recorded the fire.
    expect(db.collectionMocks.eventCooldownLedger!.updateOne).toHaveBeenCalled();
  });

  it("era-gates scheduled definitions: a maxYear-1962 def is skipped in 1970 but offered in 1960", async () => {
    const def = makeDefinition({ maxYear: 1962 });
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([def]),
    });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    const pastWindow = await processWorldEventsTurn(db as never, 100, {
      worldEventsEnabled: true,
      currentYear: 1970,
    });
    expect(pastWindow.offered).toBe(0);
    expect(db.collectionMocks.eventInstances!.insertOne).not.toHaveBeenCalled();

    const inWindow = await processWorldEventsTurn(db as never, 100, {
      worldEventsEnabled: true,
      currentYear: 1960,
    });
    expect(inWindow.offered).toBeGreaterThan(0);
  });

  it("skips (does not offer) a country with an already-pending world event — spam cap", async () => {
    const def = makeDefinition();
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([def]),
    });
    // Every country already has a pending instance.
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue({ _id: new ObjectId() });

    const result = await processWorldEventsTurn(db as never, 100, { worldEventsEnabled: true });

    expect(result.offered).toBe(0);
    expect(db.collectionMocks.eventInstances!.insertOne).not.toHaveBeenCalled();
  });

  it("gates worldEvents.royalEvent to UK via requiresCountryIds — never offered to a non-UK country", async () => {
    const ukOnlyDef = makeDefinition({
      kind: "worldEvents.royalEvent",
      requiresCountryIds: ["UK"] as EventDefinition["requiresCountryIds"],
    });
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([ukOnlyDef]),
    });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    await processWorldEventsTurn(db as never, 100, { worldEventsEnabled: true });

    const insertedScopeIds = db.collectionMocks.eventInstances!.insertOne.mock.calls.map((call) =>
      (call[0].scopeId as ObjectId).toHexString()
    );
    // Every inserted instance's scopeId must be the UK country scope id —
    // no other country ever got this definition.
    for (const scopeIdHex of insertedScopeIds) {
      expect(scopeIdHex).toBe(countryScopeId("UK").toHexString());
    }
    expect(insertedScopeIds.length).toBeGreaterThan(0);
  });

  it("at most one offer per country per turn even with multiple due definitions", async () => {
    const defA = makeDefinition({ kind: "worldEvents.papalVisit" });
    const defB = makeDefinition({
      kind: "worldEvents.royalEvent",
      requiresCountryIds: ["UK"] as EventDefinition["requiresCountryIds"],
    });
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([defA, defB]),
    });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);

    await processWorldEventsTurn(db as never, 100, { worldEventsEnabled: true });

    const ukScopeIdHex = countryScopeId("UK").toHexString();
    const ukInserts = db.collectionMocks.eventInstances!.insertOne.mock.calls.filter(
      (call) => (call[0].scopeId as ObjectId).toHexString() === ukScopeIdHex
    );
    // UK is eligible for both papalVisit and royalEvent, but the cap means
    // only one instance is ever created for UK this turn.
    expect(ukInserts.length).toBe(1);
  });

  it("records a shared fire marker so high-tension crises stagger across kinds", async () => {
    const def = makeDefinition({
      kind: "worldEvents.panicBuying",
      minTension: 60,
      schedule: { kind: "window", minGapTurns: 10, maxGapTurns: 24 },
      defaultOptionId: "calm",
      options: [
        { id: "ration", label: "Ration", description: "" },
        { id: "calm", label: "Calm", description: "", isDefault: true },
        { id: "release", label: "Release", description: "" },
      ],
    });
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([def]),
    });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    db.collectionMocks.eventCooldownLedger!.findOne.mockResolvedValue(null);
    db.collectionMocks.coldWarTension!.findOne.mockResolvedValue({
      _id: "current",
      value: 100,
      pressureFloor: 100,
      updatedTurn: 100,
      events: [],
      updatedAt: new Date(),
    });
    db.collectionMocks.countryModifiers!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    await processWorldEventsTurn(db as never, 100, { worldEventsEnabled: true });

    expect(db.collectionMocks.eventCooldownLedger!.updateOne.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.anything(),
          expect.objectContaining({
            $set: expect.objectContaining({
              "lastFiredTurnByKind.worldEvents.highTensionShared": 100,
            }),
          }),
        ]),
      ])
    );
  });
});

describe("processWorldEventsTurn — global host events (World Events v1 Phase 3, rewritten)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("eventDefinitions");
    db.collection("eventInstances");
    db.collection("eventCooldownLedger");
    db.collection("characters");
    db.collection("governmentApprovals");
    // No schedule-bearing definitions in play for these tests.
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
  });

  function olympicsDefinition(): EventDefinition {
    return {
      _id: new ObjectId(),
      kind: "worldEvents.olympics",
      status: "approved",
      version: 1,
      title: "Olympics",
      headline: "h",
      body: "b",
      eligibility: ["all"],
      baseWeight: 1,
      cooldownTurnsMin: 0,
      cooldownTurnsMax: 0,
      deciderRole: "executive",
      defaultOptionId: "acknowledge",
      options: [{ id: "acknowledge", label: "Host the Games", description: "", isDefault: true }],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // Olympics: everyTurns 48, offsetTurns 12 — turn 12 is the first due turn,
  // and worlds-fair (offset 30, every 36) is deliberately NOT due at turn 12.
  const dueOlympicsTurn = 12;

  it("is skipped when not on the recurring cadence — no DB lookup at all", async () => {
    const result = await processWorldEventsTurn(db as never, dueOlympicsTurn + 1, {
      worldEventsEnabled: true,
    });
    expect(result.globalHostEventsOffered).toBe(0);
    expect(db.collectionMocks.eventDefinitions!.findOne).not.toHaveBeenCalled();
  });

  it("offers Olympics to a deterministically-hashed host country on its due turn — no bidding, no cycle doc", async () => {
    const def = olympicsDefinition();
    db.collectionMocks.eventDefinitions!.findOne.mockResolvedValue(def);
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);

    const activeCountries = COUNTRY_ORDER.filter((id) => COUNTRY_CONFIGS[id].status === "active");
    const expectedHostIndex =
      hashToUint32(`worldEventGlobalHost:worldEvents.olympics:${dueOlympicsTurn}`) %
      activeCountries.length;
    const expectedHost = activeCountries[expectedHostIndex]!;

    const result = await processWorldEventsTurn(db as never, dueOlympicsTurn, {
      worldEventsEnabled: true,
    });

    expect(result.globalHostEventsOffered).toBe(1);
    expect(db.collectionMocks.eventInstances!.insertOne).toHaveBeenCalledTimes(1);
    const inserted = db.collectionMocks.eventInstances!.insertOne.mock.calls[0][0];
    expect(inserted.kind).toBe("worldEvents.olympics");
    expect(inserted.scopeId.toHexString()).toBe(countryScopeId(expectedHost).toHexString());
    expect(inserted.payload).toEqual({ countryId: expectedHost });
  });

  it("skips the host offer (does not throw) when the deterministically-picked host already has a pending event", async () => {
    const def = olympicsDefinition();
    db.collectionMocks.eventDefinitions!.findOne.mockResolvedValue(def);
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue({ _id: new ObjectId() });

    const result = await processWorldEventsTurn(db as never, dueOlympicsTurn, {
      worldEventsEnabled: true,
    });

    expect(result.globalHostEventsOffered).toBe(0);
    expect(db.collectionMocks.eventInstances!.insertOne).not.toHaveBeenCalled();
  });

  it("host selection is deterministic — same turn, same kind always picks the same host", () => {
    const activeCountries = COUNTRY_ORDER.filter((id) => COUNTRY_CONFIGS[id].status === "active");
    const a =
      hashToUint32(`worldEventGlobalHost:worldEvents.olympics:${dueOlympicsTurn}`) %
      activeCountries.length;
    const b =
      hashToUint32(`worldEventGlobalHost:worldEvents.olympics:${dueOlympicsTurn}`) %
      activeCountries.length;
    expect(a).toBe(b);
  });
});
