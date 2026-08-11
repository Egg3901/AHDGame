import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
import { getDb } from "@/lib/mongodb";
import { GET } from "./route";

const params = (code: string) => ({ params: Promise.resolve({ code }) });

describe("GET referendums/active", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports true when a campaigning referendum exists", async () => {
    const db = createMockDb();
    db.collection("referendums").countDocuments.mockResolvedValue(1);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const res = await GET(new Request("http://x"), params("uk"));
    expect(await res.json()).toEqual({ hasActiveCampaign: true });
    expect(db.collectionMocks["referendums"].countDocuments).toHaveBeenCalledWith({
      countryId: "UK",
      status: "campaigning",
    });
  });

  it("reports false for an unknown country", async () => {
    vi.mocked(getDb).mockResolvedValue(createMockDb() as never);
    const res = await GET(new Request("http://x"), params("zz"));
    expect(await res.json()).toEqual({ hasActiveCampaign: false });
  });
});
