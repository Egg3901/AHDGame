import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { makeCorporation } from "@/lib/test-utils/factories";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(20) }));
vi.mock("@/lib/nationalization/corpNationalizationStatus", () => ({
  buildCorpNationalizationStatus: vi
    .fn()
    .mockResolvedValue({ hasStatus: true, auction: { auctionId: "auction" } }),
}));
let db: MockDb;
const actorId = new ObjectId();
const corpId = new ObjectId();
let auction: {
  countryId: string;
  closesAtTurn: number;
  reservePrice: number;
  reserveCurrency: string;
  bids: { characterId?: ObjectId; corporationId?: ObjectId; amount: number }[];
};
let actor: {
  _id: ObjectId;
  countryId: string;
  cashOnHand: number;
  currencyBalances?: { personal: { USD: number } };
};
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(isForexEnabled).mockResolvedValue(false);
  actor = { _id: actorId, countryId: "US", cashOnHand: 1000 };
  vi.mocked(getAuthUserWithCharacter).mockImplementation(
    async () => ({ hasCharacter: true, character: actor }) as never
  );
  auction = {
    countryId: "US",
    closesAtTurn: 25,
    reservePrice: 500,
    reserveCurrency: "USD",
    bids: [],
  };
  db.collection("corporations").findOne.mockResolvedValue(makeCorporation({ _id: corpId }));
  db.collection("nationalizationAuctions").findOne.mockImplementation(async () => auction);
});
async function read() {
  const res = await GET(new Request("http://localhost/api/corporations/1/nationalization-status"), {
    params: Promise.resolve({ id: String(corpId) }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toContain("no-store");
  return res.json();
}
describe("nationalization bid capability", () => {
  it("allows a funded resident and denies anonymous or foreign viewers", async () => {
    expect((await read()).canBid).toBe(true);
    actor.countryId = "FR";
    expect((await read()).canBid).toBe(false);
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue(null);
    expect((await read()).canBid).toBe(false);
  });
  it("recognizes a shareholder even when the page cap table is hidden", async () => {
    const corp = makeCorporation({
      _id: corpId,
      isPrivate: true,
      shareholders: [{ characterId: actorId, shares: 10 }],
    });
    db.collection("corporations").findOne.mockResolvedValue(corp);
    actor.countryId = "FR";
    const status = await read();
    expect(status.hasExposure).toBe(true);
    expect(status.canBid).toBe(false);
  });

  it("denies closed auctions and unaffordable bids", async () => {
    auction.closesAtTurn = 19;
    expect((await read()).canBid).toBe(false);
    auction.closesAtTurn = 25;
    actor.cashOnHand = 499;
    expect((await read()).canBid).toBe(false);
  });
  it("reads the same currency wallet as the bid debit and credits standing escrow", async () => {
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    actor.currencyBalances = { personal: { USD: 1 } };
    expect((await read()).canBid).toBe(false);
    auction.bids = [{ characterId: actorId, amount: 500 }];
    expect((await read()).canBid).toBe(true);
  });
  it("permits a matching funded CEO corporation, including its own standing escrow", async () => {
    actor.cashOnHand = 0;
    const biddingCorp = { _id: new ObjectId(), liquidCapital: 1, liquidCurrencyCode: "USD" };
    db.collection("corporations").find().toArray.mockResolvedValue([biddingCorp]);
    auction.bids = [{ corporationId: biddingCorp._id, amount: 500 }];
    expect((await read()).canBid).toBe(true);
    expect(db.collection("corporations").find).toHaveBeenCalledWith({
      ceoId: actorId,
      ceoVacant: { $ne: true },
    });
    biddingCorp.liquidCurrencyCode = "EUR";
    expect((await read()).canBid).toBe(false);
  });
});
