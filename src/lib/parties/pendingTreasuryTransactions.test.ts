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
): Pick<
  PoliticalParty,
  "_id" | "countryId" | "chairId" | "viceChairId" | "treasurerId" | "transactionApprovalMode"
> {
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

  it("puts a seated Chair in the first slot too", () => {
    // Slots are not role-typed: the proposer takes slot 1 whoever they are.
    const cid = new ObjectId();
    const party = makeParty({ chairId: cid });
    expect(getProposerSlot(party, cid)).toBe("treasurer");
  });

  it("puts a seated Vice-Chair in the first slot too", () => {
    const cid = new ObjectId();
    const party = makeParty({ viceChairId: cid });
    expect(getProposerSlot(party, cid)).toBe("treasurer");
  });

  it("returns null when the character holds none of the three roles", () => {
    const party = makeParty({ chairId: new ObjectId() });
    expect(getProposerSlot(party, new ObjectId())).toBeNull();
  });

  it("returns the first slot when a character holds two seats (data anomaly)", () => {
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
  it("either slot accepts any seated officer", () => {
    const treasurerId = new ObjectId();
    const chairId = new ObjectId();
    const party = makeParty({ treasurerId, chairId });
    expect(canFillSlot(party, treasurerId, "treasurer")).toBe(true);
    expect(canFillSlot(party, chairId, "treasurer")).toBe(true);
    expect(canFillSlot(party, treasurerId, "leadership")).toBe(true);
    expect(canFillSlot(party, chairId, "leadership")).toBe(true);
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

  it("either slot works with no Treasurer seated at all", () => {
    const chairId = new ObjectId();
    const vcId = new ObjectId();
    const party = makeParty({ chairId, viceChairId: vcId, treasurerId: null });
    expect(canFillSlot(party, chairId, "treasurer")).toBe(true);
    expect(canFillSlot(party, vcId, "treasurer")).toBe(true);
    // An outsider still cannot act as Treasurer.
    expect(canFillSlot(party, new ObjectId(), "treasurer")).toBe(false);
  });

  it("treasurer slot: an outsider is still rejected", () => {
    const party = makeParty({ chairId: new ObjectId(), treasurerId: new ObjectId() });
    expect(canFillSlot(party, new ObjectId(), "treasurer")).toBe(false);
  });
});

describe("resolveTransactionApprovalMode", () => {
  it("double + seated Treasurer stays double", () => {
    const party = makeParty({ transactionApprovalMode: "double", treasurerId: new ObjectId() });
    expect(resolveTransactionApprovalMode(party)).toBe("double");
  });

  it("double + vacant Treasurer STAYS double", () => {
    // A vacant Treasurer seat is no longer a fallback: a Chair plus
    // Vice-Chair can sign without one.
    const party = makeParty({ transactionApprovalMode: "double", treasurerId: null });
    expect(resolveTransactionApprovalMode(party)).toBe("double");
  });

  it("absent mode (legacy) is treated as double, seat or no seat", () => {
    expect(resolveTransactionApprovalMode(makeParty({ treasurerId: new ObjectId() }))).toBe(
      "double"
    );
    expect(resolveTransactionApprovalMode(makeParty({ treasurerId: null }))).toBe("double");
  });

  it("a solo-player party falls back to single", () => {
    // Two-person approval needs two people; a lone player has nobody to
    // countersign and would otherwise be frozen out of their own money.
    const party = makeParty({ transactionApprovalMode: "double" });
    expect(resolveTransactionApprovalMode(party, { soloPlayerParty: true })).toBe("single");
  });

  it("absent mode + solo player falls back to single", () => {
    expect(resolveTransactionApprovalMode(makeParty(), { soloPlayerParty: true })).toBe("single");
  });

  it("a party with more than one player stays double", () => {
    const party = makeParty({ transactionApprovalMode: "double" });
    expect(resolveTransactionApprovalMode(party, { soloPlayerParty: false })).toBe("double");
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
  it("rejects when only one officer is seated (Chair alone)", () => {
    const party = makeParty({ chairId: new ObjectId(), treasurerId: null });
    const result = canProposePendingTransaction(party);
    expect(result.ok).toBe(false);
  });

  it("rejects when only one officer is seated (Treasurer alone)", () => {
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

  it("puts the proposing Chair in slot 1, leaving slot 2 for someone else", async () => {
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
    expect(doc.treasurerApproval?.characterId).toEqual(chairId);
    expect(doc.leadershipApproval).toBeUndefined();
    // The unfilled slot must be OMITTED, not written as undefined: the
    // driver would store it as null and break the approve-time
    // `{ $exists: false }` claim.
    expect("leadershipApproval" in doc).toBe(false);
    expect(doc.type).toBe("transfer");
    expect(doc.targetStateId).toBe("CA");
  });

  it("puts the proposing Vice-Chair in slot 1 (chair vacant)", async () => {
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
    expect(doc.treasurerApproval?.characterId).toEqual(vcId);
    expect(doc.leadershipApproval).toBeUndefined();
  });

  it("throws when the Chair is the only seated officer", async () => {
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
    ).rejects.toThrow(/two different officers/);
  });

  it("throws when only one officer is seated", async () => {
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
    ).rejects.toThrow(/two different officers/);
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

  it("request: gives a non-proposer officer the first empty slot", () => {
    const chairId = new ObjectId();
    const party = makeParty({ chairId });
    expect(
      getApproverSlotForRow(party, { type: "request", proposedBy: new ObjectId() }, chairId)
    ).toBe("treasurer");
  });

  it("returns null for an outsider (not an officer)", () => {
    const party = makeParty({ chairId: new ObjectId() });
    expect(
      getApproverSlotForRow(party, { type: "send", proposedBy: new ObjectId() }, new ObjectId())
    ).toBeNull();
  });

  it("refuses a character who already signed the other slot", () => {
    // This is what keeps the approval two-person now that either slot
    // accepts any officer.
    const chairId = new ObjectId();
    const party = makeParty({ chairId, treasurerId: null });
    const row = {
      type: "send" as const,
      proposedBy: new ObjectId(),
      treasurerApproval: undefined,
      leadershipApproval: { characterId: chairId, approvedAt: new Date() },
    };
    expect(getApproverSlotForRow(party, row, chairId)).toBeNull();
  });

  it("a Vice-Chair may complete a row the Chair started, with no Treasurer seated", () => {
    const chairId = new ObjectId();
    const vcId = new ObjectId();
    const party = makeParty({ chairId, viceChairId: vcId, treasurerId: null });
    const row = {
      type: "send" as const,
      proposedBy: chairId,
      treasurerApproval: { characterId: chairId, approvedAt: new Date() },
      leadershipApproval: undefined,
    };
    expect(getApproverSlotForRow(party, row, vcId)).toBe("leadership");
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

  it("takes the first empty slot when both are open", () => {
    const chairId = new ObjectId();
    const party = makeParty({ chairId, treasurerId: null });
    const row = {
      type: "request" as const,
      proposedBy: new ObjectId(),
      treasurerApproval: undefined,
      leadershipApproval: undefined,
    };
    expect(getApproverSlotForRow(party, row, chairId)).toBe("treasurer");
  });

  it("send: returns null when the caller is the recipient", () => {
    const treasurerId = new ObjectId();
    const party = makeParty({ treasurerId });
    const row = {
      type: "send" as const,
      proposedBy: new ObjectId(),
      targetCharacterId: treasurerId,
    };
    // The Treasurer could otherwise sign off on a payment to themselves.
    expect(getApproverSlotForRow(party, row, treasurerId)).toBeNull();
  });

  it("send: a Chair cannot act as Treasurer on their own self-send", () => {
    // This is the exact shape that let a Chair drain a treasury: propose
    // a self-send (leadership pre-filled), then fill the vacant treasurer
    // slot as acting Treasurer. The recipient exclusion blocks it.
    const chairId = new ObjectId();
    const party = makeParty({ chairId, treasurerId: null });
    const row = {
      type: "send" as const,
      proposedBy: chairId,
      targetCharacterId: chairId,
      treasurerApproval: undefined,
      leadershipApproval: { characterId: chairId, approvedAt: new Date() },
    };
    expect(getApproverSlotForRow(party, row, chairId)).toBeNull();
  });

  it("send: a Vice-Chair may still approve a self-send proposed by the Chair", () => {
    const chairId = new ObjectId();
    const viceChairId = new ObjectId();
    const party = makeParty({ chairId, viceChairId, treasurerId: null });
    const row = {
      type: "send" as const,
      proposedBy: chairId,
      targetCharacterId: chairId,
      treasurerApproval: undefined,
      leadershipApproval: { characterId: chairId, approvedAt: new Date() },
    };
    // A genuine second person signs the second slot.
    expect(getApproverSlotForRow(party, row, viceChairId)).toBe("treasurer");
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

  it("request in double mode rejects when only one officer is seated", async () => {
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
    ).rejects.toThrow(/two different officers/);
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
