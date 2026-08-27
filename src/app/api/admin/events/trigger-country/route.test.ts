import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const createCrisisFromTemplate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(438) }));
vi.mock("@/lib/crises/createCrisisFromTemplate", () => ({ createCrisisFromTemplate }));

describe("POST /api/admin/events/trigger-country", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("eventDefinitions");
    db.collection("eventInstances");
    db.collection("crises");
    db.collectionMocks.crises!.findOne.mockResolvedValue(null);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { username: "admin" } } as never);
  });

  it("creates a wartime bank run as a crisis and never as a country event card", async () => {
    const crisisId = new ObjectId();
    createCrisisFromTemplate.mockResolvedValue(crisisId);
    db.collectionMocks.eventDefinitions!.findOne.mockResolvedValue({
      kind: "worldEvents.bankRun",
      status: "approved",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/events/trigger-country", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryId: "US", kind: "worldEvents.bankRun" }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      crisis: { crisisId: crisisId.toHexString(), templateKey: "war_bank_run", startTurn: 439 },
    });
    expect(createCrisisFromTemplate).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        templateKey: "war_bank_run",
        countryIds: ["US"],
        currentTurn: 439,
      })
    );
    expect(db.collectionMocks.eventInstances!.insertOne).not.toHaveBeenCalled();
  });
});
