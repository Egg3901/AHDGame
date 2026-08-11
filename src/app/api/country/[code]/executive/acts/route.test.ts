import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");

function mockFind(rows: unknown[]) {
  const cursor = {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn(),
    limit: vi.fn(),
    project: vi.fn(),
  };
  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  cursor.project.mockReturnValue(cursor);
  return cursor;
}

describe("GET /api/country/[code]/executive/acts", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("legislationTypes");
    db.collectionMocks.legislationTypes.find.mockReturnValue(
      mockFind([
        {
          _id: "acts_test_hiring",
          countryScope: "us",
          name: "Federal Hiring Policy",
          policyOptions: [],
        },
      ])
    );
    db.collection("bills");
    db.collectionMocks.bills.find.mockReturnValue(
      mockFind([
        {
          _id: new ObjectId(),
          title: "Rural Broadband Investment Act",
          status: "signed",
          enactedAt: new Date("2026-03-01"),
          proposedAt: new Date("2026-01-01"),
        },
      ])
    );
    db.collection("governorExecutiveOrders");
    db.collectionMocks.governorExecutiveOrders.find.mockReturnValue(
      mockFind([
        {
          _id: new ObjectId(),
          legislationTypeId: "acts_test_hiring",
          issuedByName: "A. Whitmore",
          issuedAtTurn: 1279,
          createdAt: new Date("2026-02-15"),
        },
      ])
    );
    db.collection("cabinetNominations");
    db.collectionMocks.cabinetNominations.find.mockReturnValue(mockFind([]));
    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers.find.mockReturnValue(
      mockFind([
        {
          _id: new ObjectId(),
          characterName: "M. Ruiz",
          positionId: "secretary_of_the_treasury",
          confirmedAt: new Date("2026-02-10"),
        },
      ])
    );
  });

  async function call(code = "us") {
    const { GET } = await import("@/app/api/country/[code]/executive/acts/route");
    const response = await GET(new Request(`http://localhost/api/country/${code}/executive/acts`), {
      params: Promise.resolve({ code }),
    });
    return { response, body: await response.json() };
  }

  it("rejects invalid country codes", async () => {
    const { response } = await call("zz");
    expect(response.status).toBe(400);
  });

  it("merges bills, orders, and cabinet events newest-first with resolved labels", async () => {
    const { response, body } = await call();
    expect(response.status).toBe(200);
    expect(body.acts.map((a: { kind: string }) => a.kind)).toEqual([
      "signed",
      "order",
      "confirmed",
    ]);
    expect(body.acts[1].title).toBe("Federal Hiring Policy");
    expect(body.acts[1].turn).toBe(1279);
    expect(body.acts[2].title).toContain("Secretary of the Treasury");
  });

  it("returns an empty ledger when no sources have rows", async () => {
    db.collectionMocks.bills.find.mockReturnValue(mockFind([]));
    db.collectionMocks.governorExecutiveOrders.find.mockReturnValue(mockFind([]));
    db.collectionMocks.cabinetMembers.find.mockReturnValue(mockFind([]));
    const { body } = await call();
    expect(body.acts).toEqual([]);
  });

  it("counts on-desk bills as the desk figure for bills-desk countries", async () => {
    db.collectionMocks.bills.find.mockReturnValue(
      mockFind([
        {
          _id: new ObjectId(),
          title: "Estate Tax Adjustment",
          status: "enrolled",
          sentToPresidentAt: new Date("2026-04-01"),
          proposedAt: new Date("2026-01-01"),
        },
      ])
    );
    const { body } = await call();
    expect(body.deskCount).toBe(1);
  });

  it("counts active national orders as the desk figure for orders-desk countries", async () => {
    db.collectionMocks.governorExecutiveOrders.countDocuments.mockResolvedValue(3);
    const { body } = await call("cn");
    expect(body.deskCount).toBe(3);
  });
});
