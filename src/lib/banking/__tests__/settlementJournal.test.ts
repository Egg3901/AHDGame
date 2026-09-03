/**
 * The Settlement Journal contract: a transition applies exactly once, a
 * replay moves nothing and finishes what a crash left, a guarded debit that
 * cannot cover itself stops the whole transition before any projection, and
 * two concurrent claims on one key produce one application.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import {
  listUnfinishedProjections,
  recoverProjections,
  reviveObjectIds,
  settleTransition,
} from "@/lib/banking/settlementJournal";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const BANK = new ObjectId();
const BORROWER = new ObjectId();
const LOAN = new ObjectId();

function world(cash = 1_000_000): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("corporations", [
    {
      _id: BANK,
      liquidCapital: 0,
      bankCharter: { status: "active", currency: "USD", cashReserves: cash, totalLoans: 0 },
    },
    { _id: BORROWER, liquidCapital: 10_000 },
  ]);
  return db;
}

function loanTransition(
  principal = 100_000,
  key = `named_loan_origination:${BANK}:${LOAN}`
): BankingTransition {
  return {
    key,
    kind: "named_loan_origination",
    turn: 50,
    currency: "USD",
    legs: [
      {
        kind: "debit",
        amount: principal,
        collection: "corporations",
        filter: { _id: oid(BANK.toHexString()), "bankCharter.status": "active" },
        path: "bankCharter.cashReserves",
        note: "bank funds the loan",
      },
      {
        kind: "credit",
        amount: principal,
        collection: "corporations",
        filter: { _id: oid(BORROWER.toHexString()) },
        path: "liquidCapital",
        note: "borrower receives proceeds",
      },
    ],
    projections: [
      {
        collection: "bankLoans",
        insert: {
          _id: oid(LOAN.toHexString()),
          bankCorporationId: oid(BANK.toHexString()),
          principal,
          outstanding: principal,
          status: "current",
        },
        note: "loan record",
      },
      {
        collection: "corporations",
        filter: { _id: oid(BANK.toHexString()) },
        update: { $inc: { "bankCharter.totalLoans": principal } },
        note: "loan book total",
      },
    ],
    event: { kind: "loan.originated", command: "bank.loan.originate" },
  };
}

function corp(db: InMemoryDb, id: ObjectId) {
  return db.collection("corporations").docs.find((d) => (d._id as ObjectId).equals(id)) as {
    liquidCapital: number;
    bankCharter: { cashReserves: number; totalLoans: number };
  };
}

describe("reviveObjectIds", () => {
  it("turns oid markers into ObjectIds at any depth and leaves the rest alone", () => {
    const revived = reviveObjectIds({
      _id: oid(BANK.toHexString()),
      nested: { ids: [oid(LOAN.toHexString())], when: new Date(0), n: 1, s: "x" },
    }) as unknown as {
      _id: ObjectId;
      nested: { ids: ObjectId[]; when: Date; n: number; s: string };
    };
    expect(revived._id).toBeInstanceOf(ObjectId);
    expect(revived._id.equals(BANK)).toBe(true);
    expect(revived.nested.ids[0].equals(LOAN)).toBe(true);
    expect(revived.nested.when).toBeInstanceOf(Date);
    expect(revived.nested.n).toBe(1);
  });
});

describe("settleTransition", () => {
  let db: InMemoryDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = world();
  });

  it("applies legs then projections, exactly once", async () => {
    const result = await settleTransition(db as unknown as Db, loanTransition());
    expect(result).toMatchObject({
      status: "applied",
      appliedLegs: [0, 1],
      appliedProjections: [0, 1],
    });
    expect(corp(db, BANK).bankCharter.cashReserves).toBe(900_000);
    expect(corp(db, BANK).bankCharter.totalLoans).toBe(100_000);
    expect(corp(db, BORROWER).liquidCapital).toBe(110_000);
    expect(db.collection("bankLoans").docs).toHaveLength(1);
    const record = db.collection(MONEY_MOVE_COLLECTION).docs[0] as {
      status: string;
      projections: { applied: boolean }[];
    };
    expect(record.status).toBe("applied");
    expect(record.projections.map((p) => p.applied)).toEqual([true, true]);
  });

  it("replays a duplicate request without moving money or double-counting", async () => {
    await settleTransition(db as unknown as Db, loanTransition());
    const again = await settleTransition(db as unknown as Db, loanTransition());
    expect(again.status).toBe("replayed");
    expect(again.appliedLegs).toEqual([]);
    expect(again.appliedProjections).toEqual([0, 1]);
    expect(corp(db, BANK).bankCharter.cashReserves).toBe(900_000);
    expect(corp(db, BANK).bankCharter.totalLoans).toBe(100_000);
    expect(corp(db, BORROWER).liquidCapital).toBe(110_000);
    expect(db.collection("bankLoans").docs).toHaveLength(1);
  });

  it("stops before any projection when a guarded debit cannot cover itself", async () => {
    const result = await settleTransition(db as unknown as Db, loanTransition(5_000_000));
    // Nothing landed, so nothing is left to repair: the key is claimed (the
    // same attempt cannot be made twice) but the record is rejected, not a
    // hole for the recovery worker.
    expect(result.status).toBe("rejected");
    expect(result.appliedLegs).toEqual([]);
    expect(result.appliedProjections).toEqual([]);
    expect(corp(db, BANK).bankCharter.cashReserves).toBe(1_000_000);
    expect(corp(db, BORROWER).liquidCapital).toBe(10_000);
    expect(db.collection("bankLoans").docs).toHaveLength(0);
    expect(db.collection("bankingTelemetry").docs[0]).toMatchObject({
      counters: { rejectedSettlements: 1 },
    });
    expect(db.collection(MONEY_MOVE_COLLECTION).docs[0]).toMatchObject({ status: "rejected" });
  });

  it("rejects an unbalanced transition before claiming its key", async () => {
    const broken = loanTransition();
    broken.legs[1].amount = 99_999;
    const result = await settleTransition(db as unknown as Db, broken);
    expect(result.status).toBe("rejected");
    expect(result.error).toMatch(/net to/);
    expect(db.collection(MONEY_MOVE_COLLECTION).docs).toHaveLength(0);
    // The corrected transition with the same key still applies.
    const fixed = await settleTransition(db as unknown as Db, loanTransition());
    expect(fixed.status).toBe("applied");
  });

  it("rejects legs whose currency context does not match the transition", async () => {
    const mixed = loanTransition();
    mixed.legs[0].filter = { ...mixed.legs[0].filter, "bankCharter.currency": "GBP" };
    const result = await settleTransition(db as unknown as Db, mixed);
    // The guard on the debit does not match a USD charter, so nothing moves.
    expect(result.status).toBe("rejected");
    expect(corp(db, BANK).bankCharter.cashReserves).toBe(1_000_000);
    expect(db.collection("bankLoans").docs).toHaveLength(0);
  });

  it("lets exactly one of two concurrent claims on one key apply", async () => {
    const [a, b] = await Promise.all([
      settleTransition(db as unknown as Db, loanTransition()),
      settleTransition(db as unknown as Db, loanTransition()),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["applied", "replayed"]);
    expect(corp(db, BANK).bankCharter.cashReserves).toBe(900_000);
    expect(corp(db, BANK).bankCharter.totalLoans).toBe(100_000);
    expect(db.collection("bankLoans").docs).toHaveLength(1);
  });

  it("settles a projection-only transition (a pending loan request) under a claimed key", async () => {
    const pending = loanTransition();
    pending.key = `named_loan_request:${BANK}:${LOAN}`;
    pending.legs = [];
    pending.projections = [pending.projections[0]];
    const first = await settleTransition(db as unknown as Db, pending);
    expect(first.status).toBe("applied");
    expect(db.collection("bankLoans").docs).toHaveLength(1);
    const second = await settleTransition(db as unknown as Db, pending);
    expect(second.status).toBe("replayed");
    expect(db.collection("bankLoans").docs).toHaveLength(1);
  });

  it("records a projection that failed and recovers it later without moving money", async () => {
    // Break the second projection's target so it cannot match, then repair.
    const t = loanTransition();
    t.projections[1].filter = { _id: oid(new ObjectId().toHexString()) };
    const first = await settleTransition(db as unknown as Db, t);
    expect(first.status).toBe("partial");
    expect(first.appliedLegs).toEqual([0, 1]);
    expect(first.appliedProjections).toEqual([0]);
    expect(corp(db, BANK).bankCharter.totalLoans).toBe(0);

    const queue = await listUnfinishedProjections(db as unknown as Db);
    expect(queue).toEqual([{ key: t.key, kind: t.kind, turn: 50, pending: 1 }]);

    // Operator fixes the projection in the journal (here: the recorded copy)
    // and the recovery pass finishes it. Cash does not move again.
    const record = db.collection(MONEY_MOVE_COLLECTION).docs[0] as {
      projections: { projection: { filter?: Record<string, unknown> } }[];
    };
    record.projections[1].projection.filter = { _id: BANK };
    const recovered = await recoverProjections(db as unknown as Db, t.key);
    expect(recovered.status).toBe("applied");
    expect(recovered.appliedProjections).toEqual([0, 1]);
    expect(corp(db, BANK).bankCharter.totalLoans).toBe(100_000);
    expect(corp(db, BANK).bankCharter.cashReserves).toBe(900_000);
    expect(await listUnfinishedProjections(db as unknown as Db)).toEqual([]);
  });
});
