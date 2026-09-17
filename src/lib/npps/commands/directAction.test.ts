import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("./directActionSpend", async () => {
  const actual = await vi.importActual<typeof import("./directActionSpend")>("./directActionSpend");
  return { ...actual, applyDirectActionSpend: vi.fn() };
});

import { applyNppDirectAction } from "./directAction";
import { buildDirectActionFingerprint } from "./directActionSpend";

describe("applyNppDirectAction — keyed spend orchestration", () => {
  let db: MockDb;
  let nppId: ObjectId;
  let characterId: ObjectId;

  const spendOutcome = {
    duplicate: false,
    success: true as const,
    effect: "Favorability boosted.",
    action: "boost_favorability" as const,
    actions: { current: 25, spent: 5 },
    funds: { current: 40000, spent: 10000 },
    homeCurrency: "USD",
    currencySymbol: "$",
    relationship: { before: 25, after: 27, delta: 2 },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    nppId = new ObjectId();
    characterId = new ObjectId();
    db.collection("npps");
    db.collection("characters");
    db.collection("nppRelationships");
    db.collection("gameState");
    db.collection("electionCandidates");
    db.collection("elections");
    db.collection("nppEndorsements");
    db.collection("nonAtomicMoneyFlowReceipts");

    db.collectionMocks["npps"]!.findOne.mockResolvedValue({
      _id: nppId,
      name: "Target NPP",
      countryId: "US",
      policies: { economic: 0, social: 0 },
      favorability: 60,
      politicalInfluence: 40,
      updatedAt: new Date(),
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: characterId,
      actions: 30,
      funds: 50000,
      policies: { economic: 0, social: 0 },
      countryId: "US",
    });
    db.collectionMocks["nppRelationships"]!.findOne.mockResolvedValue({
      _id: `${characterId.toString()}_${nppId.toString()}`,
      relationshipScore: 25,
    });
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ currentTurn: 10 });

    const { applyDirectActionSpend } = await import("./directActionSpend");
    vi.mocked(applyDirectActionSpend).mockResolvedValue(spendOutcome);
  });

  it("forwards an explicit idempotency key and the priced fingerprint to the spend primitive", async () => {
    const { applyDirectActionSpend } = await import("./directActionSpend");
    const result = await applyNppDirectAction(db as unknown as Db, {
      nppId,
      characterId,
      action: "boost_favorability",
      idempotencyKey: "caller-key-1",
    });

    expect("success" in result && result.success).toBe(true);
    expect(applyDirectActionSpend).toHaveBeenCalledTimes(1);
    const input = vi.mocked(applyDirectActionSpend).mock.calls[0]![1];
    expect(input.idempotencyKey).toBe("caller-key-1");
    expect(input.fingerprint).toBe(
      buildDirectActionFingerprint({
        characterId,
        nppId,
        action: "boost_favorability",
        actionCost: 5,
        fundCostAnchor: 10000,
        fundsField: "funds",
      })
    );
    expect(input.actionCost).toBe(5);
    expect(input.fundCostLocal).toBe(10000);
    expect(input.relationshipBefore).toBe(25);
    expect(input.relationshipAfter).toBe(27);
    expect(input.favorUpdate?.favorability).toBe(63);
    // The route strips the primitive's duplicate flag: the surface is unchanged.
    expect(result).not.toHaveProperty("duplicate");
  });

  it("mints a distinct key per call when the caller supplies none", async () => {
    const { applyDirectActionSpend } = await import("./directActionSpend");
    await applyNppDirectAction(db as unknown as Db, {
      nppId,
      characterId,
      action: "private_meeting",
    });
    await applyNppDirectAction(db as unknown as Db, {
      nppId,
      characterId,
      action: "private_meeting",
    });

    const keys = vi.mocked(applyDirectActionSpend).mock.calls.map((call) => call[1].idempotencyKey);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("validates balances before claiming on a fresh key", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: characterId,
      actions: 0,
      funds: 50000,
      policies: { economic: 0, social: 0 },
      countryId: "US",
    });
    const { applyDirectActionSpend } = await import("./directActionSpend");

    const result = await applyNppDirectAction(db as unknown as Db, {
      nppId,
      characterId,
      action: "boost_favorability",
      idempotencyKey: "fresh-invalid",
    });

    expect(result).toEqual({
      error: expect.stringMatching(/need 5 actions/i),
      failure: "insufficient_capital",
      status: 400,
    });
    expect(applyDirectActionSpend).not.toHaveBeenCalled();
  });

  it("skips re-validation on an in-progress receipt and reconciles through the spend", async () => {
    // Post-debit reads: the spent balances would fail the fresh-path gates.
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: characterId,
      actions: 25,
      funds: 40000,
      policies: { economic: 0, social: 0 },
      countryId: "US",
    });
    db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.findOne.mockResolvedValue({
      _id: "retry-key-1",
      status: "in_progress",
      fingerprint: buildDirectActionFingerprint({
        characterId,
        nppId,
        action: "boost_favorability",
        actionCost: 5,
        fundCostAnchor: 10000,
        fundsField: "funds",
      }),
    });
    const { applyDirectActionSpend } = await import("./directActionSpend");

    const result = await applyNppDirectAction(db as unknown as Db, {
      nppId,
      characterId,
      action: "boost_favorability",
      idempotencyKey: "retry-key-1",
    });

    expect("success" in result && result.success).toBe(true);
    expect(applyDirectActionSpend).toHaveBeenCalledTimes(1);
  });

  it("rejects an endorsement ask for a candidacy the character does not own", async () => {
    db.collectionMocks["electionCandidates"]!.findOne.mockResolvedValue(null);
    const { applyDirectActionSpend } = await import("./directActionSpend");
    const candidacyId = new ObjectId().toString();

    const result = await applyNppDirectAction(db as unknown as Db, {
      nppId,
      characterId,
      action: "request_endorsement",
      candidacyId,
      idempotencyKey: "endorse-invalid",
    });

    expect(result).toEqual({ error: "Selected candidacy is not active.", status: 400 });
    expect(applyDirectActionSpend).not.toHaveBeenCalled();
  });

  it("assembles the endorsement inputs for an eligible ask", async () => {
    const electionId = new ObjectId();
    const candidacyId = new ObjectId();
    db.collectionMocks["nppRelationships"]!.findOne.mockResolvedValue({
      _id: `${characterId.toString()}_${nppId.toString()}`,
      relationshipScore: 100,
    });
    db.collectionMocks["electionCandidates"]!.findOne.mockResolvedValue({
      _id: candidacyId,
      electionId,
      characterId,
      status: "active",
      isNPP: false,
    });
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: electionId,
      countryId: "US",
    });
    const { applyDirectActionSpend } = await import("./directActionSpend");

    const result = await applyNppDirectAction(db as unknown as Db, {
      nppId,
      characterId,
      actorParty: "1",
      action: "request_endorsement",
      candidacyId: candidacyId.toString(),
      idempotencyKey: "endorse-ok",
    });

    expect("success" in result && result.success).toBe(true);
    const input = vi.mocked(applyDirectActionSpend).mock.calls[0]![1];
    expect(input.endorsement?.candidacyId).toBe(candidacyId.toString());
    expect(input.endorsement?.arrangedByParty).toBe("1");
    expect(input.endorsement?.currentTurn).toBe(10);
    expect(input.favorUpdate).toBeNull();
    expect(input.log.context.candidacyId).toEqual(candidacyId);
    expect(input.fingerprint).toContain("request_endorsement");
  });
});
