import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/governorOffice/orders/issueOrder", () => ({
  issueOrder: vi.fn(),
}));

const { requireHumanSessionWithCharacter } = await import("@/lib/api/requireAuth");
vi.mock("@/lib/api/requireAuth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/requireAuth")>();
  return { ...original, requireHumanSessionWithCharacter: vi.fn() };
});

function mockDb() {
  const db = createMockDb();
  for (const name of ["countryState", "electedOfficials"]) {
    db.collection(name);
  }
  return { db, collectionMocks: db.collectionMocks };
}

function post(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/US/executive/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/executive/orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets the sitting president issue a national order", async () => {
    const presidentId = new ObjectId();
    const { db, collectionMocks } = mockDb();
    collectionMocks["countryState"]!.findOne.mockResolvedValue({
      _id: "US",
      governmentType: "presidential",
    });
    collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      countryId: "US",
      officeType: "president",
      characterId: presidentId,
    });
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: presidentId, name: "President Test" } },
    } as never);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as never);
    const { issueOrder } = await import("@/lib/governorOffice/orders/issueOrder");
    vi.mocked(issueOrder).mockResolvedValue({ body: { success: true }, status: 200 } as never);

    const { POST } = await import("./route");
    const res = await POST(post({ legislationTypeId: "income_tax", effectDirection: 1 }), {
      params: Promise.resolve({ code: "US" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });
    expect(issueOrder).toHaveBeenCalledOnce();
  });

  it("rejects a non-leader with 403", async () => {
    const { db, collectionMocks } = mockDb();
    collectionMocks["countryState"]!.findOne.mockResolvedValue({
      _id: "US",
      governmentType: "presidential",
    });
    collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      countryId: "US",
      officeType: "president",
      characterId: new ObjectId(),
    });
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: new ObjectId(), name: "Backbencher" } },
    } as never);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { POST } = await import("./route");
    const res = await POST(post({ legislationTypeId: "income_tax", effectDirection: 1 }), {
      params: Promise.resolve({ code: "US" }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "Only the sitting leader can issue national orders",
    });
  });
});
