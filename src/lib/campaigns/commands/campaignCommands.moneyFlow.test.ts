import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import type { Character } from "@/lib/db/types";

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

// Control the campaign-actor predicates per test. legacyManagersAsList /
// MAX_CAMPAIGN_MANAGERS are provided so the module import binding resolves
// even though these tests never exercise the appoint path. vi.hoisted so the
// object exists before the hoisted vi.mock factory runs.
const access = vi.hoisted(() => ({
  isCampaignManagerUser: vi.fn().mockReturnValue(true),
  isCampaignNomineeUser: vi.fn().mockResolvedValue(false),
  isCampaignRunningMateUser: vi.fn().mockResolvedValue(false),
  legacyManagersAsList: vi.fn().mockReturnValue([]),
  MAX_CAMPAIGN_MANAGERS: 3,
}));
vi.mock("@/lib/campaigns/access", () => access);

// The strength and rally spends run standalone here: no replica set in unit
// tests.
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(async (_inside: unknown, fallback: () => Promise<unknown>) => fallback()),
}));

// Turn 100 everywhere: the rally throttle and the strength audit row read it.
vi.mock("@/lib/time/gameTime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/time/gameTime")>()),
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 100,
    effectiveNow: new Date(),
    lastTurnProcessed: new Date(),
    isActive: true,
    pausedAt: null,
  }),
}));

import { contributeCampaignStrength, fireRallyOneShot } from "./campaignCommands";
import { MoneyFlowKeyConflictError } from "@/lib/db/nonAtomicMoneyFlow";

function makeUser(
  characterId: ObjectId,
  overrides: { countryId?: string; nationalInfluence?: number; name?: string } = {}
): AuthUserWithCharacter & { hasCharacter: true; character: Character } {
  return {
    userId: new ObjectId().toString(),
    username: "tester",
    isAdmin: false,
    isBanned: false,
    hasCharacter: true,
    character: {
      _id: characterId,
      countryId: overrides.countryId ?? "US",
      nationalInfluence: overrides.nationalInfluence ?? 50,
      name: overrides.name ?? "Donor",
    },
  } as unknown as AuthUserWithCharacter & { hasCharacter: true; character: Character };
}

function presidentElection(electionId: ObjectId) {
  return {
    _id: electionId,
    electionType: "president",
    status: "active",
    countryId: "US",
    primaryEndTurn: 1,
    endTurn: 999,
  };
}

function duplicateKeyError(): Error {
  return Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
}

describe("contributeCampaignStrength — crash-safe command", () => {
  let db: MockDb;
  let campaignId: ObjectId;
  let electionId: ObjectId;
  let characterId: ObjectId;

  beforeEach(() => {
    vi.clearAllMocks();
    access.isCampaignManagerUser.mockReturnValue(true);
    access.isCampaignNomineeUser.mockResolvedValue(false);
    access.isCampaignRunningMateUser.mockResolvedValue(false);
    db = createMockDb();
    campaignId = new ObjectId();
    electionId = new ObjectId();
    characterId = new ObjectId();
    db.collection("campaigns").findOne.mockResolvedValue({
      _id: campaignId,
      electionId,
      candidateId: new ObjectId(),
      party: "1",
      status: "active",
      campaignStrength: 100,
      actions: 100,
      funds: 1_000_000,
      updatedAt: new Date(),
    });
    db.collection("elections").findOne.mockResolvedValue(presidentElection(electionId));
    // A rich contributor: the pre-spend affordability gates pass, so the
    // guarded debit leg is the only thing standing between the purchase and
    // a concurrent spend.
    db.collection("characters").findOne.mockResolvedValue({
      _id: characterId,
      name: "Donor",
      countryId: "US",
      funds: 100_000_000,
      actions: 10_000,
    });
    db.collection("electionCandidates").findOne.mockResolvedValue(null);
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 100 });
    // Instantiate the write-path mocks up front: collectionMocks entries only
    // exist after the first db.collection(name) call.
    db.collection("characters");
    db.collection("campaigns");
    db.collection("activityLog");
    db.collection("nonAtomicMoneyFlowReceipts");
  });

  function contribute(options: { idempotencyKey?: string } = {}) {
    return contributeCampaignStrength({
      db: db as unknown as Db,
      campaignId,
      user: makeUser(characterId),
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
    });
  }

  it("charges the character and credits the campaign exactly once, with an audit row", async () => {
    const result = await contribute();

    expect(result.campaignStrength).toBeGreaterThan(100);
    expect(result.clicks).toBe(1);
    // The debit is the conditional single-document guard, so two concurrent
    // purchases cannot both pass on a stale balance.
    const [debitFilter, debitUpdate] = db.collectionMocks.characters.updateOne.mock.calls[0];
    expect(debitFilter).toMatchObject({ _id: characterId });
    expect((debitUpdate as { $inc: Record<string, number> }).$inc.funds).toBeLessThan(0);
    expect((debitUpdate as { $inc: Record<string, number> }).$inc.actions).toBeLessThan(0);
    const [, creditUpdate] = db.collectionMocks.campaigns.updateOne.mock.calls[0];
    expect(
      (creditUpdate as { $inc: Record<string, number> }).$inc.campaignStrength
    ).toBeGreaterThan(0);
    expect(db.collectionMocks.activityLog.insertOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.nonAtomicMoneyFlowReceipts.updateOne).toHaveBeenCalledWith(
      { _id: expect.any(String) },
      expect.objectContaining({ $set: expect.objectContaining({ status: "completed" }) }),
      undefined
    );
  });

  it("maps a lost balance race to insufficient resources without crediting the campaign", async () => {
    // Affordable at read time, but the guarded debit matches nothing: a
    // concurrent spend drained the balance first. The row still exists, so
    // this is guard-rejected, not missing.
    db.collectionMocks.characters.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });
    // First read is the command's affordability snapshot; the guarded write's
    // disambiguation then finds the row alive but the key unapplied.
    let characterReads = 0;
    const characterDoc = await db.collectionMocks.characters.findOne();
    db.collectionMocks.characters.findOne.mockImplementation(async () => {
      characterReads += 1;
      return characterReads <= 1 ? characterDoc : { _id: characterId };
    });

    await expect(contribute()).rejects.toThrow(/insufficient resources/i);
    expect(db.collectionMocks.campaigns.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.activityLog.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a missing campaign before spending anything", async () => {
    db.collectionMocks.campaigns.findOne.mockResolvedValue(null);

    await expect(contribute()).rejects.toThrow(/campaign not found/i);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.campaigns.updateOne).not.toHaveBeenCalled();
  });

  it("maps a vanished campaign to not-found and refunds the debit", async () => {
    db.collectionMocks.campaigns.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });
    // The campaign exists for the command's initial read, then vanishes: the
    // guarded credit's disambiguation reports missing and the debit refunds.
    let campaignReads = 0;
    const campaignDoc = await db.collectionMocks.campaigns.findOne();
    db.collectionMocks.campaigns.findOne.mockImplementation(async () => {
      campaignReads += 1;
      return campaignReads <= 1 ? campaignDoc : null;
    });

    await expect(contribute()).rejects.toThrow(/campaign not found/i);
    // Compensation reverses the debit prefix: the debit leg plus its keyed
    // inverse, not the legacy bare refund.
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledTimes(2);
    const [, refund] = db.collectionMocks.characters.updateOne.mock.calls[1];
    expect((refund as { $inc: Record<string, number> }).$inc.funds).toBeGreaterThan(0);
  });

  it("maps a failed audit write to a refunded failure, never charged-for-nothing", async () => {
    db.collectionMocks.activityLog.insertOne.mockRejectedValueOnce(new Error("audit down"));

    await expect(contribute()).rejects.toThrow(/refunded/i);
    // The spend prefix compensated: debit and credit both reversed.
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.campaigns.updateOne).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.nonAtomicMoneyFlowReceipts.updateOne).toHaveBeenCalledWith(
      { _id: expect.any(String) },
      expect.objectContaining({ $set: expect.objectContaining({ status: "compensated" }) }),
      undefined
    );
  });

  it("rejects an invalid key before touching balances", async () => {
    for (const idempotencyKey of ["", "x".repeat(129)]) {
      await expect(contribute({ idempotencyKey })).rejects.toBeInstanceOf(RangeError);
    }
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.campaigns.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a key reused for a different purchase", async () => {
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockRejectedValueOnce(
      duplicateKeyError()
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValueOnce({
      _id: "used-key",
      status: "completed",
      fingerprint: "campaign-strength:other",
    });

    await expect(contribute({ idempotencyKey: "used-key" })).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("replays the stored outcome when the same key and purchase retry", async () => {
    const fingerprint = `campaign-strength:${campaignId.toHexString()}:${characterId.toHexString()}:1`;
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockRejectedValueOnce(
      duplicateKeyError()
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValueOnce({
      _id: "retry-key",
      status: "completed",
      fingerprint,
    });

    const result = await contribute({ idempotencyKey: "retry-key" });

    expect(result.campaignStrength).toBeGreaterThan(100);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.campaigns.updateOne).not.toHaveBeenCalled();
  });
});

describe("fireRallyOneShot — crash-safe command", () => {
  let db: MockDb;
  let campaignId: ObjectId;
  let electionId: ObjectId;
  let candidateId: ObjectId;
  let candidateRowId: ObjectId;
  let characterId: ObjectId;

  function candidateRow(overrides: Record<string, unknown> = {}) {
    return {
      _id: candidateRowId,
      electionId,
      characterId: candidateId,
      status: "active",
      support: 50,
      campaignSuspended: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    access.isCampaignManagerUser.mockReturnValue(true);
    access.isCampaignNomineeUser.mockResolvedValue(false);
    access.isCampaignRunningMateUser.mockResolvedValue(false);
    db = createMockDb();
    campaignId = new ObjectId();
    electionId = new ObjectId();
    candidateId = new ObjectId();
    candidateRowId = new ObjectId();
    characterId = new ObjectId();
    db.collection("campaigns").findOne.mockResolvedValue({
      _id: campaignId,
      electionId,
      candidateId,
      candidateIsNPP: false,
      party: "1",
      status: "active",
      funds: 1_000_000,
      actions: 100,
    });
    db.collection("elections").findOne.mockResolvedValue(presidentElection(electionId));
    db.collection("electionCandidates").findOne.mockResolvedValue(candidateRow());
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 100 });
    // Instantiate the write-path mocks up front: collectionMocks entries only
    // exist after the first db.collection(name) call.
    db.collection("campaigns");
    db.collection("electionCandidates");
    db.collection("nonAtomicMoneyFlowReceipts");
  });

  function rally(options: { idempotencyKey?: string } = {}) {
    return fireRallyOneShot({
      db: db as unknown as Db,
      campaignId,
      user: makeUser(characterId),
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
    });
  }

  it("spends campaign actions and lands support plus the trailing drip atomically", async () => {
    const result = await rally();

    expect(result.nextSupport).toBeGreaterThan(50);
    expect(result.pendingDripTurnsRemaining).toBeGreaterThan(0);
    // The actions debit lands first and carries the affordability guard.
    const [debitFilter, debitUpdate] = db.collectionMocks.campaigns.updateOne.mock.calls[0];
    expect(debitFilter).toMatchObject({ _id: campaignId });
    expect((debitUpdate as { $inc: Record<string, number> }).$inc.actions).toBeLessThan(0);
    // The candidate write carries the one-per-turn throttle plus the key.
    const [candFilter, candUpdate] = db.collectionMocks.electionCandidates.updateOne.mock.calls[0];
    expect(candFilter).toMatchObject({ _id: candidateRowId });
    expect((candUpdate as { $set?: { lastRallyTurn?: number } }).$set?.lastRallyTurn).toBe(100);
  });

  it("refuses a second rally on the throttled turn without spending", async () => {
    db.collection("electionCandidates").findOne.mockResolvedValue(
      candidateRow({ lastRallyTurn: 100 })
    );

    await expect(rally()).rejects.toThrow(/already fired this turn/i);
    expect(db.collectionMocks.campaigns.updateOne).not.toHaveBeenCalled();
  });

  it("compensates the debit when a rival fire wins the candidate race", async () => {
    // The candidate write matches nothing: a same-turn rival fire moved the
    // throttle first. The row still exists, so this is tampered state, not a
    // missing row.
    db.collectionMocks.electionCandidates.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collectionMocks.electionCandidates.findOne.mockResolvedValue(candidateRow());

    await expect(rally()).rejects.toThrow(/rally state changed/i);
    // The applied actions prefix is reversed; the rally never double-lands.
    expect(db.collectionMocks.campaigns.updateOne).toHaveBeenCalledTimes(2);
    const [, refund] = db.collectionMocks.campaigns.updateOne.mock.calls[1];
    expect((refund as { $inc: Record<string, number> }).$inc.actions).toBeGreaterThan(0);
  });

  it("maps a vanished candidate row to not-found and refunds the debit", async () => {
    db.collectionMocks.electionCandidates.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });
    // Suspended-check and rally lookup still see the row; only the guarded
    // write's disambiguation finds it gone.
    let calls = 0;
    db.collectionMocks.electionCandidates.findOne.mockImplementation(async () => {
      calls += 1;
      return calls <= 2 ? candidateRow() : null;
    });

    await expect(rally()).rejects.toThrow(/candidate not found/i);
    expect(db.collectionMocks.campaigns.updateOne).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid key before touching actions", async () => {
    for (const idempotencyKey of ["", "x".repeat(129)]) {
      await expect(rally({ idempotencyKey })).rejects.toBeInstanceOf(RangeError);
    }
    expect(db.collectionMocks.campaigns.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.electionCandidates.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a key reused for a different rally", async () => {
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockRejectedValueOnce(
      duplicateKeyError()
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValueOnce({
      _id: "used-key",
      status: "completed",
      fingerprint: "rally:other",
    });

    await expect(rally({ idempotencyKey: "used-key" })).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(db.collectionMocks.campaigns.updateOne).not.toHaveBeenCalled();
  });

  it("replays the stored outcome when the same key and rally retry", async () => {
    const fingerprint = `rally:${campaignId.toHexString()}:${candidateRowId.toHexString()}:100`;
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockRejectedValueOnce(
      duplicateKeyError()
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValueOnce({
      _id: "retry-key",
      status: "completed",
      fingerprint,
    });

    const result = await rally({ idempotencyKey: "retry-key" });

    expect(result.nextSupport).toBeGreaterThan(50);
    expect(db.collectionMocks.campaigns.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.electionCandidates.updateOne).not.toHaveBeenCalled();
  });
});
