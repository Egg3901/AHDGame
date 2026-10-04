import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Bill } from "@/lib/db/types/legislation";

const notifyBillsVoteOpen = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/turn/billLifecycle/lifecycleHelpers", () => ({
  notifyBillsVoteOpen: (...args: unknown[]) => notifyBillsVoteOpen(...args),
}));

const { buildOrganizationWarDeclarationBills } =
  await import("../buildOrganizationWarDeclarationBills");

function setup() {
  const db = createMockDb();
  db.collection("bills");
  db.collectionMocks.bills.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  } as never);
  db.collectionMocks.bills.insertMany.mockResolvedValue({ acknowledged: true } as never);
  return db;
}

async function run(db: ReturnType<typeof setup>) {
  return buildOrganizationWarDeclarationBills({
    db: db as unknown as Db,
    preset: "1953-default",
    currentTurn: 100,
    organizationId: "NATO",
    resolutionId: "507f1f77bcf86cd799439012",
    targetCountryId: "CN",
    targetCountryName: "China",
    provision: {
      type: "declare_war",
      targetCountry: "CN",
      warGoal: "punitive",
      organizationId: "NATO",
      resolutionId: "507f1f77bcf86cd799439012",
    },
    sponsors: [
      { countryId: "US", characterId: new ObjectId(), characterName: "US President" },
      { countryId: "UK", characterId: new ObjectId(), characterName: "UK Prime Minister" },
    ],
  });
}

describe("buildOrganizationWarDeclarationBills", () => {
  beforeEach(() => notifyBillsVoteOpen.mockClear());

  it("inserts every national declaration together with concurrent chamber clocks", async () => {
    const db = setup();
    await run(db);

    expect(db.collectionMocks.bills.insertMany).toHaveBeenCalledTimes(1);
    const docs = db.collectionMocks.bills.insertMany.mock.calls[0]![0] as Bill[];
    expect(docs.map((bill) => bill.countryId).sort()).toEqual(["UK", "US"]);
    for (const bill of docs) {
      expect(bill.status).toBe("active_both");
      expect(bill.votingEndsOnTurn).toBe(124);
      expect(bill.otherChamberVotingEndsOnTurn).toBe(124);
      expect(bill.otherChamberVotes).toEqual({});
      expect(bill.provisions).toEqual([
        expect.objectContaining({
          type: "declare_war",
          targetCountry: "CN",
          organizationId: "NATO",
          resolutionId: "507f1f77bcf86cd799439012",
        }),
      ]);
    }
  });

  it("opens both US chambers at once and only the voting UK chamber", async () => {
    const db = setup();
    await run(db);

    const notices = (
      notifyBillsVoteOpen.mock.calls[0]![1] as Array<{ bill: Bill; chamberType: string }>
    ).map((opening) => ({
      countryId: opening.bill.countryId,
      chamber: opening.chamberType,
    }));
    expect(notices.filter((notice) => notice.countryId === "US")).toHaveLength(2);
    expect(notices.filter((notice) => notice.countryId === "UK")).toHaveLength(1);
  });
});
