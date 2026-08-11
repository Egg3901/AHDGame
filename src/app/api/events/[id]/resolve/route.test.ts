import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { EventInstance } from "@/lib/db/types/events";
import { registerEventHandler } from "@/lib/events/substrate/registry";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: vi.fn(),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 12 }),
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
});
