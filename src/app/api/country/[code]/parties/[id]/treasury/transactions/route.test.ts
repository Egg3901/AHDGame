import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/db/treasuryTransactionLookup", () => ({
  listHolderTreasuryTransactions: vi.fn(),
}));

describe("GET /api/country/[code]/parties/[id]/treasury/transactions", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "tester" },
    } as Awaited<ReturnType<typeof requireAuth>>);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 2,
      countryId: "US",
      name: "Republican Party",
    } as never);
  });

  it("loads only national-party holder rows for the national treasury log", async () => {
    const createdAt = new Date("2026-05-04T15:00:14.157Z");
    const { listHolderTreasuryTransactions } = await import("@/lib/db/treasuryTransactionLookup");
    vi.mocked(listHolderTreasuryTransactions).mockResolvedValue([
      {
        _id: new ObjectId(),
        holderType: "party",
        holderId: "2",
        countryId: "US",
        partyId: "2",
        category: "gotv",
        direction: "debit",
        amount: 756145,
        memo: "GOTV operations",
        turn: 571,
        createdAt,
      },
    ] as never);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/us/parties/2/treasury/transactions"),
      {
        params: Promise.resolve({ code: "us", id: "2" }),
      }
    );

    expect(response.status).toBe(200);
    expect(listHolderTreasuryTransactions).toHaveBeenCalledWith(db, {
      holderType: "party",
      holderId: "2",
      countryId: "US",
      options: {
        before: undefined,
        limit: 50,
        category: undefined,
        direction: undefined,
      },
    });

    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      holderType: "party",
      holderId: "2",
      amount: 756145,
    });
  });
});
