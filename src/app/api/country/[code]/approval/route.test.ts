import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function cursorOf<T>(data: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(data),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("national approval route — canonical stored value", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("stateMetrics");
    db.collection("governmentApprovals");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  async function call() {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/country/us/approval"), {
      params: Promise.resolve({ code: "us" }),
    });
    return res.json();
  }

  it("returns the stored snapshot approvalRating (matches the history), not a live recompute", async () => {
    db.collectionMocks.governmentApprovals!.findOne.mockResolvedValue({
      _id: "US",
      approvalRating: 42.1,
      history: [
        { turn: 4, approval: 42.4, net: -15.2 },
        { turn: 5, approval: 42.1, net: -15.8 },
      ],
    });
    // Live metrics exist but must NOT override the stored value.
    db.collectionMocks.states!.find.mockReturnValue(
      cursorOf([{ _id: "CA", population: 1000 }]) as never
    );
    db.collectionMocks.stateMetrics!.find.mockReturnValue(
      cursorOf([{ _id: "CA", economic: { unemploymentRate: { value: 4 } } }]) as never
    );

    const json = await call();
    expect(json.governmentApproval).toBe(42.1);
    expect(json.history.at(-1).approval).toBe(42.1);
  });

  it("falls back to BASE_APPROVAL when there is neither a snapshot nor metrics", async () => {
    db.collectionMocks.governmentApprovals!.findOne.mockResolvedValue(null);
    db.collectionMocks.states!.find.mockReturnValue(cursorOf([]) as never);
    db.collectionMocks.stateMetrics!.find.mockReturnValue(cursorOf([]) as never);
    const { BASE_APPROVAL } = await import("@/lib/utils/governmentApproval");

    const json = await call();
    expect(json.governmentApproval).toBe(BASE_APPROVAL);
  });
});
