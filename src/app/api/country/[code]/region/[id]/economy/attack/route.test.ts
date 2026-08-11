import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireHumanSession: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));

let db: MockDb;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/RU/region/UKR/economy/attack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = (code: string, id: string) => ({ params: Promise.resolve({ code, id }) });

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("gameState");
  db.collection("states");
  db.collection("users");
  db.collection("corporations");
  db.collection("gameConfig");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireHumanSession } = await import("@/lib/api/requireAuth");
  vi.mocked(requireHumanSession).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);

  db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current" });
});

describe("POST /api/country/[code]/region/[id]/economy/attack — command-economy gate", () => {
  it("rejects a split attempt in a command-economy country (RU/USSR) before touching the body", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ sectorType: "energy" }), ctx("RU", "UKR"));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/state-controlled/i);
    // Never got far enough to look up the state.
    expect(db.collectionMocks.states.findOne).not.toHaveBeenCalled();
  });

  it("rejects a split attempt in another always-command country (DD/East Germany)", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ sectorType: "manufacturing" }), ctx("DD", "SAX"));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/state-controlled/i);
  });

  it("does not block a normal market country (US) at the command-economy gate", async () => {
    db.collectionMocks.states.findOne.mockResolvedValue(null); // short-circuit with 404 next

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ sectorType: "energy" }), ctx("US", "CA"));
    const data = await response.json();

    // Passed the command-economy gate — fails later for an unrelated reason
    // (no such state), proving the gate itself let it through.
    expect(response.status).toBe(404);
    expect(data.error).not.toMatch(/state-controlled/i);
    expect(db.collectionMocks.states.findOne).toHaveBeenCalled();
  });
});

describe("POST /api/country/[code]/region/[id]/economy/attack — plants retires splitting", () => {
  it("rejects a split under the plants tier before touching the body", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ sectorType: "energy" }), ctx("US", "CA"));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/retired/i);
    expect(data.error).toMatch(/capacity/i);
    // Guard runs before any state lookup, like the command-economy one.
    expect(db.collectionMocks.states.findOne).not.toHaveBeenCalled();
  });

  it("still allows splitting below plants (capital tier)", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });
    db.collectionMocks.states.findOne.mockResolvedValue(null); // short-circuit with 404 next

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ sectorType: "energy" }), ctx("US", "CA"));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).not.toMatch(/retired/i);
    expect(db.collectionMocks.states.findOne).toHaveBeenCalled();
  });
});
