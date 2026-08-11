/**
 * Multi-turn simulation of the World Events v1 Phase 1 scheduler: drives
 * `processWorldEventsTurn` across a run of turns against an in-memory
 * cooldown ledger + pending-instance store (a hand-rolled stateful MockDb
 * stand-in), asserting papal-visit and royal-event each fire on their
 * declared window schedule and never more than once per country per turn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { EventDefinition, EventInstance, EventCooldownLedger } from "@/lib/db/types/events";
import "./handlers/royalEvent";
import "./handlers/papalVisit";
import { processWorldEventsTurn } from "./driver";
import { windowGapTurns } from "./scheduler";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";

function papalVisitDefinition(): EventDefinition {
  return {
    _id: new ObjectId(),
    kind: "worldEvents.papalVisit",
    status: "approved",
    version: 1,
    title: "Papal Visit",
    headline: "h",
    body: "b",
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
  };
}

function royalEventDefinition(): EventDefinition {
  return {
    _id: new ObjectId(),
    kind: "worldEvents.royalEvent",
    status: "approved",
    version: 1,
    title: "Royal Event",
    headline: "h",
    body: "b",
    eligibility: ["all"],
    baseWeight: 6,
    cooldownTurnsMin: 24,
    cooldownTurnsMax: 48,
    deciderRole: "executive",
    defaultOptionId: "acknowledge",
    options: [{ id: "acknowledge", label: "Acknowledge", description: "", isDefault: true }],
    requiresCountryIds: ["UK"] as EventDefinition["requiresCountryIds"],
    schedule: { kind: "window", minGapTurns: 24, maxGapTurns: 48 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Wires the MockDb's eventCooldownLedger + eventInstances mocks into a tiny
 * in-memory store so cooldown state and pending instances persist across
 * repeated `processWorldEventsTurn` calls within a test — the real
 * multi-turn behavior this integration test exercises.
 */
function wireStatefulStore(db: MockDb): {
  pendingScopeIds: Set<string>;
  ledgerByScope: Map<string, EventCooldownLedger>;
} {
  const pendingScopeIds = new Set<string>();
  const ledgerByScope = new Map<string, EventCooldownLedger>();

  db.collectionMocks.eventInstances!.findOne.mockImplementation(
    async (query: { scopeId: ObjectId }) => {
      const key = query.scopeId.toHexString();
      return pendingScopeIds.has(key)
        ? ({ _id: new ObjectId() } as unknown as EventInstance)
        : null;
    }
  );
  db.collectionMocks.eventInstances!.insertOne.mockImplementation(async (doc: EventInstance) => {
    pendingScopeIds.add(doc.scopeId.toHexString());
    return { insertedId: doc._id };
  });

  db.collectionMocks.eventCooldownLedger!.findOne.mockImplementation(
    async (query: { scopeId: ObjectId }) => {
      return ledgerByScope.get(query.scopeId.toHexString()) ?? null;
    }
  );
  db.collectionMocks.eventCooldownLedger!.updateOne.mockImplementation(
    async (query: { scopeId: ObjectId }, update: { $set: Record<string, unknown> }) => {
      const key = query.scopeId.toHexString();
      const existing = ledgerByScope.get(key);
      const kindEntries = Object.entries(update.$set).filter(([k]) =>
        k.startsWith("lastFiredTurnByKind.")
      );
      const lastFiredTurnByKind = { ...(existing?.lastFiredTurnByKind ?? {}) };
      for (const [k, v] of kindEntries) {
        lastFiredTurnByKind[k.replace("lastFiredTurnByKind.", "")] = v as number;
      }
      ledgerByScope.set(key, {
        _id: query.scopeId,
        scope: "country",
        scopeId: query.scopeId,
        lastExpiredAtTurn: 0,
        nextEligibleTurn: 0,
        perKindCooldowns: {},
        lastFiredTurnByKind,
        updatedAt: new Date(),
      });
      return { modifiedCount: 1, matchedCount: 1 };
    }
  );

  return { pendingScopeIds, ledgerByScope };
}

describe("World Events v1 Phase 1 — multi-turn scheduler simulation", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("eventDefinitions");
    db.collection("eventInstances");
    db.collection("eventCooldownLedger");
    db.collection("characters");
    db.collection("governmentApprovals");
  });

  it("fires papal-visit for a country at turn 1 (never fired), then again after the deterministic window gap", async () => {
    const def = papalVisitDefinition();
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([def]),
    });
    const { pendingScopeIds, ledgerByScope } = wireStatefulStore(db);

    const usScopeId = countryScopeId("US").toHexString();

    // Turn 1: never fired before -> immediately due.
    const r1 = await processWorldEventsTurn(db as never, 1, { worldEventsEnabled: true });
    expect(r1.offered).toBeGreaterThan(0);
    expect(pendingScopeIds.has(usScopeId)).toBe(true);

    const lastFired = ledgerByScope.get(usScopeId)!.lastFiredTurnByKind![def.kind]!;
    expect(lastFired).toBe(1);

    // Clear the pending instance for US (simulates the sweep resolving it
    // before the next scheduled occurrence — a fresh pending slot).
    pendingScopeIds.delete(usScopeId);

    const schedule = def.schedule;
    if (!schedule || schedule.kind !== "window") {
      throw new Error("expected a window schedule for this test");
    }
    const gap = windowGapTurns("US", def.kind, lastFired, {
      minGapTurns: schedule.minGapTurns,
      maxGapTurns: schedule.maxGapTurns,
    });

    // One turn before the gap elapses: not due yet.
    const beforeDue = await processWorldEventsTurn(db as never, lastFired + gap - 1, {
      worldEventsEnabled: true,
    });
    expect(pendingScopeIds.has(usScopeId)).toBe(false);
    void beforeDue;

    // Exactly at the gap: due again.
    const r2 = await processWorldEventsTurn(db as never, lastFired + gap, {
      worldEventsEnabled: true,
    });
    expect(r2.offered).toBeGreaterThan(0);
    expect(pendingScopeIds.has(usScopeId)).toBe(true);
  });

  it("only ever fires royal-event for UK across a 100-turn run, never for another country", async () => {
    const def = royalEventDefinition();
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([def]),
    });
    const { pendingScopeIds } = wireStatefulStore(db);

    const ukScopeId = countryScopeId("UK").toHexString();
    let fireCount = 0;

    for (let turn = 1; turn <= 100; turn++) {
      const result = await processWorldEventsTurn(db as never, turn, { worldEventsEnabled: true });
      if (result.offered > 0) {
        fireCount++;
        expect(pendingScopeIds.has(ukScopeId)).toBe(true);
        expect(pendingScopeIds.size).toBe(1); // only UK ever has a pending instance
        pendingScopeIds.delete(ukScopeId); // clear for the next window
      }
    }

    expect(fireCount).toBeGreaterThan(0);
  });

  it("caps offers to at most one per country per turn when both scheduled definitions are simultaneously due", async () => {
    const papal = papalVisitDefinition();
    const royal = royalEventDefinition();
    db.collectionMocks.eventDefinitions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([papal, royal]),
    });
    wireStatefulStore(db);

    // Turn 1: both defs have never fired -> both would be "due" for UK, but
    // the cap means UK gets exactly one instance this turn.
    const result = await processWorldEventsTurn(db as never, 1, { worldEventsEnabled: true });
    const ukInserts = db.collectionMocks.eventInstances!.insertOne.mock.calls.filter(
      (call) => (call[0].scopeId as ObjectId).toHexString() === countryScopeId("UK").toHexString()
    );
    expect(ukInserts.length).toBe(1);
    expect(result.offered).toBeGreaterThan(0);
  });
});
