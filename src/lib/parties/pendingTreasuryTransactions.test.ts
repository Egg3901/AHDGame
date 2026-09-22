import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  canProposePendingTransaction,
  canRequestFunds,
  cancelPendingTransaction,
  countSeatedOfficers,
  createPendingTransaction,
  expirePendingTransactions,
  getApproverSlotForRow,
  getMissingSlot,
  getProposerSlot,
  isPartyOfficer,
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
  it("gives the first slot to any seated officer", () => {
    // Both slots are empty on a brand-new row, so a proposer takes the
    // first one whichever seat they hold.
    for (const seat of ["chairId", "viceChairId", "treasurerId"] as const) {
      const cid = new ObjectId();
      expect(getProposerSlot(makeParty({ [seat]: cid }), cid)).toBe("first");
    }
  });

  it("returns null when the character holds none of the three seats", () => {
    const party = makeParty({ chairId: new ObjectId() });
    expect(getProposerSlot(party, new ObjectId())).toBeNull();
  });
});

describe("getMissingSlot", () => {
  it("returns 'first' when the first slot is empty", () => {
    expect(
      getMissingSlot({
        leadershipApproval: { characterId: new ObjectId(), approvedAt: new Date() },
      })
    ).toBe("first");
  });

  it("returns 'second' when only the first is filled", () => {
    expect(
      getMissingSlot({
        treasurerApproval: { characterId: new ObjectId(), approvedAt: new Date() },
      })
    ).toBe("second");
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

describe("isPartyOfficer", () => {
  it("accepts any of the three seats and rejects an outsider", () => {
    for (const seat of ["chairId", "viceChairId", "treasurerId"] as const) {
      const cid = new ObjectId();
      expect(isPartyOfficer(makeParty({ [seat]: cid }), cid)).toBe(true);
    }
    expect(isPartyOfficer(makeParty({ chairId: new ObjectId() }), new ObjectId())).toBe(false);
  });
});

describe("countSeatedOfficers", () => {
  it("counts distinct people, not seats", () => {
    // One person wearing two hats is still one signature. Counting
    // seats would let them satisfy a two-person approval alone.
    const both = new ObjectId();
    expect(countSeatedOfficers(makeParty({ chairId: both, treasurerId: both }))).toBe(1);
    expect(
      countSeatedOfficers(makeParty({ chairId: new ObjectId(), treasurerId: new ObjectId() }))
    ).toBe(2);
    expect(countSeatedOfficers(makeParty())).toBe(0);
  });
});

describe("resolveTransactionApprovalMode", () => {
  it("stays double whenever two different officers are seated", () => {
    // Including Chair + VC with NO Treasurer, which used to collapse to
    // a single signature even though two people were sitting there.
    expect(
      resolveTransactionApprovalMode(
        makeParty({ chairId: new ObjectId(), viceChairId: new ObjectId() })
      )
    ).toBe("double");
    expect(
      resolveTransactionApprovalMode(
        makeParty({ treasurerId: new ObjectId(), chairId: new ObjectId() })
      )
    ).toBe("double");
  });

  it("collapses to single when fewer than two officers are seated", () => {
    expect(resolveTransactionApprovalMode(makeParty({ chairId: new ObjectId() }))).toBe("single");
    expect(resolveTransactionApprovalMode(makeParty())).toBe("single");
  });

  it("collapses when one person holds two seats", () => {
    const both = new ObjectId();
    expect(resolveTransactionApprovalMode(makeParty({ chairId: both, treasurerId: both }))).toBe(
      "single"
    );
  });

  it("absent mode (legacy) is treated as double", () => {
    const party = {
      ...makeParty({ chairId: new ObjectId(), viceChairId: new ObjectId() }),
      transactionApprovalMode: undefined,
    };
    expect(resolveTransactionApprovalMode(party)).toBe("double");
  });

  it("single mode is returned unchanged regardless of seats", () => {
    const party = {
      ...makeParty({ chairId: new ObjectId(), viceChairId: new ObjectId() }),
      transactionApprovalMode: "single" as const,
    };
    expect(resolveTransactionApprovalMode(party)).toBe("single");
  });
});

describe("canProposePendingTransaction", () => {
  it("accepts any two different officers, in any combination of seats", () => {
    expect(
      canProposePendingTransaction(
        makeParty({ chairId: new ObjectId(), viceChairId: new ObjectId() })
      ).ok
    ).toBe(true);
    expect(
      canProposePendingTransaction(
        makeParty({ treasurerId: new ObjectId(), viceChairId: new ObjectId() })
      ).ok
    ).toBe(true);
  });

  it("rejects when only one officer is seated", () => {
    expect(canProposePendingTransaction(makeParty({ treasurerId: new ObjectId() })).ok).toBe(false);
  });

  it("rejects when one person holds two seats", () => {
    const both = new ObjectId();
    expect(canProposePendingTransaction(makeParty({ chairId: both, treasurerId: both })).ok).toBe(
      false
    );
  });
});

// ─── Mock Db stub for lifecycle writes ──────────────────────────

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

  it("puts a Chair proposer in the first slot, not a Chair-specific one", async () => {
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
    expect("leadershipApproval" in doc).toBe(false);
    expect(doc.type).toBe("transfer");
    expect(doc.targetStateId).toBe("CA");
  });

  it("puts a Vice-Chair proposer in the first slot too", async () => {
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
  });

  it("throws when only one officer is seated", async () => {
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

  it("accepts a Chair plus a Vice-Chair with no Treasurer seated", async () => {
    // Previously impossible: the propose gate demanded a seated
    // Treasurer, so this party could not use two-person approval at all
    // despite having two people able to sign.
    const chairId = new ObjectId();
    const party = makeParty({
      chairId,
      viceChairId: new ObjectId(),
      treasurerId: null,
    });
    const { db, ops } = makeDbStub();
    await createPendingTransaction(
      db,
      {
        party,
        proposerCharacterId: chairId,
        type: "send",
        amount: 1,
        targetCharacterId: new ObjectId(),
      },
      0
    );
    const doc = ops[0]!.doc as PendingTreasuryTransaction;
    expect(doc.treasurerApproval?.characterId).toEqual(chairId);
    expect("leadershipApproval" in doc).toBe(false);
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

describe("canRequestFunds excludes the requester", () => {
  it("refuses a single-mode request when the only officer is the requester", () => {
    // Nobody may approve their own Request Funds, so a party whose sole
    // officer is the requester has no one who could ever sign it. The
    // row used to be created anyway and sat until the expiry sweep.
    const requesterId = new ObjectId();
    const party = makeParty({ chairId: requesterId });
    const result = canRequestFunds(party, "single", requesterId);
    expect(result.ok).toBe(false);
  });

  it("allows a single-mode request when another officer could sign", () => {
    const requesterId = new ObjectId();
    const party = makeParty({ chairId: requesterId, treasurerId: new ObjectId() });
    expect(canRequestFunds(party, "single", requesterId).ok).toBe(true);
  });

  it("refuses a double-mode request when only one officer besides the requester is seated", () => {
    const requesterId = new ObjectId();
    const party = makeParty({ chairId: requesterId, treasurerId: new ObjectId() });
    expect(canRequestFunds(party, "double", requesterId).ok).toBe(false);
  });

  it("allows a double-mode request when two others could sign", () => {
    const requesterId = new ObjectId();
    const party = makeParty({
      chairId: requesterId,
      viceChairId: new ObjectId(),
      treasurerId: new ObjectId(),
    });
    expect(canRequestFunds(party, "double", requesterId).ok).toBe(true);
  });

  it("counts a requester who holds two seats as one excluded person", () => {
    const requesterId = new ObjectId();
    const other = new ObjectId();
    const party = makeParty({ chairId: requesterId, treasurerId: requesterId, viceChairId: other });
    expect(countSeatedOfficers(party, requesterId)).toBe(1);
    expect(canRequestFunds(party, "double", requesterId).ok).toBe(false);
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
  it("gives any officer the next empty slot, whatever seat they hold", () => {
    const chairId = new ObjectId();
    const party = makeParty({ chairId, treasurerId: new ObjectId() });
    const row = {
      type: "send" as const,
      proposedBy: new ObjectId(),
      treasurerApproval: undefined,
      leadershipApproval: undefined,
    };
    expect(getApproverSlotForRow(party, row, chairId)).toBe("first");
  });

  it("lets a Chair and a Vice-Chair complete a row with no Treasurer seated", () => {
    // The case the old slot model could not express at all: one slot
    // demanded the Treasurer and the other demanded Chair-or-VC.
    const chairId = new ObjectId();
    const viceChairId = new ObjectId();
    const party = makeParty({ chairId, viceChairId });
    const afterChair = {
      type: "send" as const,
      proposedBy: chairId,
      treasurerApproval: { characterId: chairId, approvedAt: new Date() },
      leadershipApproval: undefined,
    };
    expect(getApproverSlotForRow(party, afterChair, viceChairId)).toBe("second");
  });

  it("refuses an officer who has already signed the other slot", () => {
    // Two signatures has to mean two people. Nothing else enforces it
    // once the slots stop being tied to separate seats.
    const chairId = new ObjectId();
    const party = makeParty({ chairId, treasurerId: new ObjectId() });
    const row = {
      type: "send" as const,
      proposedBy: chairId,
      treasurerApproval: { characterId: chairId, approvedAt: new Date() },
      leadershipApproval: undefined,
    };
    expect(getApproverSlotForRow(party, row, chairId)).toBeNull();
  });

  it("refuses a second signature to a character holding two seats", () => {
    const both = new ObjectId();
    const party = makeParty({ chairId: both, treasurerId: both });
    const row = {
      type: "send" as const,
      proposedBy: both,
      treasurerApproval: { characterId: both, approvedAt: new Date() },
      leadershipApproval: undefined,
    };
    expect(getApproverSlotForRow(party, row, both)).toBeNull();
  });

  it("request: returns null when caller is the requester (self-approval forbidden)", () => {
    const requesterId = new ObjectId();
    const party = makeParty({ treasurerId: requesterId, chairId: new ObjectId() });
    const row = {
      type: "request" as const,
      proposedBy: requesterId,
      treasurerApproval: undefined,
      leadershipApproval: undefined,
    };
    expect(getApproverSlotForRow(party, row, requesterId)).toBeNull();
  });

  it("returns null for an outsider", () => {
    const party = makeParty({ chairId: new ObjectId(), treasurerId: new ObjectId() });
    const row = {
      type: "send" as const,
      proposedBy: new ObjectId(),
      treasurerApproval: undefined,
      leadershipApproval: undefined,
    };
    expect(getApproverSlotForRow(party, row, new ObjectId())).toBeNull();
  });

  it("returns null when both slots are filled", () => {
    const chairId = new ObjectId();
    const party = makeParty({ chairId, treasurerId: new ObjectId(), viceChairId: new ObjectId() });
    const row = {
      type: "send" as const,
      proposedBy: new ObjectId(),
      treasurerApproval: { characterId: new ObjectId(), approvedAt: new Date() },
      leadershipApproval: { characterId: new ObjectId(), approvedAt: new Date() },
    };
    expect(getApproverSlotForRow(party, row, chairId)).toBeNull();
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
