import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/admin/spawnNppCorporation", () => ({
  generateNppCorpName: vi.fn(() => "Test Corp"),
  spawnNppCorporation: vi.fn(),
}));
import { spawnNppCorporation } from "@/lib/admin/spawnNppCorporation";
import { nppFoundCorporation } from "./nppFoundCorporation";

describe("nppFoundCorporation", () => {
  const founderId = new ObjectId();
  const founder = {
    _id: founderId,
    countryId: "US" as const,
    party: "1",
    homeState: "CA",
    personality: { loyalty: 50, ambition: 70, stubbornness: 20 },
  };
  const FOUNDING_FEE = 100_000;
  const CURRENT_TURN = 50;
  const corpId = new ObjectId();

  let corpFindOne: ReturnType<typeof vi.fn>;
  let corpUpdateOne: ReturnType<typeof vi.fn>;
  let nppFindOneAndUpdate: ReturnType<typeof vi.fn>;
  let nppUpdateOne: ReturnType<typeof vi.fn>;
  let db: Db;

  beforeEach(() => {
    vi.clearAllMocks();
    corpFindOne = vi.fn().mockResolvedValue(null); // not already a CEO by default
    corpUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    nppFindOneAndUpdate = vi
      .fn()
      .mockResolvedValue({ _id: founderId, nppInvestmentCashAnchor: 500_000 });
    nppUpdateOne = vi.fn().mockResolvedValue({});
    db = {
      collection: (name: string) =>
        name === "corporations"
          ? { findOne: corpFindOne, updateOne: corpUpdateOne }
          : { findOneAndUpdate: nppFindOneAndUpdate, updateOne: nppUpdateOne },
    } as unknown as Db;
  });

  it("founds a corporation: deducts the fee, spawns, and reassigns CEO when a different NPP was auto-selected", async () => {
    const autoCeoId = new ObjectId(); // different from founder
    vi.mocked(spawnNppCorporation).mockResolvedValue({
      corporationId: corpId.toString(),
      sequentialId: 1,
      name: "Test Corp",
      type: "technology",
      countryId: "US",
      headquartersState: "CA",
      startingCapital: 2_000_000,
      startingRevenue: 100_000,
      sectorId: new ObjectId().toString(),
      nppId: autoCeoId.toString(),
      nppName: "Auto CEO",
      tickerSymbol: "TST",
    } as never);

    const res = await nppFoundCorporation(db, founder, "technology", FOUNDING_FEE, CURRENT_TURN, 1);

    expect(res).toEqual({
      ok: true,
      corporationId: corpId.toString(),
      name: "Test Corp",
      type: "technology",
      foundingFee: FOUNDING_FEE,
      foundingFeeAnchor: FOUNDING_FEE, // homeRate=1 → anchor == local
      investmentCashAnchor: 500_000,
    });
    // fee deducted from the investment account with a >= guard (NOT campaign funds)
    const [filter, update] = nppFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: founderId, nppInvestmentCashAnchor: { $gte: FOUNDING_FEE } });
    expect(update.$inc).toEqual({ nppInvestmentCashAnchor: -FOUNDING_FEE });
    // reassignment: renames the shareholder entry + flips ceoId
    expect(corpUpdateOne).toHaveBeenCalledWith(
      { _id: corpId, "shareholders.nppId": autoCeoId },
      expect.objectContaining({
        $set: expect.objectContaining({
          "shareholders.$.nppId": founderId,
          ceoId: founderId,
        }),
      })
    );
  });

  it("skips reassignment when the founder was already the auto-selected CEO", async () => {
    vi.mocked(spawnNppCorporation).mockResolvedValue({
      corporationId: corpId.toString(),
      sequentialId: 1,
      name: "Test Corp",
      type: "technology",
      countryId: "US",
      headquartersState: "CA",
      startingCapital: 2_000_000,
      startingRevenue: 100_000,
      sectorId: new ObjectId().toString(),
      nppId: founderId.toString(),
      nppName: "Founder",
      tickerSymbol: "TST",
    } as never);

    const res = await nppFoundCorporation(db, founder, "technology", FOUNDING_FEE, CURRENT_TURN, 1);

    expect(res.ok).toBe(true);
    expect(corpUpdateOne).not.toHaveBeenCalled();
  });

  it("rejects when the NPP already runs a corporation, no fee deducted", async () => {
    corpFindOne.mockResolvedValue({ _id: corpId, ceoId: founderId });
    const res = await nppFoundCorporation(db, founder, "technology", FOUNDING_FEE, CURRENT_TURN, 1);

    expect(res).toEqual({ ok: false, reason: "NPP already runs a corporation." });
    expect(nppFindOneAndUpdate).not.toHaveBeenCalled();
    expect(spawnNppCorporation).not.toHaveBeenCalled();
  });

  it("rejects when funds are insufficient (guard returns null), no spawn attempted", async () => {
    nppFindOneAndUpdate.mockResolvedValue(null);
    const res = await nppFoundCorporation(db, founder, "technology", FOUNDING_FEE, CURRENT_TURN, 1);

    expect(res).toEqual({
      ok: false,
      reason: "Insufficient investment capital to found a corporation.",
    });
    expect(spawnNppCorporation).not.toHaveBeenCalled();
  });

  it("refunds the founding fee if spawnNppCorporation throws", async () => {
    vi.mocked(spawnNppCorporation).mockRejectedValue(new Error("No capital state configured"));
    const res = await nppFoundCorporation(db, founder, "technology", FOUNDING_FEE, CURRENT_TURN, 1);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("No capital state configured");
    expect(nppUpdateOne).toHaveBeenCalledWith(
      { _id: founderId },
      expect.objectContaining({ $inc: { nppInvestmentCashAnchor: FOUNDING_FEE } })
    );
  });

  it("rejects an NPP with no home state", async () => {
    const res = await nppFoundCorporation(
      db,
      { ...founder, homeState: "" },
      "technology",
      FOUNDING_FEE,
      CURRENT_TURN
    );
    expect(res).toEqual({
      ok: false,
      reason: "NPP has no home state to headquarter a corporation in.",
    });
    expect(nppFindOneAndUpdate).not.toHaveBeenCalled();
  });
});
