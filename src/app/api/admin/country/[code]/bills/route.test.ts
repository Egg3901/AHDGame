import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { AuthUserWithCharacter } from "@/lib/auth";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/legislationEffects", () => ({ applyLegislationEffect: vi.fn() }));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn() }));

describe("POST /api/admin/country/[code]/bills", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bills");
    db.collection("gameState");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { applyLegislationEffect } = await import("@/lib/legislationEffects");
    const { onBillEnacted } = await import("@/lib/billEnactment");
    const admin: AuthUserWithCharacter = {
      userId: new ObjectId().toString(),
      username: "admin",
      email: "admin@example.com",
      role: "admin",
      isAdmin: true,
      hasCharacter: false,
    };
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin,
    } as Awaited<ReturnType<typeof requireAdmin>>);
    vi.mocked(applyLegislationEffect).mockResolvedValue(undefined);
    vi.mocked(onBillEnacted).mockResolvedValue(undefined);
  });

  it("force_sign applies legislation effects before running enactment hooks", async () => {
    const billId = new ObjectId();
    const bill = {
      _id: billId,
      title: "Decolonize the Market Act",
      status: "enrolled",
      provisions: [
        {
          type: "tariff",
          scopeType: "origin_country",
          targetOriginCountryId: "JP",
          rate: 40,
        },
      ],
      countryId: "US",
    };

    db.collectionMocks.bills.findOne.mockResolvedValue(bill);
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 117 });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/country/us/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "force_sign", billId: billId.toString() }),
      }),
      { params: Promise.resolve({ code: "us" }) }
    );

    expect(response.status).toBe(200);

    const { applyLegislationEffect } = await import("@/lib/legislationEffects");
    const { onBillEnacted } = await import("@/lib/billEnactment");

    expect(applyLegislationEffect).toHaveBeenCalledWith(db, bill);
    expect(onBillEnacted).toHaveBeenCalledWith(db, bill, 117);
  });
});

describe("GET /api/admin/country/[code]/bills", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bills");
    db.collection("legislationTypes");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const admin: AuthUserWithCharacter = {
      userId: new ObjectId().toString(),
      username: "admin",
      email: "admin@example.com",
      role: "admin",
      isAdmin: true,
      hasCharacter: false,
    };
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin,
    } as Awaited<ReturnType<typeof requireAdmin>>);
  });

  it("filters chamber queries by currentChamber so advanced bills appear in the active chamber queue", async () => {
    db.collectionMocks.bills.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    } as never);
    db.collectionMocks.bills.countDocuments.mockResolvedValue(0);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/country/us/bills?chamber=senate"),
      { params: Promise.resolve({ code: "us" }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.bills.find).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "US", currentChamber: "senate" })
    );
    expect(db.collectionMocks.bills.find).not.toHaveBeenCalledWith(
      expect.objectContaining({ originChamber: expect.anything() })
    );
  });
});
