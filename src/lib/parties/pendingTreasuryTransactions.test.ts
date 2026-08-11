import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  canFillSlot,
  canProposePendingTransaction,
  canRequestFunds,
  cancelPendingTransaction,
  createPendingTransaction,
  expirePendingTransactions,
  getApproverSlotForRow,
  getMissingSlot,
  getProposerSlot,
  isPendingTransactionComplete,
  resolveTransactionApprovalMode,
} from "./pendingTreasuryTransactions";
import { PENDING_TXN_EXPIRY_TURNS } from "./proposalConstants";
import type { PendingTreasuryTransaction, PoliticalParty } from "@/lib/db/types";

function makeParty(
  seed: Partial<PoliticalParty> = {}
): Pick<PoliticalParty, "_id" | "countryId" | "chairId" | "viceChairId" | "treasurerId"> {
  return {
    _id: new ObjectId(),
    countryId: "US",
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    ...seed,
  };
}

describe("getProposerSlot", () => {
  it("returns 'treasurer' for the seated Treasurer", () => {
    const cid = new ObjectId();
    const party = makeParty({ treasurerId: cid });
    expect(getProposerSlot(party, cid)).toBe("treasurer");
  });

  it("returns 'leadership' for the seated Chair", () => {
    const cid = new ObjectId();
    const party = makeParty({ chairId: cid });
    expect(getProposerSlot(party, cid)).toBe("leadership");
  });

  it("returns 'leadership' for the seated Vice-Chair", () => {
    const cid = new ObjectId();
    const party = makeParty({ viceChairId: cid });
    expect(getProposerSlot(party, cid)).toBe("leadership");
  });

  it("returns null when the character holds none of the three roles", () => {
    const party = makeParty({ chairId: new ObjectId() });
    expect(getProposerSlot(party, new ObjectId())).toBeNull();
  });

  it("prefers 'treasurer' when a character somehow holds both treasurer + chair (data anomaly)", () => {
    const cid = new ObjectId();
    const party = makeParty({ treasurerId: cid, chairId: cid });
    expect(getProposerSlot(party, cid)).toBe("treasurer");
  });
});

describe("getMissingSlot", () => {
  it("returns 'treasurer' when treasurerApproval is absent", () => {
    expect(
      getMissingSlot({
        treasurerApproval: undefined,
        leadershipApproval: { characterId: new ObjectId(), approvedAt: new Date() },
      })
    ).toBe("treasurer");
  });

  it("returns 'leadership' when leadershipApproval is absent", () => {
    expect(
      getMissingSlot({
        treasurerApproval: { characterId: new ObjectId(), approvedAt: new Date() },
        leadershipApproval: undefined,
      })
    ).toBe("leadership");
  });

  it("returns null when both slots are filled", () => {
    expect(
      getMissingSlot({
        treasurerApproval: { characterId: new ObjectId(), approvedAt: new Date() },
        leadershipApproval: { characterId: new ObjectId(), approvedAt: new Date() },
      })
    ).toBeNull();
  });
});

describe("canFillSlot", () => {
  it("treasurer slot: only the seated Treasurer qualifies", () => {
    const treasurerId = new ObjectId();
    const chairId = new ObjectId();
    const party = makeParty({ treasurerId, chairId });
    expect(canFillSlot(party, treasurerId, "treasurer")).toBe(true);
    expect(canFillSlot(party, chairId, "treasurer")).toBe(false);
  });

  it("leadership slot: Chair OR VC qualifies", () => {
    const chairId = new ObjectId();
    const vcId = new ObjectId();
    const party = makeParty({ chairId, viceChairId: vcId });
    expect(canFillSlot(party, chairId, "leadership")).toBe(true);
    expect(canFillSlot(party, vcId, "leadership")).toBe(true);
  });

  it("leadership slot: outsider rejected", () => {
    const party = makeParty({ chairId: new ObjectId() });
    expect(canFillSlot(party, new ObjectId(), "leadership")).toBe(false);
  });

  it("leadership slot: VC qualifies even when chair seat vacant (acting capacity)", () => {
    const vcId = new ObjectId();
    const party = makeParty({ chairId: null, viceChairId: vcId });
    expect(canFillSlot(party, vcId, "leadership")).toBe(true);
  });

  it("treasurer slot: Chair / VC act as Treasurer when the seat is vacant", () => {
    const chairId = new ObjectId();
    const vcId = new ObjectId();
    const party = makeParty({ chairId, viceChairId: vcId, treasurerId: null });
    expect(canFillSlot(party, chairId, "treasurer")).toBe(true);
    expect(canFillSlot(party, vcId, "treasurer")).toBe(true);
    // An outsider still cannot act as Treasurer.
    expect(canFillSlot(party, new ObjectId(), "treasurer")).toBe(false);
  });

  it("treasurer slot: Chair cannot act as Treasurer while the seat is filled", () => {
    const chairId = new ObjectId();
    const treasurerId = new ObjectId();
    const party = makeParty({ chairId, treasurerId });
    expect(canFillSlot(party, chairId, "treasurer")).toBe(false);
  });
});

describe("resolveTransactionApprovalMode", () => {
  it("double + seated Treasurer stays double", () => {
    const party = makeParty({ transactionApprovalMode: "double", treasurerId: new ObjectId() });
    expect(resolveTransactionApprovalMode(party)).toBe("double");
  });

  it("double + vacant Treasurer collapses to single", () => {
    const party = makeParty({ transactionApprovalMode: "double", treasurerId: null });
    expect(resolveTransactionApprovalMode(party)).toBe("single");
  });

  it("absent mode (legacy) is treated as double, and collapses when vacant", () => {
    expect(resolveTransactionApprovalMode(makeParty({ treasurerId: new ObjectId() }))).toBe(
      "double"
    );
    expect(resolveTransactionApprovalMode(makeParty({ treasurerId: null }))).toBe("single");
  });

  it("single mode is returned unchanged regardless of Treasurer seat", () => {
    expect(
      resolveTransactionApprovalMode(
        makeParty({ transactionApprovalMode: "single", treasurerId: null })
      )
    ).toBe("single");
    expect(
      resolveTransactionApprovalMode(
        makeParty({ transactionApprovalMode: "single", treasurerId: new ObjectId() })
      )
    ).toBe("single");
  });
});

describe("canProposePendingTransaction", () => {
  it("rejects when Treasurer slot is vacant", () => {
    const party = makeParty({ chairId: new ObjectId(), treasurerId: null });
    const result = canProposePendingTransaction(party);
    expect(result.ok).toBe(false);
  });

  it("rejects when both Chair AND VC are vacant (even with Treasurer)", () => {
    const party = makeParty({
      chairId: null,
      viceChairId: null,
      treasurerId: new ObjectId(),
    });
    expect(canProposePendingTransaction(party).ok).toBe(false);
  });

  it("accepts when Treasurer + Chair are seated", () => {
    const party = makeParty({
      chairId: new ObjectId(),
      treasurerId: new ObjectId(),
    });
    expect(canProposePendingTransaction(party).ok).toBe(true);
  });

  it("accepts when Treasurer + VC are seated (chair vacant)", () => {
    const party = makeParty({
      chairId: null,
      viceChairId: new ObjectId(),
      treasurerId: new ObjectId(),
    });
    expect(canProposePendingTransaction(party).ok).toBe(true);
  });
});

// ─── Mock Db stub for lifecycle writes ──────────────────────────────────────

type CapturedOp = {
  collection: string;
  op: "insertOne" | "updateOne" | "updateMany";
  filter?: unknown;
  update?: unknown;
  doc?: unknown;
};

function makeDbStub() {
  const ops: CapturedOp[] = [];
  const collection = vi.fn().mockImplementation((name: string) => ({
    insertOne: vi.fn().mockImplementation((doc: unknown) => {
      ops.push({ collection: name, op: "insertOne", doc });
      return Promise.resolve({ insertedId: new ObjectId() });
    }),
    updateOne: vi.fn().mockImplementation((filter: unknown, update: unknown) => {
      ops.push({ collection: name, op: "updateOne", filter, update });
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
    }),
    updateMany: vi.fn().mockImplementation((filter: unknown, update: unknown) => {
      ops.push({ collection: name, op: "updateMany", filter, update });
      return Promise.resolve({ matchedCount: 3, modifiedCount: 3 });
    }),
  }));
  return { db: { collection } as unknown as Db, ops };
}

describe("createPendingTransaction", () => {
  it("writes a row with proposer's treasurer slot pre-filled when proposer is Treasurer", async () => {
    const treasurerId = new ObjectId();
    const party = makeParty({
      chairId: new ObjectId(),
      treasurerId,
    });
    const { db, ops } = makeDbStub();
    const result = await createPendingTransaction(
      db,
      {
        party,
        proposerCharacterId: treasurerId,
        type: "send",
        amount: 100_000,
        targetCharacterId: new ObjectId(),
      },
      500
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!.collection).toBe("pendingTreasuryTransactions");
    expect(ops[0]!.op).toBe("insertOne");
    const doc = ops[0]!.doc as PendingTreasuryTransaction;
    expect(doc.treasurerApproval?.characterId).toEqual(treasurerId);
    expect(doc.leadershipApproval).toBeUndefined();
    // Regression guard — the unfilled slot key must be entirely absent
    // (see the "request type" test below for the BSON-null explanation).
    expect("leadershipApproval" in doc).toBe(false);
    expect(doc.status).toBe("open");
    expect(doc.expiresAtTurn).toBe(500 + PENDING_TXN_EXPIRY_TURNS);
    expect(result.treasurerApproval?.characterId).toEqual(treasurerId);
  });

  it("writes a row with proposer's leadership slot pre-filled when proposer is Chair", async () => {
    const chairId = new ObjectId();
    const party = makeParty({
      chairId,
      treasurerId: new ObjectId(),
    });
    const { db, ops } = makeDbStub();
    await createPendingTransaction(
      db,
      {
        party,
        proposerCharacterId: chairId,
        type: "transfer",
        amount: 200_000,
        targetStateId: "CA",
      },
      100
    );
    const doc = ops[0]!.doc as PendingTreasuryTransaction;
    expect(doc.leadershipApproval?.characterId).toEqual(chairId);
    expect(doc.treasurerApproval).toBeUndefined();
    expect("treasurerApproval" in doc).toBe(false);
    expect(doc.type).toBe("transfer");
    expect(doc.targetStateId).toBe("CA");
  });

  it("writes a row with leadership pre-filled when proposer is VC (chair vacant)", async () => {
    const vcId = new ObjectId();
    const party = makeParty({
      chairId: null,
      viceChairId: vcId,
      treasurerId: new ObjectId(),
    });
    const { db, ops } = makeDbStub();
    await createPendingTransaction(
      db,
      {
        party,
        proposerCharacterId: vcId,
        type: "send",
        amount: 50_000,
        targetCharacterId: new ObjectId(),
      },
      0
    );
    const doc = ops[0]!.doc as PendingTreasuryTransaction;
    expect(doc.leadershipApproval?.characterId).toEqual(vcId);
  });

  it("throws when Treasurer slot is vacant", async () => {
    const chairId = new ObjectId();
    const party = makeParty({ chairId, treasurerId: null });
    const { db } = makeDbStub();
    await expect(
      createPendingTransaction(
        db,
        {
          party,
          proposerCharacterId: chairId,
          type: "send",
          amount: 1,
          targetCharacterId: new ObjectId(),
        },
        0
      )
    ).rejects.toThrow(/Treasurer/);
  });

  it("throws when both Chair AND VC are vacant", async () => {
    const treasurerId = new ObjectId();
    const party = makeParty({
      chairId: null,
      viceChairId: null,
      treasurerId,
    });
    const { db } = makeDbStub();
    await expect(
      createPendingTransaction(
        db,
        {
          party,
          proposerCharacterId: treasurerId,
          type: "send",
          amount: 1,
          targetCharacterId: new ObjectId(),
        },
        0
      )
    ).rejects.toThrow(/Chair or Vice-Chair/);
  });

  it("throws when proposer holds none of the three approver roles", async () => {
    const party = makeParty({
      chairId: new ObjectId(),
      treasurerId: new ObjectId(),
    });
    const { db } = makeDbStub();
    await expect(
      createPendingTransaction(
        db,
        {
          party,
          proposerCharacterId: new ObjectId(),
          type: "send",
          amount: 1,
          targetCharacterId: new ObjectId(),
        },
        0
      )
    ).rejects.toThrow(/Treasurer, Chair, or Vice-Chair/);
  });
});

describe("cancelPendingTransaction", () => {
  it("cancels with a status=open + proposedBy=canceller filter", async () => {
    const { db, ops } = makeDbStub();
    const txnId = new ObjectId();
    const cancellerId = new ObjectId();
    const ok = await cancelPendingTransaction(db, txnId, cancellerId);
    expect(ok).toBe(true);
    expect(ops).toHaveLength(1);
    const filter = ops[0]!.filter as {
      _id: ObjectId;
      status: string;
      proposedBy: ObjectId;
    };
    expect(filter.status).toBe("open");
    expect(filter.proposedBy).toEqual(cancellerId);
    const update = ops[0]!.update as { $set: { status: string } };
    expect(update.$set.status).toBe("cancelled");
  });
});

describe("canRequestFunds", () => {
  it("single mode accepts when any one of Treasurer / Chair / VC is seated", () => {
    expect(
      canRequestFunds({ chairId: null, viceChairId: null, treasurerId: new ObjectId() }, "single")
        .ok
    ).toBe(true);
    expect(
      canRequestFunds({ chairId: new ObjectId(), viceChairId: null, treasurerId: null }, "single")
        .ok
    ).toBe(true);
    expect(
      canRequestFunds({ chairId: null, viceChairId: new ObjectId(), treasurerId: null }, "single")
        .ok
    ).toBe(true);
  });

  it("single mode rejects when all three officer seats are vacant", () => {
    const result = canRequestFunds(
      { chairId: null, viceChairId: null, treasurerId: null },
      "single"
    );
    expect(result.ok).toBe(false);
  });

  it("double mode applies the stricter canProposePendingTransaction rules", () => {
    // No Treasurer → rejected even with chair seated
    expect(
      canRequestFunds({ chairId: new ObjectId(), viceChairId: null, treasurerId: null }, "double")
        .ok
    ).toBe(false);
    // Treasurer + Chair → accepted
    expect(
      canRequestFunds(
        { chairId: new ObjectId(), viceChairId: null, treasurerId: new ObjectId() },
        "double"
      ).ok
    ).toBe(true);
  });
});

describe("isPendingTransactionComplete", () => {
  it("send rows require both slots filled", () => {
    expect(
      isPendingTransactionComplete({
        type: "send",
        approvalModeAtPropose: "double",
        treasurerApproval: { characterId: new ObjectId(), approvedAt: new Date() },
        leadershipApproval: undefined,
      })
    ).toBe(false);
    expect(
      isPendingTransactionComplete({
        type: "send",
        approvalModeAtPropose: "double",
        treasurerApproval: { characterId: new ObjectId(), approvedAt: new Date() },
        leadershipApproval: { characterId: new ObjectId(), approvedAt: new Date() },
      })
    ).toBe(true);
  });

  it("request + single mode completes on any slot filled", () => {
    expect(
      isPendingTransactionComplete({
        type: "request",
        approvalModeAtPropose: "single",
        treasurerApproval: { characterId: new ObjectId(), approvedAt: new Date() },
        leadershipApproval: undefined,
      })
    ).toBe(true);
    expect(
      isPendingTransactionComplete({
        type: "request",
        approvalModeAtPropose: "single",
        treasurerApproval: undefined,
        leadershipApproval: { characterId: new ObjectId(), approvedAt: new Date() },
      })
    ).toBe(true);
  });

  it("request + single + no approvals → not complete", () => {
    expect(
      isPendingTransactionComplete({
        type: "request",
        approvalModeAtPropose: "single",
        treasurerApproval: undefined,
        leadershipApproval: undefined,
      })
    ).toBe(false);
  });

  it("request + double mode requires both slots", () => {
    expect(
      isPendingTransactionComplete({
        type: "request",
        approvalModeAtPropose: "double",
        treasurerApproval: { characterId: new ObjectId(), approvedAt: new Date() },
        leadershipApproval: undefined,
      })
    ).toBe(false);
    expect(
      isPendingTransactionComplete({
        type: "request",
        approvalModeAtPropose: "double",
        treasurerApproval: { characterId: new ObjectId(), approvedAt: new Date() },
        leadershipApproval: { characterId: new ObjectId(), approvedAt: new Date() },
      })
    ).toBe(true);
  });

  it("legacy row (no approvalModeAtPropose) is treated as double", () => {
    expect(
      isPendingTransactionComplete({
        type: "send",
        treasurerApproval: { characterId: new ObjectId(), approvedAt: new Date() },
        leadershipApproval: undefined,
      })
    ).toBe(false);
  });
});

describe("getApproverSlotForRow", () => {
  it("send/transfer: returns the slot matching the character's role", () => {
    const treasurerId = new ObjectId();
    const party = makeParty({ treasurerId });
    expect(
      getApproverSlotForRow(party, { type: "send", proposedBy: new ObjectId() }, treasurerId)
    ).toBe("treasurer");
  });

  it("request: returns null when caller is the requester (self-approval forbidden)", () => {
    const requesterId = new ObjectId();
    // Requester also happens to hold the Treasurer seat — still null
    const party = makeParty({ treasurerId: requesterId });
    expect(
      getApproverSlotForRow(party, { type: "request", proposedBy: requesterId }, requesterId)
    ).toBeNull();
  });

  it("request: returns the matching slot for a non-proposer officer", () => {
    const chairId = new ObjectId();
    const party = makeParty({ chairId });
    expect(
      getApproverSlotForRow(party, { type: "request", proposedBy: new ObjectId() }, chairId)
    ).toBe("leadership");
  });

  it("returns null for an outsider (not an officer)", () => {
    const party = makeParty({ chairId: new ObjectId() });
    expect(
      getApproverSlotForRow(party, { type: "send", proposedBy: new ObjectId() }, new ObjectId())
    ).toBeNull();
  });

  it("acting-Treasurer: Chair fills the empty treasurer slot when the seat is vacant", () => {
    const chairId = new ObjectId();
    const party = makeParty({ chairId, treasurerId: null });
    // Row proposed by the chair (leadership pre-filled), treasurer slot
    // empty and now unfillable by a seated Treasurer — the chair acts as
    // Treasurer to clear it.
    const row = {
      type: "send" as const,
      proposedBy: new ObjectId(),
      treasurerApproval: undefined,
      leadershipApproval: { characterId: chairId, approvedAt: new Date() },
    };
    expect(getApproverSlotForRow(party, row, chairId)).toBe("treasurer");
  });

  it("acting-Treasurer: Chair does NOT take the treasurer slot while a Treasurer is seated", () => {
    const chairId = new ObjectId();
    const treasurerId = new ObjectId();
    const party = makeParty({ chairId, treasurerId });
    const row = {
      type: "send" as const,
      proposedBy: new ObjectId(),
      treasurerApproval: undefined,
      leadershipApproval: { characterId: chairId, approvedAt: new Date() },
    };
    // Leadership filled by the chair, treasurer slot reserved for the
    // seated Treasurer — the chair cannot self-complete.
    expect(getApproverSlotForRow(party, row, chairId)).toBeNull();
  });

  it("prefers the natural leadership slot when both slots are open (single-mode request)", () => {
    const chairId = new ObjectId();
    const party = makeParty({ chairId, treasurerId: null });
    const row = {
      type: "request" as const,
      proposedBy: new ObjectId(),
      treasurerApproval: undefined,
      leadershipApproval: undefined,
    };
    expect(getApproverSlotForRow(party, row, chairId)).toBe("leadership");
  });
});

describe("createPendingTransaction — request type", () => {
  it("inserts a request row with NO slot pre-filled (no auto-approval)", async () => {
    const treasurerId = new ObjectId();
    const requesterId = new ObjectId();
    const party = makeParty({
      treasurerId,
      chairId: new ObjectId(),
    });
    const { db, ops } = makeDbStub();
    await createPendingTransaction(
      db,
      {
        party,
        proposerCharacterId: requesterId,
        type: "request",
        mode: "double",
        amount: 50_000,
        targetCharacterId: requesterId,
      },
      100
    );
    const doc = ops[0]!.doc as PendingTreasuryTransaction;
    expect(doc.type).toBe("request");
    expect(doc.treasurerApproval).toBeUndefined();
    expect(doc.leadershipApproval).toBeUndefined();
    expect(doc.approvalModeAtPropose).toBe("double");
    expect(doc.targetCharacterId).toEqual(requesterId);
    // Regression guard: the slot keys must be entirely absent — not present
    // with value undefined. The mongodb driver serializes undefined as BSON
    // null, which would then break the approve route's `{ $exists: false }`
    // atomic claim.
    expect("treasurerApproval" in doc).toBe(false);
    expect("leadershipApproval" in doc).toBe(false);
  });

  it("inserts a request row even when proposer holds the Treasurer seat (no auto-approval)", async () => {
    const treasurerId = new ObjectId();
    const party = makeParty({
      treasurerId,
      chairId: new ObjectId(),
    });
    const { db, ops } = makeDbStub();
    await createPendingTransaction(
      db,
      {
        party,
        proposerCharacterId: treasurerId,
        type: "request",
        mode: "single",
        amount: 10_000,
        targetCharacterId: treasurerId,
      },
      100
    );
    const doc = ops[0]!.doc as PendingTreasuryTransaction;
    expect(doc.treasurerApproval).toBeUndefined();
    expect(doc.leadershipApproval).toBeUndefined();
    expect(doc.approvalModeAtPropose).toBe("single");
  });

  it("request in single mode succeeds when only Treasurer is seated", async () => {
    const party = makeParty({
      treasurerId: new ObjectId(),
      chairId: null,
      viceChairId: null,
    });
    const { db, ops } = makeDbStub();
    await createPendingTransaction(
      db,
      {
        party,
        proposerCharacterId: new ObjectId(),
        type: "request",
        mode: "single",
        amount: 5_000,
        targetCharacterId: new ObjectId(),
      },
      100
    );
    expect(ops).toHaveLength(1);
  });

  it("request in double mode rejects when only Treasurer is seated", async () => {
    const party = makeParty({
      treasurerId: new ObjectId(),
      chairId: null,
      viceChairId: null,
    });
    const { db } = makeDbStub();
    await expect(
      createPendingTransaction(
        db,
        {
          party,
          proposerCharacterId: new ObjectId(),
          type: "request",
          mode: "double",
          amount: 5_000,
          targetCharacterId: new ObjectId(),
        },
        100
      )
    ).rejects.toThrow(/Chair or Vice-Chair/);
  });

  it("request rejects when all three officer seats are vacant (even in single mode)", async () => {
    const party = makeParty({
      treasurerId: null,
      chairId: null,
      viceChairId: null,
    });
    const { db } = makeDbStub();
    await expect(
      createPendingTransaction(
        db,
        {
          party,
          proposerCharacterId: new ObjectId(),
          type: "request",
          mode: "single",
          amount: 5_000,
          targetCharacterId: new ObjectId(),
        },
        100
      )
    ).rejects.toThrow();
  });
});

describe("expirePendingTransactions", () => {
  it("uses status=open + expiresAtTurn<=currentTurn filter", async () => {
    const { db, ops } = makeDbStub();
    const count = await expirePendingTransactions(db, 999);
    expect(count).toBe(3);
    const filter = ops[0]!.filter as {
      status: string;
      expiresAtTurn: { $lte: number };
    };
    expect(filter.status).toBe("open");
    expect(filter.expiresAtTurn.$lte).toBe(999);
    const update = ops[0]!.update as { $set: { status: string } };
    expect(update.$set.status).toBe("expired");
  });
});
