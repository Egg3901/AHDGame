import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Bill } from "@/lib/db/types/legislation";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { loadMembershipDefenseWarnings } from "./membershipDefenseWarnings";

const organizations = (category: "bloc" | "security" = "bloc") => [
  {
    id: "NATO",
    def: { category },
    pendingMembershipProposals: [{ proposingCountryId: "DE" as const }],
  },
];

describe("loadMembershipDefenseWarnings", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("conflicts");
    db.collection("bills");
  });

  it("reports a live defensive war with the side the bloc may join", async () => {
    const conflict = {
      _id: "war_ru_de_10",
      name: "Soviet Union-Germany War",
      status: "active",
      hostCountry: "DE",
      sideA: { label: "Soviet Union", countries: ["RU"] },
      sideB: { label: "Germany", countries: ["DE"] },
    } as ConflictDoc;
    db.collectionMocks.conflicts.find.mockReturnValue(createAsyncIterableCursor([conflict]));

    const result = await loadMembershipDefenseWarnings(
      db as unknown as Db,
      organizations(),
      "1953-default"
    );

    expect(result.get("NATO")).toEqual([
      expect.objectContaining({
        applicantCountryId: "DE",
        kind: "active_conflict",
        conflictId: "war_ru_de_10",
        side: "B",
        opposingNames: ["Soviet Union"],
      }),
    ]);
    const declarationQuery = db.collectionMocks.bills.find.mock.calls[0]?.[0] as {
      status?: { $in?: string[] };
    };
    expect(declarationQuery.status?.$in).not.toContain("filibustered");
  });

  it("reports a declaration still before the aggressor's legislature", async () => {
    const bill = {
      _id: new ObjectId("507f1f77bcf86cd799439011"),
      countryId: "RU",
      status: "active",
      provisions: [{ type: "declare_war", targetCountry: "DE", warGoal: "punitive" }],
    } as Bill;
    db.collectionMocks.bills.find.mockReturnValue(createAsyncIterableCursor([bill]));

    const result = await loadMembershipDefenseWarnings(
      db as unknown as Db,
      organizations(),
      "1953-default"
    );

    expect(result.get("NATO")).toEqual([
      expect.objectContaining({
        applicantCountryId: "DE",
        kind: "pending_declaration",
        declarationBillId: bill._id.toString(),
        opposingNames: ["Soviet Union"],
      }),
    ]);
  });

  it("does not expose wartime accession warnings for an org without entry powers", async () => {
    const result = await loadMembershipDefenseWarnings(
      db as unknown as Db,
      organizations("security"),
      "1953-default"
    );

    expect(result.size).toBe(0);
    expect(db.collectionMocks.conflicts.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.bills.find).not.toHaveBeenCalled();
  });

  it("does not imply that an undesignated custom bloc has a mutual-defence charter", async () => {
    const result = await loadMembershipDefenseWarnings(
      db as unknown as Db,
      [
        {
          id: "custom-bloc",
          def: { category: "bloc" },
          pendingMembershipProposals: [{ proposingCountryId: "DE" as const }],
        },
      ],
      "1953-default"
    );

    expect(result.size).toBe(0);
    expect(db.collectionMocks.conflicts.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.bills.find).not.toHaveBeenCalled();
  });
});
