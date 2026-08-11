import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types/corporation";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";

vi.mock("@/lib/extraction/contractAuthority", () => ({ getResourceContractAuthority: vi.fn() }));
vi.mock("@/lib/extraction/contractIssuerAuth", () => ({
  isNationalIssuer: vi.fn(),
  isStateIssuer: vi.fn(),
}));
vi.mock("@/lib/extraction/computeContractedShare", () => ({
  computeRemainingContractHeadroom: vi.fn(),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  anchorToCorpLiquidCapital: (a: number) => a,
  resolveCorpLiquidCurrencyCode: () => "USD",
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/budget/treasurySpend", () => ({ creditTreasury: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));

const TURN = 100;
const NOW = new Date("2026-07-09T00:00:00Z");
const CORP_ID = new ObjectId();

function makeContract(overrides: Partial<ExtractionContract> = {}): ExtractionContract {
  return {
    _id: new ObjectId(),
    stateId: "TX",
    countryId: "US",
    corporationId: CORP_ID,
    resource: "oil",
    share: 0.5,
    grantedTurn: 90,
    grantedBy: "US",
    grantedByLevel: "national",
    status: "offered",
    signingFeeAnchor: 100_000,
    royaltyRatePerTurn: 0.01,
    termTurns: 48,
    offerExpiresTurn: TURN + 10,
    updatedAt: NOW,
    ...overrides,
  } as ExtractionContract;
}

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: CORP_ID,
    type: "extraction",
    liquidCapital: 10_000_000,
    liquidCurrencyCode: "USD",
    userId: new ObjectId(),
    name: "Acme Extraction",
    ...overrides,
  } as unknown as Corporation;
}

describe("issueContractOffer", () => {
  let db: MockDb;
  let auth: typeof import("@/lib/extraction/contractAuthority");
  let issuer: typeof import("@/lib/extraction/contractIssuerAuth");
  let headroom: typeof import("@/lib/extraction/computeContractedShare");

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("stateResourceCapacity");
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("extractionContracts");
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue({
      resources: { oil: 1000 },
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: CORP_ID,
      type: "extraction",
      userId: new ObjectId(),
      name: "Acme",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({ _id: new ObjectId() });
    db.collectionMocks.extractionContracts.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });
    auth = await import("@/lib/extraction/contractAuthority");
    issuer = await import("@/lib/extraction/contractIssuerAuth");
    headroom = await import("@/lib/extraction/computeContractedShare");
    vi.mocked(headroom.computeRemainingContractHeadroom).mockResolvedValue(0.75);
  });

  async function run(share = 0.5) {
    const { issueContractOffer } = await import("./issueContractOffer");
    return issueContractOffer(
      db as unknown as Db,
      {
        countryId: "US",
        stateId: "TX",
        corporationId: CORP_ID.toString(),
        resource: "oil",
        share,
        royaltyRatePerTurn: 0.01,
        termTurns: 48,
        signingFeeAnchor: 100_000,
      },
      { characterId: new ObjectId(), isAdmin: false },
      TURN,
      NOW
    );
  }

  it("issues a national offer on the happy path", async () => {
    vi.mocked(auth.getResourceContractAuthority).mockResolvedValue("both");
    vi.mocked(issuer.isNationalIssuer).mockResolvedValue(true);
    const res = await run(0.5);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.grantedByLevel).toBe("national");
      expect(res.offerExpiresTurn).toBe(TURN + 24);
    }
    expect(db.collectionMocks.extractionContracts.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: "offered", grantedByLevel: "national", grantedBy: "US" })
    );
  });

  it("rejects an offer that breaches the 75% contracted-share cap", async () => {
    vi.mocked(auth.getResourceContractAuthority).mockResolvedValue("both");
    vi.mocked(issuer.isNationalIssuer).mockResolvedValue(true);
    vi.mocked(headroom.computeRemainingContractHeadroom).mockResolvedValue(0.1);
    const res = await run(0.5);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect(res.remainingHeadroom).toBe(0.1);
    }
    expect(db.collectionMocks.extractionContracts.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a national official when the authority law is state-only", async () => {
    vi.mocked(auth.getResourceContractAuthority).mockResolvedValue("state");
    vi.mocked(issuer.isNationalIssuer).mockResolvedValue(true);
    vi.mocked(issuer.isStateIssuer).mockResolvedValue(false);
    const res = await run(0.5);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it("rejects offering to a non-extraction corporation", async () => {
    vi.mocked(auth.getResourceContractAuthority).mockResolvedValue("both");
    vi.mocked(issuer.isNationalIssuer).mockResolvedValue(true);
    db.collectionMocks.corporations.findOne.mockResolvedValue({ _id: CORP_ID, type: "technology" });
    const res = await run(0.5);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });

  it("rejects offering to a corp with no sector in the state", async () => {
    vi.mocked(auth.getResourceContractAuthority).mockResolvedValue("both");
    vi.mocked(issuer.isNationalIssuer).mockResolvedValue(true);
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
    const res = await run(0.5);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });
});

describe("acceptContractOffer", () => {
  let db: MockDb;
  let treasury: typeof import("@/lib/budget/treasurySpend");

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("extractionContracts");
    db.collection("corporations");
    db.collectionMocks.extractionContracts.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    treasury = await import("@/lib/budget/treasurySpend");
  });

  async function run(contract: ExtractionContract, corp = makeCorp()) {
    const { acceptContractOffer } = await import("./acceptContractOffer");
    return acceptContractOffer(db as unknown as Db, contract, corp, TURN, NOW);
  }

  it("accepts an offer, charges the fee and credits the national treasury", async () => {
    const res = await run(makeContract());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.activatedTurn).toBe(TURN);
      expect(res.expiresTurn).toBe(TURN + 48);
      expect(res.signingFeeLocal).toBe(100_000);
    }
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ liquidCapital: { $gte: 100_000 } }),
      expect.anything()
    );
    expect(treasury.creditTreasury).toHaveBeenCalledWith(expect.anything(), "US", 100_000);
  });

  it("reverts and returns 402 when the corp cannot cover the signing fee", async () => {
    db.collectionMocks.corporations.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });
    const res = await run(makeContract());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(402);
    // Claim + revert = two contract updates; treasury never credited.
    expect(db.collectionMocks.extractionContracts.updateOne).toHaveBeenCalledTimes(2);
    expect(treasury.creditTreasury).not.toHaveBeenCalled();
  });

  it("falls back to the national treasury when a state issuer's budget doc is missing", async () => {
    db.collection("stateBudgets");
    db.collectionMocks.stateBudgets.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });
    const res = await run(makeContract({ grantedByLevel: "state" }));
    expect(res.ok).toBe(true);
    // Money conservation: the corp was debited, the state doc is missing, so
    // the fee routes to the national treasury as custodian.
    expect(treasury.creditTreasury).toHaveBeenCalledWith(expect.anything(), "US", 100_000);
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const types = vi.mocked(emitTx).mock.calls.map((c) => c[1].type);
    expect(types).toContain("govt_signing_fee_receipt");
  });

  it("credits the state budget without a government receipt when the doc exists", async () => {
    db.collection("stateBudgets");
    db.collectionMocks.stateBudgets.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    const res = await run(makeContract({ grantedByLevel: "state" }));
    expect(res.ok).toBe(true);
    expect(treasury.creditTreasury).not.toHaveBeenCalled();
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const types = vi.mocked(emitTx).mock.calls.map((c) => c[1].type);
    expect(types).toContain("contract_signing_fee");
    expect(types).not.toContain("govt_signing_fee_receipt");
  });

  it("emits a paired government receipt alongside a national treasury credit", async () => {
    const res = await run(makeContract());
    expect(res.ok).toBe(true);
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const receipt = vi
      .mocked(emitTx)
      .mock.calls.map((c) => c[1])
      .find((e) => e.type === "govt_signing_fee_receipt");
    expect(receipt).toMatchObject({
      subjectType: "government",
      countryId: "US",
      amount: 100_000,
      anchorAmount: 100_000,
    });
  });

  it("refunds the corp and reverts the claim when the issuer credit fails", async () => {
    vi.mocked(treasury.creditTreasury).mockRejectedValueOnce(new Error("treasury down"));
    await expect(run(makeContract())).rejects.toThrow("treasury down");

    // Corp writes: guarded debit, then additive refund.
    const corpCalls = db.collectionMocks.corporations.updateOne.mock.calls;
    expect(corpCalls).toHaveLength(2);
    expect(corpCalls[0][1].$inc.liquidCapital).toBe(-100_000);
    expect(corpCalls[1][1].$inc.liquidCapital).toBe(100_000);

    // Contract writes: claim, then guarded revert back to an open offer.
    const contractCalls = db.collectionMocks.extractionContracts.updateOne.mock.calls;
    expect(contractCalls).toHaveLength(2);
    expect(contractCalls[1][0]).toMatchObject({ status: "active" });
    expect(contractCalls[1][1].$set.status).toBe("offered");
  });

  it("rejects accepting a contract that is not an open offer", async () => {
    const res = await run(makeContract({ status: "active" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
    expect(db.collectionMocks.extractionContracts.updateOne).not.toHaveBeenCalled();
  });

  it("rejects accepting an expired offer", async () => {
    const res = await run(makeContract({ offerExpiresTurn: TURN - 1 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });

  it("rejects accepting a revoked offer and charges nothing", async () => {
    // A revoke leaves status:"offered" and only stamps revokedTurn. If accept
    // ignored it, the corp would pay a signing fee for a contract that allocates
    // no capacity and never settles (an issuer could offer a fat fee then revoke
    // to pocket it). The offer must be unclaimable and no money must move.
    const res = await run(makeContract({ revokedTurn: TURN - 5 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
    expect(db.collectionMocks.extractionContracts.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
    expect(treasury.creditTreasury).not.toHaveBeenCalled();
  });
});

describe("declineContractOffer", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("extractionContracts");
    db.collectionMocks.extractionContracts.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
  });

  async function run(contract: ExtractionContract) {
    const { declineContractOffer } = await import("./declineContractOffer");
    return declineContractOffer(db as unknown as Db, contract, TURN, NOW);
  }

  it("declines an open offer", async () => {
    const res = await run(makeContract());
    expect(res.ok).toBe(true);
    expect(db.collectionMocks.extractionContracts.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: "offered" }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: "declined", revokedTurn: TURN }),
      })
    );
  });

  it("rejects declining a non-offer", async () => {
    const res = await run(makeContract({ status: "active" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });
});

describe("revokeContract", () => {
  let db: MockDb;
  let issuer: typeof import("@/lib/extraction/contractIssuerAuth");
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("extractionContracts");
    db.collectionMocks.extractionContracts.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    issuer = await import("@/lib/extraction/contractIssuerAuth");
  });

  async function run(contract: ExtractionContract, isAdmin = false) {
    const { revokeContract } = await import("./revokeContract");
    return revokeContract(
      db as unknown as Db,
      contract,
      { characterId: new ObjectId(), isAdmin },
      TURN,
      NOW
    );
  }

  it("lets a national issuer revoke a national contract", async () => {
    vi.mocked(issuer.isNationalIssuer).mockResolvedValue(true);
    const res = await run(makeContract({ status: "active" }));
    expect(res.ok).toBe(true);
    expect(db.collectionMocks.extractionContracts.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ revokedTurn: { $exists: false } }),
      expect.objectContaining({ $set: expect.objectContaining({ revokedTurn: TURN }) })
    );
  });

  it("rejects a caller who does not hold the issuing office", async () => {
    vi.mocked(issuer.isNationalIssuer).mockResolvedValue(false);
    const res = await run(makeContract({ status: "active" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it("rejects revoking an already-terminated contract", async () => {
    const res = await run(makeContract({ revokedTurn: 95 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });
});
