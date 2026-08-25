import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));

describe("GET /api/country/[code]/parties/[id]/activity-feed", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("treasuryTransactions");
    db.collection("slateCandidates");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "tester" },
    } as Awaited<ReturnType<typeof requireAuth>>);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: "dem-us",
      sequentialId: 1,
      countryId: "US",
      name: "Democratic Party",
    } as never);
  });

  it("filters treasury rows to national-party holder entries so state-party GOTV spam stays out of the national feed", async () => {
    db.collectionMocks.treasuryTransactions.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    } as never);
    db.collectionMocks.slateCandidates.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    } as never);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/us/parties/1/activity-feed"),
      {
        params: Promise.resolve({ code: "us", id: "1" }),
      }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.treasuryTransactions.find).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "US",
        partyId: "1",
        holderType: "party",
      })
    );
  });

  it("hides turnout, org-building, and fund-generation treasury noise from overview activity", async () => {
    const createdAt = new Date("2026-05-01T12:00:00Z");
    db.collectionMocks.treasuryTransactions.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: new ObjectId(),
              holderType: "party",
              holderId: "1",
              countryId: "US",
              partyId: "1",
              category: "gotv",
              direction: "debit",
              amount: 5000,
              memo: "GOTV operations",
              turn: 500,
              createdAt,
            },
            {
              _id: new ObjectId(),
              holderType: "party",
              holderId: "1",
              countryId: "US",
              partyId: "1",
              category: "fund_generation",
              direction: "credit",
              amount: 7000,
              memo: "National tax (10%) on member fund generation",
              turn: 500,
              createdAt,
            },
            {
              _id: new ObjectId(),
              holderType: "party",
              holderId: "1",
              countryId: "US",
              partyId: "1",
              category: "operations",
              direction: "debit",
              amount: 3000,
              memo: "Org building operations",
              turn: 500,
              createdAt,
            },
            {
              _id: new ObjectId(),
              holderType: "party",
              holderId: "1",
              countryId: "US",
              partyId: "1",
              category: "recruitment",
              direction: "debit",
              amount: 2000,
              currencyCode: "USD",
              memo: "Recruitment drive",
              turn: 500,
              createdAt,
            },
          ]),
        }),
      }),
    } as never);
    db.collectionMocks.slateCandidates.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    } as never);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/us/parties/1/activity-feed"),
      {
        params: Promise.resolve({ code: "us", id: "1" }),
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      items: Array<{ type: string; detail?: string; summary: string }>;
    };
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toMatchObject({
      type: "treasury",
      detail: "recruitment",
      summary: "-$2,000 | Recruitment drive",
    });
  });
});

describe("describeSlateActivity", () => {
  it("treats pre-file accepted rows as slate assignments", async () => {
    const invitedAt = new Date("2026-04-28T12:00:00Z");
    const { describeSlateActivity } = await import("./route");
    const activity = describeSlateActivity({
      status: "accepted",
      refusalReason: null,
      invitedAt,
      respondedAt: invitedAt,
      filedAt: null,
      updatedAt: invitedAt,
    });

    expect(activity.summary).toBe("assigned to slate");
    expect(activity.createdAt).toEqual(invitedAt);
  });

  it("uses the filed timestamp when a candidate enters the race", async () => {
    const invitedAt = new Date("2026-04-28T12:00:00Z");
    const filedAt = new Date("2026-04-28T13:00:00Z");
    const { describeSlateActivity } = await import("./route");
    const activity = describeSlateActivity({
      status: "filed",
      refusalReason: null,
      invitedAt,
      respondedAt: invitedAt,
      filedAt,
      updatedAt: filedAt,
    });

    expect(activity.summary).toBe("filed via slate");
    expect(activity.createdAt).toEqual(filedAt);
  });

  it("only shows declines after the turn resolves them", async () => {
    const invitedAt = new Date("2026-04-28T12:00:00Z");
    const respondedAt = new Date("2026-04-28T13:00:00Z");
    const { describeSlateActivity } = await import("./route");
    const activity = describeSlateActivity({
      status: "declined",
      refusalReason: null,
      invitedAt,
      respondedAt,
      filedAt: null,
      updatedAt: respondedAt,
    });

    expect(activity.summary).toBe("declined slate offer");
    expect(activity.createdAt).toEqual(respondedAt);
  });

  it("describes withdrawn rows as being removed from the slate", async () => {
    const invitedAt = new Date("2026-04-28T12:00:00Z");
    const updatedAt = new Date("2026-04-28T14:00:00Z");
    const { describeSlateActivity } = await import("./route");
    const activity = describeSlateActivity({
      status: "withdrawn",
      refusalReason: null,
      invitedAt,
      respondedAt: null,
      filedAt: null,
      updatedAt,
    });

    expect(activity.summary).toBe("removed from slate");
    expect(activity.createdAt).toEqual(updatedAt);
  });

  // #1181: the turn's filing pass tombstones rows it cannot file. Reporting
  // those as "removed from slate" blamed the chair for a system outcome.
  it("distinguishes a row the turn could not file from a chair removal", async () => {
    const invitedAt = new Date("2026-04-28T12:00:00Z");
    const updatedAt = new Date("2026-04-28T14:00:00Z");
    const { describeSlateActivity } = await import("./route");
    const activity = describeSlateActivity({
      status: "withdrawn",
      refusalReason: "ineligible_region",
      invitedAt,
      respondedAt: updatedAt,
      filedAt: null,
      updatedAt,
    });

    expect(activity.summary).toBe("could not be filed from the slate");
    expect(activity.createdAt).toEqual(updatedAt);
  });
});

describe("shouldIncludePartyOverviewTreasuryActivity", () => {
  it("suppresses turnout, tax generation, and org-building rows", async () => {
    const { shouldIncludePartyOverviewTreasuryActivity } = await import("./route");

    expect(
      shouldIncludePartyOverviewTreasuryActivity({
        category: "gotv",
        memo: "GOTV operations",
      })
    ).toBe(false);
    expect(
      shouldIncludePartyOverviewTreasuryActivity({
        category: "suppression",
        memo: "Suppression operations",
      })
    ).toBe(false);
    expect(
      shouldIncludePartyOverviewTreasuryActivity({
        category: "fund_generation",
        memo: "National tax (10%) on member fund generation",
      })
    ).toBe(false);
    expect(
      shouldIncludePartyOverviewTreasuryActivity({
        category: "operations",
        memo: "Org building operations",
      })
    ).toBe(false);
    expect(
      shouldIncludePartyOverviewTreasuryActivity({
        category: "recruitment",
        memo: "Recruitment drive",
      })
    ).toBe(true);
  });
});
