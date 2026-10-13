import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { makeCorporation } from "@/lib/test-utils/factories";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { GET } from "../route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ getEnabledCountryIds: vi.fn(async () => ["US"]) }));

let db: MockDb;
const parent = makeCorporation();
const children = Array.from({ length: 20 }, () =>
  makeCorporation({
    isPrivate: true,
    totalShares: 100,
    shareholders: [{ corporationId: parent._id, shares: 80 }],
  })
);
beforeEach(() => {
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const col = db.collection("corporations");
  const cursor = col.find();
  col.find.mockClear();
  col.find.mockImplementation((filter: Record<string, unknown>) => {
    cursor.toArray.mockResolvedValue(filter._id ? [parent] : children);
    return cursor;
  });
});

describe("corporation listing parent visibility", () => {
  it("reveals private books to the controlling parent CEO with bounded reads and private caching", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: parent.userId!.toString(),
      isAdmin: false,
    } as never);
    const response = await GET(new Request("http://localhost/api/corporations"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.corporations).toHaveLength(20);
    for (const row of data.corporations) expect(row.liquidCapital).toBe(1_000_000);
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(db.collectionMocks.corporations.find).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.corporations.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.shareOrders.find).toHaveBeenCalledOnce();
    expect(db.collectionMocks.shareListings.find).toHaveBeenCalledOnce();
  });
  it.each([null, { userId: new ObjectId().toString(), isAdmin: false }])(
    "keeps private books redacted for an outsider",
    async (viewer) => {
      vi.mocked(getAuthUser).mockResolvedValue(viewer as never);
      const response = await GET(new Request("http://localhost/api/corporations"));
      expect(response.status).toBe(200);
      const data = await response.json();
      for (const row of data.corporations) {
        expect(row).not.toHaveProperty("liquidCapital");
        expect(row.isPrivate).toBe(true);
      }
    }
  );
});
