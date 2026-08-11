import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function cursor<T>(rows: T[]) {
  const c = {
    toArray: vi.fn().mockResolvedValue(rows),
    project: vi.fn(() => c),
  };
  return c;
}

const params = (code: string) => ({ params: Promise.resolve({ code }) });

describe("GET /api/country/[code]/national-corporations", () => {
  let db: MockDb;
  const primaryId = new ObjectId();
  const splitOffId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("characters");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("offers only the sector types the primary NatCorp actually holds", async () => {
    db.collectionMocks.corporations.find.mockReturnValue(
      cursor([
        {
          _id: primaryId,
          name: "China National Corporation",
          isPrimaryNationalCorporation: true,
          ceoVacant: true,
        },
        {
          _id: splitOffId,
          name: "Energy Division",
          isPrimaryNationalCorporation: false,
          assignedSectorTypes: ["energy"],
          ceoVacant: true,
        },
      ])
    );
    // Primary holds technology + manufacturing; the split-off holds energy.
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        { corporationId: primaryId, sectorType: "technology" },
        { corporationId: primaryId, sectorType: "manufacturing" },
        { corporationId: splitOffId, sectorType: "energy" },
      ])
    );
    db.collectionMocks.characters.find.mockReturnValue(cursor([]));

    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://x/api/country/cn/national-corporations"),
      params("cn")
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // Only the primary's held types — not all 16, not the split-off's "energy".
    expect(body.splittableSectorTypes).toEqual(["manufacturing", "technology"]);
    expect(body.splittableSectorTypes).not.toContain("energy");
    expect(body.splittableSectorTypes).not.toContain("financial");
  });

  it("returns an empty splittable list when the primary holds nothing", async () => {
    db.collectionMocks.corporations.find.mockReturnValue(
      cursor([
        { _id: primaryId, name: "Primary", isPrimaryNationalCorporation: true, ceoVacant: true },
      ])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([]));
    db.collectionMocks.characters.find.mockReturnValue(cursor([]));

    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://x/api/country/cn/national-corporations"),
      params("cn")
    );
    const body = await res.json();
    expect(body.splittableSectorTypes).toEqual([]);
  });
});
