import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { EventInstance } from "@/lib/db/types/events";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: vi.fn(),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 12 }),
}));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

const FULL_TABLE = [{ minRoll: 1, maxRoll: 100, label: "ok", effects: [] }];

registerEventHandler({
  kind: "pree.resolveRouteTest",
  defaultOptionId: "ignore",
  options: [
    { id: "act", label: "Act", description: "Act", outcomeTable: FULL_TABLE },
    {
      id: "ignore",
      label: "Ignore",
      description: "Ignore",
      isDefault: true,
      outcomeTable: FULL_TABLE,
    },
  ],
});

const characterId = new ObjectId();
const characterUserId = new ObjectId();

function pendingInstance(overrides: Partial<EventInstance> = {}): EventInstance {
  return {
    _id: new ObjectId(),
    kind: "pree.resolveRouteTest",
    scope: "character",
    scopeId: characterId,
    definitionVersion: 1,
    status: "pending",
    roll: 50,
    payload: {},
    offeredAtTurn: 8,
    offeredAt: new Date(),
    expiresAtRealtimeMs: Date.now() + 3_600_000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequest(optionId: string): Request {
  return new Request("http://localhost/api/events/x/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ optionId }),
  });
}

async function callRoute(request: Request, id: string) {
  const { POST } = await import("./route");
  return POST(request, { params: Promise.resolve({ id }) });
}

describe("POST /api/events/[id]/resolve", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("eventInstances");
    db.collection("eventCooldownLedger");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { requireHumanSessionWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toHexString(),
        character: { _id: characterId, userId: characterUserId },
      },
    } as never);
  });

  it("resolves the caller's pending event and sends the resolved notification", async () => {
    const instance = pendingInstance();
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(instance);
    db.collectionMocks.eventInstances!.findOneAndUpdate.mockResolvedValue({
      ...instance,
      status: "resolved",
      resolvedOptionId: "act",
      resolvedTierLabel: "ok",
    });

    const response = await callRoute(makeRequest("act"), instance._id.toHexString());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, optionId: "act", tierLabel: "ok" });

    const { createNotification } = await import("@/lib/notifications");
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "player_event_resolved", userId: characterUserId })
    );
    // Character cooldown spacing starts at resolve.
    expect(db.collectionMocks.eventCooldownLedger!.updateOne).toHaveBeenCalled();
  });

  it("returns 404 when the instance belongs to another character", async () => {
    const instance = pendingInstance({ scopeId: new ObjectId() });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(instance);

    const response = await callRoute(makeRequest("act"), instance._id.toHexString());

    expect(response.status).toBe(404);
    expect(db.collectionMocks.eventInstances!.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects an option that does not exist on the handler", async () => {
    const instance = pendingInstance();
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(instance);

    const response = await callRoute(makeRequest("not-an-option"), instance._id.toHexString());

    expect(response.status).toBe(400);
    expect(db.collectionMocks.eventInstances!.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects an instance that is no longer pending", async () => {
    const instance = pendingInstance({ status: "resolved" });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(instance);

    const response = await callRoute(makeRequest("act"), instance._id.toHexString());

    expect(response.status).toBe(400);
  });

  it("rejects an expired instance", async () => {
    const instance = pendingInstance({ expiresAtRealtimeMs: Date.now() - 1 });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(instance);

    const response = await callRoute(makeRequest("act"), instance._id.toHexString());

    expect(response.status).toBe(400);
    expect(db.collectionMocks.eventInstances!.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("reserves a free alternative before effects when another option spends funded Treasury cash", async () => {
    const instanceId = new ObjectId();
    const scopeId = new ObjectId();
    const instance: EventInstance = {
      _id: instanceId,
      kind: "pree.resolveRouteFundedChoiceTest",
      scope: "country",
      scopeId,
      definitionVersion: 1,
      status: "pending",
      roll: 50,
      payload: { countryId: "US" },
      offeredAtTurn: 12,
      offeredAt: new Date(),
      expiresAtRealtimeMs: Date.now() + 60_000,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const memory = createInMemoryDb();
    memory.seed("eventInstances", [instance as unknown as Record<string, unknown>]);
    memory.seed("eventDefinitions", [
      { _id: new ObjectId(), kind: instance.kind, deciderRole: "executive" },
    ]);
    memory.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    memory.seed("gameState", [{ _id: "current", currentTurn: 12, preset: "2019-default" }]);
    memory.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    memory.seed("federalBudget", [
      {
        _id: "US",
        countryId: "US",
        currencyCode: "USD",
        treasuryCashLocal: 20,
        treasuryBalance: 0,
      },
    ]);
    memory.seed("governmentApprovals", [
      { _id: "US", countryId: "US", approvalRating: 50, disapprovalRating: 50, netApproval: 0 },
    ]);
    registerEventHandler({
      kind: instance.kind,
      defaultOptionId: "paid",
      options: [
        {
          id: "free",
          label: "Free response",
          description: "No Treasury cost",
          outcomeTable: [
            {
              minRoll: 1,
              maxRoll: 100,
              label: "free outcome",
              effects: [{ type: "approvalDelta", delta: 1 }],
            },
          ],
        },
        {
          id: "paid",
          label: "Paid response",
          description: "Fund the response",
          outcomeTable: [
            {
              minRoll: 1,
              maxRoll: 100,
              label: "paid outcome",
              effects: [
                { type: "treasuryDelta", deltaAnchor: -5 },
                { type: "approvalDelta", delta: 2 },
              ],
            },
          ],
        },
      ],
      applyEffects: async (ctx) => {
        await applyDeclarativeEffects(ctx, ctx.tier.effects);
        if (ctx.option.id === "free") {
          freeEffectsApplied();
          await letFreeChoiceFinish;
        }
      },
    });
    let signalFree!: () => void;
    let releaseFree!: () => void;
    const freeApplied = new Promise<void>((resolve) => {
      signalFree = resolve;
    });
    const letFreeChoiceFinish = new Promise<void>((resolve) => {
      releaseFree = resolve;
    });
    const freeEffectsApplied = (): void => signalFree();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
    const { getHeadOfGovernmentCharacterId } = await import("@/lib/api/headOfGovernment");
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(characterId);

    const freeResolve = callRoute(makeRequest("free"), instanceId.toHexString());
    await freeApplied;
    const paidResponse = await callRoute(makeRequest("paid"), instanceId.toHexString());
    releaseFree();
    const freeResponse = await freeResolve;

    expect(freeResponse.status).toBe(200);
    expect(paidResponse.status).toBe(400);
    const resolved = memory.collection("eventInstances").docs[0] as unknown as EventInstance;
    expect(resolved.resolutionClaim).toMatchObject({ optionId: "free", reason: "player" });
    expect(resolved).toMatchObject({ status: "resolved", resolvedOptionId: "free" });
    expect(memory.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(20);
    expect(memory.collection("governmentApprovals").docs[0]?.approvalRating).toBe(51);
  });
});
