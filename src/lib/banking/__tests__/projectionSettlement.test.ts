import { ObjectId, type Db, type Document } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { settleTransition, recoverProjections } from "../settlementJournal";
import { MONEY_MOVE_COLLECTION } from "../moneyMove";
import { oid, type BankingTransition } from "../rules/boundary";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

type FixtureJournal = {
  status: string;
  projections: {
    applied: boolean;
    receiptProtocol?: string;
    projection: BankingTransition["projections"][number] & { filter: Record<string, unknown> };
  }[];
};
function setup() {
  const memory = createInMemoryDb();
  const id = new ObjectId();
  memory.seed("corporations", [{ _id: id, total: 0, status: "pending" }]);
  const transition: BankingTransition = {
    key: "projection-test",
    kind: "named_loan_origination",
    turn: 10,
    currency: "USD",
    legs: [],
    projections: [
      {
        collection: "corporations",
        filter: { _id: oid(id.toHexString()), status: "pending" },
        update: { $inc: { total: 100 }, $set: { status: "current" } },
        note: "booked value",
      },
    ],
    event: { kind: "loan.originated", command: "bank.loan.originate" },
  };
  return {
    memory,
    db: memory as unknown as Db,
    id,
    transition,
    target: () => memory.collection("corporations").docs[0],
    journal: () => memory.collection(MONEY_MOVE_COLLECTION).docs[0] as FixtureJournal,
  };
}
function interruptAfterWrite(
  f: ReturnType<typeof setup>,
  collection: string,
  predicate: (update: Document) => boolean
) {
  const c = f.memory.collection(collection);
  const original = c.updateOne.bind(c);
  let thrown = false;
  vi.spyOn(c, "updateOne").mockImplementation(async (filter, update, options) => {
    const r = await original(filter, update, options);
    if (!thrown && predicate(update) && r.matchedCount) {
      thrown = true;
      throw new Error("acknowledgement lost");
    }
    return r;
  });
}

describe("protected update projection", () => {
  it("retains original target outcome after mutable filter changes and bounded history expires", async () => {
    const f = setup();
    interruptAfterWrite(f, "corporations", (u) => u.$inc?.total === 100);
    await expect(settleTransition(f.db, f.transition)).rejects.toThrow("acknowledgement lost");
    f.target().settledKeys = Array.from({ length: 200 }, (_, i) => `other-${i}`);
    const result = await recoverProjections(f.db, f.transition.key);
    expect(result.status).toBe("applied");
    expect(result.newlyAppliedProjections).toEqual([]);
    expect(f.target()).toMatchObject({ total: 100, status: "current" });
    expect(f.target().pendingSettlementProjection).toBeUndefined();
  });
  it.each(["journal", "release"])(
    "recovers acknowledgement loss after %s without repeating projection",
    async (point) => {
      const f = setup();
      interruptAfterWrite(f, point === "journal" ? MONEY_MOVE_COLLECTION : "corporations", (u) =>
        point === "journal"
          ? u.$set?.["projections.0.applied"] === true
          : Object.hasOwn(u.$unset ?? {}, "pendingSettlementProjection")
      );
      await expect(settleTransition(f.db, f.transition)).rejects.toThrow("acknowledgement lost");
      f.target().settledKeys = [];
      await recoverProjections(f.db, f.transition.key);
      await recoverProjections(f.db, f.transition.key);
      expect(f.target().total).toBe(100);
      expect(f.target().pendingSettlementProjection).toBeUndefined();
    }
  );
  it("a delayed publisher cannot reapply after another worker acknowledges and releases", async () => {
    const f = setup();
    const c = f.memory.collection("corporations");
    const original = c.updateOne.bind(c);
    let release!: () => void;
    let paused!: () => void;
    const waiting = new Promise<void>((r) => {
      paused = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    vi.spyOn(c, "updateOne").mockImplementation(async (filter, update, options) => {
      if (first && !Array.isArray(update) && (update.$inc as Document | undefined)?.total === 100) {
        first = false;
        paused();
        await gate;
      }
      return original(filter, update, options);
    });
    const delayed = settleTransition(f.db, f.transition);
    await waiting;
    expect((await recoverProjections(f.db, f.transition.key)).status).toBe("applied");
    f.target().settledKeys = [];
    release();
    expect((await delayed).status).toBe("applied");
    expect(f.target().total).toBe(100);
    expect(f.journal().status).toBe("applied");
  });
  it("retains protected outcome if journal acknowledgement fails before its write", async () => {
    const f = setup();
    const c = f.memory.collection(MONEY_MOVE_COLLECTION);
    const original = c.updateOne.bind(c);
    let first = true;
    vi.spyOn(c, "updateOne").mockImplementation(async (filter, update, options) => {
      if (
        first &&
        !Array.isArray(update) &&
        (update.$set as Document | undefined)?.["projections.0.applied"] === true
      ) {
        first = false;
        throw new Error("journal unavailable");
      }
      return original(filter, update, options);
    });
    await expect(settleTransition(f.db, f.transition)).rejects.toThrow("journal unavailable");
    f.target().settledKeys = [];
    expect((await recoverProjections(f.db, f.transition.key)).status).toBe("applied");
    expect(f.target().total).toBe(100);
  });
  it("binds a selector once and replays the original target after its filter changes", async () => {
    const f = setup();
    f.transition.projections[0].filter = { status: "pending" };
    expect((await settleTransition(f.db, f.transition)).status).toBe("applied");
    f.memory.seed("corporations", [{ _id: new ObjectId(), total: 0, status: "pending" }]);
    expect((await settleTransition(f.db, f.transition)).status).toBe("replayed");
    expect(f.memory.collection("corporations").docs.map((row) => row.total)).toEqual([100, 0]);
    expect(f.journal().projections[0].projection.filter._id).toEqual(f.id);
  });
  it("durably refuses an unavailable selector before moving cash", async () => {
    const f = setup();
    f.transition.projections[0].filter = { status: "missing" };
    expect((await settleTransition(f.db, f.transition)).status).toBe("rejected");
    expect(f.journal().status).toBe("rejected");
    f.target().status = "missing";
    expect((await settleTransition(f.db, f.transition)).status).toBe("rejected");
    expect(f.target().total).toBe(0);
    f.transition.projections[0].filter = { _id: oid(f.id.toHexString()) };
    expect((await settleTransition(f.db, f.transition)).status).toBe("rejected");
    expect((await recoverProjections(f.db, f.transition.key)).status).toBe("rejected");
    expect(f.journal().status).toBe("rejected");
  });
  it("does not manufacture a legacy outcome when original proof is missing", async () => {
    const f = setup();
    interruptAfterWrite(f, "corporations", (u) => u.$inc?.total === 100);
    await expect(settleTransition(f.db, f.transition)).rejects.toThrow();
    delete f.journal().projections[0].receiptProtocol;
    delete f.target().pendingSettlementProjection;
    f.target().settledKeys = [];
    expect((await recoverProjections(f.db, f.transition.key)).status).toBe("partial");
    expect((await recoverProjections(f.db, f.transition.key)).status).toBe("partial");
    expect(f.target().total).toBe(100);
  });
  it("recognizes retained legacy proof through the stable target identity", async () => {
    const f = setup();
    interruptAfterWrite(f, "corporations", (u) => u.$inc?.total === 100);
    await expect(settleTransition(f.db, f.transition)).rejects.toThrow();
    delete f.journal().projections[0].receiptProtocol;
    delete f.target().pendingSettlementProjection;
    expect((await recoverProjections(f.db, f.transition.key)).status).toBe("applied");
    expect(f.target().total).toBe(100);
  });
  it("helps a pending owner before a different projection, without retargeting its journal", async () => {
    const f = setup();
    interruptAfterWrite(f, "corporations", (u) => u.$inc?.total === 100);
    await expect(settleTransition(f.db, f.transition)).rejects.toThrow();
    const other = {
      ...f.transition,
      key: "other",
      projections: [
        {
          ...f.transition.projections[0],
          filter: { _id: oid(f.id.toHexString()) },
          update: { $inc: { total: 25 } },
        },
      ],
    };
    expect((await settleTransition(f.db, other)).status).toBe("applied");
    expect(f.target().total).toBe(125);
    expect(f.target().pendingSettlementProjection).toBeUndefined();
    await recoverProjections(f.db, f.transition.key);
    expect(f.target().total).toBe(125);
  });
  it("refuses a corrupted owner receipt before marking an unrelated journal", async () => {
    const f = setup();
    interruptAfterWrite(f, "corporations", (u) => u.$inc?.total === 100);
    await expect(settleTransition(f.db, f.transition)).rejects.toThrow();
    f.journal().projections[0].projection.filter._id = oid(new ObjectId().toHexString());
    const other = {
      ...f.transition,
      key: "other",
      projections: [{ ...f.transition.projections[0], filter: { _id: oid(f.id.toHexString()) } }],
    };
    await expect(settleTransition(f.db, other)).rejects.toThrow("reconciliation");
    expect(f.journal().projections[0].applied).toBe(false);
  });
  it.each(["pendingSettlementProjection", "settlementProjectionRevision", "settledKeys", "_id"])(
    "refuses reserved target update %s before claiming",
    async (field) => {
      const f = setup();
      f.transition.projections[0].update = { $set: { [field]: 1 } };
      expect((await settleTransition(f.db, f.transition)).status).toBe("rejected");
      expect(f.memory.collection(MONEY_MOVE_COLLECTION).docs).toHaveLength(0);
    }
  );
});

describe("protected pipeline projection", () => {
  function pipelineSetup() {
    const f = setup();
    f.target().headroomUnits = 60;
    f.target().revenue = 600;
    f.transition.projections[0] = {
      collection: "corporations",
      filter: { _id: oid(f.id.toHexString()), status: "pending" },
      pipelineUpdate: [
        { $set: { headroomUnits: { $max: [0, { $subtract: ["$headroomUnits", 100] }] } } },
        { $set: { revenue: { $multiply: ["$headroomUnits", 10] }, status: "current" } },
      ],
      note: "clamped capacity pool",
    };
    return f;
  }
  it("replays a clamped write after its guard changes and bounded history expires", async () => {
    const f = pipelineSetup();
    const c = f.memory.collection("corporations");
    const original = c.updateOne.bind(c);
    let first = true;
    vi.spyOn(c, "updateOne").mockImplementation(async (filter, update, options) => {
      const result = await original(filter, update, options);
      if (first && Array.isArray(update) && result.matchedCount) {
        first = false;
        throw new Error("pipeline acknowledgement lost");
      }
      return result;
    });
    await expect(settleTransition(f.db, f.transition)).rejects.toThrow("acknowledgement lost");
    expect(f.target()).toMatchObject({ headroomUnits: 0, revenue: 0, status: "current" });
    f.target().settledKeys = Array.from({ length: 200 }, (_, i) => `replacement-${i}`);
    f.target().headroomUnits = 45;
    f.target().revenue = 450;
    expect((await recoverProjections(f.db, f.transition.key)).status).toBe("applied");
    expect((await settleTransition(f.db, f.transition)).status).toBe("replayed");
    expect(f.target()).toMatchObject({ headroomUnits: 45, revenue: 450 });
    expect(f.target().pendingSettlementProjection).toBeUndefined();
  });
  it("a delayed publisher cannot reuse the original generation after acknowledgement", async () => {
    const f = pipelineSetup();
    const c = f.memory.collection("corporations");
    const original = c.updateOne.bind(c);
    let release!: () => void;
    let paused!: () => void;
    const waiting = new Promise<void>((r) => {
      paused = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    vi.spyOn(c, "updateOne").mockImplementation(async (filter, update, options) => {
      if (first && Array.isArray(update)) {
        first = false;
        paused();
        await gate;
      }
      return original(filter, update, options);
    });
    const delayed = settleTransition(f.db, f.transition);
    await waiting;
    expect((await recoverProjections(f.db, f.transition.key)).status).toBe("applied");
    f.target().headroomUnits = 45;
    f.target().revenue = 450;
    f.target().settledKeys = [];
    release();
    expect((await delayed).status).toBe("applied");
    expect(f.target()).toMatchObject({ headroomUnits: 45, revenue: 450 });
  });
  it.each(["pendingSettlementProjection", "settlementProjectionRevision", "settledKeys", "_id"])(
    "refuses pipeline writes to reserved target field %s before claiming",
    async (field) => {
      const f = pipelineSetup();
      f.transition.projections[0].pipelineUpdate = [{ $set: { [field]: 1 } }];
      expect((await settleTransition(f.db, f.transition)).status).toBe("rejected");
      expect(f.memory.collection(MONEY_MOVE_COLLECTION).docs).toHaveLength(0);
    }
  );
  it("refuses mixed update plans and stages that could remove publication proof", async () => {
    const f = pipelineSetup();
    f.transition.projections[0].update = { $inc: { total: 1 } };
    expect((await settleTransition(f.db, f.transition)).status).toBe("rejected");
    delete f.transition.projections[0].update;
    f.transition.projections[0].pipelineUpdate = [{ $replaceRoot: { newRoot: {} } }];
    expect((await settleTransition(f.db, f.transition)).status).toBe("rejected");
    expect(f.memory.collection(MONEY_MOVE_COLLECTION).docs).toHaveLength(0);
  });
});
