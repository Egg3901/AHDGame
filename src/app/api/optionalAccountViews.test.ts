import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getAuthUser, type AuthUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { buildNationalCorporationView } from "@/lib/nationalization/nationalCorporationView";
import {
  getNoConfidenceVoteView,
  getPmAppointmentVoteView,
} from "@/lib/government/queries/parliamentaryGovernment";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/db/characterLookup", () => ({
  getCharacterByUserId: vi.fn(),
  bulkFetchCharacterNames: vi.fn(),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn().mockResolvedValue({ ok: true, corporation: {} }),
}));
vi.mock("@/lib/nationalization/nationalCorporation", () => ({
  isStateOwned: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/nationalization/nationalCorporationView", () => ({
  buildNationalCorporationView: vi.fn().mockResolvedValue({ viewerIsOfficial: false }),
}));
vi.mock("@/lib/nationalization/auctionListing", () => ({
  buildAuctionListings: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(1) }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn().mockResolvedValue({ currentTurn: 1 }) }));
vi.mock("@/lib/government/queries/parliamentaryGovernment", () => ({
  getNoConfidenceVoteView: vi.fn().mockResolvedValue({ myVote: null }),
  getPmAppointmentVoteView: vi.fn().mockResolvedValue({ myVote: null }),
}));
vi.mock("@/lib/congress/governmentVoteBreakdown", () => ({
  computeCabinetNominationTally: vi
    .fn()
    .mockResolvedValue({ votesFor: 0, votesAgainst: 0, votesAbstain: 0 }),
}));

const objectId = new ObjectId();
const request = new Request("https://example.test/api/view");
const idParams = { params: Promise.resolve({ id: objectId.toHexString() }) };
const voteParams = { params: Promise.resolve({ code: "UK", voteId: objectId.toHexString() }) };
const countryParams = { params: Promise.resolve({ code: "US" }) };
const routes = [
  {
    name: "cabinet list",
    run: async () => (await import("./congress/cabinet-nominations/route")).GET(),
  },
  {
    name: "cabinet detail",
    run: async () =>
      (await import("./congress/cabinet-nominations/[id]/route")).GET(request, idParams),
  },
  {
    name: "justice list",
    run: async () => (await import("./congress/scotus-nominations/route")).GET(),
  },
  {
    name: "justice detail",
    run: async () =>
      (await import("./congress/scotus-nominations/[id]/route")).GET(request, idParams),
  },
  {
    name: "national corporation",
    run: async () => (await import("./corporations/[id]/national/route")).GET(request, idParams),
  },
  {
    name: "nationalization auctions",
    run: async () =>
      (await import("./country/[code]/nationalization-auctions/route")).GET(request, countryParams),
  },
  {
    name: "PM appointment",
    run: async () =>
      (await import("./country/[code]/pm/appoint/[voteId]/route")).GET(request, voteParams),
  },
  {
    name: "no confidence",
    run: async () =>
      (await import("./country/[code]/pm/no-confidence/[voteId]/route")).GET(request, voteParams),
  },
  {
    name: "bond detail",
    run: async () =>
      (await import("./bonds/[bondId]/route")).GET(request, {
        params: Promise.resolve({ bondId: objectId.toHexString() }),
      }),
  },
  {
    name: "suggestion detail",
    run: async () =>
      (await import("./suggestions/public/[issueNumber]/route")).GET(request, {
        params: Promise.resolve({ issueNumber: "1" }),
      }),
  },
];

const currentAccount: AuthUser = {
  userId: new ObjectId().toHexString(),
  username: "viewer",
  email: "viewer@example.test",
  role: "player",
  isAdmin: false,
  isModerator: false,
  isBanned: false,
};

describe("optional account views", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(getAuthUser).mockResolvedValue(null);
    vi.mocked(getCharacterByUserId).mockResolvedValue(null);
    for (const name of ["cabinetNominations", "scotusNominations", "bonds"]) {
      db.collection(name).findOne.mockResolvedValue({
        _id: objectId,
        nomineeCharacterId: new ObjectId(),
        countryId: "US",
        positionId: "secretary-of-state",
        status: "active",
        votes: {},
      });
    }
    db.collection("suggestions").findOne.mockResolvedValue({
      _id: objectId,
      issueNumber: 1,
      title: "Synthetic suggestion",
      status: "open",
      context: {},
      createdAt: new Date("2026-09-01"),
      updatedAt: new Date("2026-09-01"),
    });
  });

  it.each(routes)(
    "$name rejects an unavailable account check without caching the error",
    async ({ run }) => {
      vi.mocked(getAuthUser).mockRejectedValueOnce(new Error("synthetic account lookup failure"));
      const response = await run();
      expect(getAuthUser).toHaveBeenCalledOnce();
      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(getCharacterByUserId).not.toHaveBeenCalled();
      expect(buildNationalCorporationView).not.toHaveBeenCalled();
      expect(getNoConfidenceVoteView).not.toHaveBeenCalled();
      expect(getPmAppointmentVoteView).not.toHaveBeenCalled();
    }
  );

  it.each(routes.filter(({ name }) => name !== "bond detail"))(
    "$name retains an uncached public response when no current account is granted",
    async ({ run }) => {
      const response = await run();
      expect(getAuthUser).toHaveBeenCalledOnce();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(getCharacterByUserId).not.toHaveBeenCalled();
      expect(db.collectionMocks.suggestionReactions?.findOne).toBeUndefined();
    }
  );

  it.each([
    { name: "PM appointment", index: 6, query: getPmAppointmentVoteView },
    { name: "no confidence", index: 7, query: getNoConfidenceVoteView },
  ])(
    "$name passes only the current account to its personalized query",
    async ({ index, query }) => {
      vi.mocked(getAuthUser).mockResolvedValue(currentAccount);
      const response = await routes[index]!.run();
      expect(response.status).toBe(200);
      expect(query).toHaveBeenCalledWith(db, "UK", objectId.toHexString(), currentAccount.userId);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    }
  );

  it.each([routes[4]!, routes[5]!])(
    "$name does not downgrade a failed character lookup to public access",
    async ({ run }) => {
      vi.mocked(getAuthUser).mockResolvedValue(currentAccount);
      vi.mocked(getCharacterByUserId).mockRejectedValueOnce(
        new Error("synthetic character lookup failure")
      );
      const response = await run();
      expect(response.status).toBe(500);
      expect(getCharacterByUserId).toHaveBeenCalledWith(db, currentAccount.userId);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(buildNationalCorporationView).not.toHaveBeenCalled();
    }
  );
});
