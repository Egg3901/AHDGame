import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("region metrics route — approvalHistory", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("macroMetrics");
    db.collection("stateApprovalHistory");

    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      population: 1000,
    });
    db.collectionMocks.macroMetrics!.findOne.mockImplementation((filter: { _id: string }) =>
      Promise.resolve(
        filter._id === "CA"
          ? { _id: "CA", countryId: "US", economic: { unemploymentRate: { value: 5 } } }
          : null
      )
    );
    db.collectionMocks.stateApprovalHistory!.findOne.mockResolvedValue({
      _id: "CA",
      stateId: "CA",
      countryId: "US",
      approvalRating: 50,
      history: [
        { turn: 1, approval: 48, net: -4 },
        { turn: 2, approval: 50, net: 0 },
      ],
      updatedAt: new Date("2026-06-05T00:00:00.000Z"),
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns the region's approval history", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/country/us/region/CA/metrics"), {
      params: Promise.resolve({ code: "us", id: "CA" }),
    });
    const json = await res.json();
    expect(json.approvalHistory).toEqual([
      { turn: 1, approval: 48, net: -4 },
      { turn: 2, approval: 50, net: 0 },
    ]);
  });

  it("defaults approvalHistory to an empty array when no doc exists", async () => {
    db.collectionMocks.stateApprovalHistory!.findOne.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/country/us/region/CA/metrics"), {
      params: Promise.resolve({ code: "us", id: "CA" }),
    });
    const json = await res.json();
    expect(json.approvalHistory).toEqual([]);
  });
});
