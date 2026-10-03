import { describe, expect, it, vi } from "vitest";
import { ObjectId, type AnyBulkWriteOperation, type Collection, type Document } from "mongodb";
import { partitionBulkOpsById, partitionedBulkWrite } from "./partitionedBulkWrite";

type Op = AnyBulkWriteOperation<Document>;

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function idOf(op: Op): string {
  const body = "updateOne" in op ? op.updateOne : "deleteOne" in op ? op.deleteOne : null;
  return String((body!.filter as { _id: unknown })._id);
}

/** Random ops over a pool of ids, with repeats so one document gets several ops. */
function randomOps(seed: number): Op[] {
  const random = rng(seed);
  const ids = Array.from({ length: 1 + Math.floor(random() * 200) }, () => new ObjectId());
  return Array.from({ length: Math.floor(random() * 600) }, (_, sequence) => {
    const _id = ids[Math.floor(random() * ids.length)]!;
    return random() < 0.1
      ? { deleteOne: { filter: { _id } } }
      : { updateOne: { filter: { _id }, update: { $set: { sequence } } } };
  });
}

/** Applies ops in order to an in-memory store, keeping per-document history. */
function apply(ops: readonly Op[], store: Map<string, number[]>): void {
  for (const op of ops) {
    const id = idOf(op);
    const history = store.get(id) ?? [];
    history.push(
      "updateOne" in op ? (op.updateOne.update as { $set: { sequence: number } }).$set.sequence : -1
    );
    store.set(id, history);
  }
}

describe("partitionBulkOpsById", () => {
  it("keeps every document's ops in one partition, in their original order", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const ops = randomOps(seed);
      const groups = partitionBulkOpsById(ops, 4)!;
      expect(groups).not.toBeNull();
      expect(groups.length).toBeLessThanOrEqual(4);
      expect(groups.flat()).toHaveLength(ops.length);

      const groupOfId = new Map<string, number>();
      groups.forEach((group, groupIndex) => {
        for (const op of group) {
          const id = idOf(op);
          expect(groupOfId.get(id) ?? groupIndex).toBe(groupIndex);
          groupOfId.set(id, groupIndex);
        }
      });

      // Any interleaving of the partitions leaves every document with the same
      // op history as the single ordered write.
      const expected = new Map<string, number[]>();
      apply(ops, expected);
      const actual = new Map<string, number[]>();
      for (const group of [...groups].reverse()) apply(group, actual);
      expect(new Map([...actual].sort())).toEqual(new Map([...expected].sort()));
    }
  });

  it("refuses to split ops that are not keyed by a plain _id", () => {
    const _id = new ObjectId();
    const keyed: Op = { updateOne: { filter: { _id }, update: { $set: { a: 1 } } } };
    expect(partitionBulkOpsById([keyed, { insertOne: { document: { a: 1 } } }], 4)).toBeNull();
    expect(
      partitionBulkOpsById([keyed, { updateOne: { filter: { status: "x" }, update: {} } }], 4)
    ).toBeNull();
    expect(
      partitionBulkOpsById([keyed, { updateOne: { filter: { _id, status: "x" }, update: {} } }], 4)
    ).toBeNull();
    expect(
      partitionBulkOpsById(
        [keyed, { updateOne: { filter: { _id: { $in: [_id] } }, update: {} } }],
        4
      )
    ).toBeNull();
    expect(
      partitionBulkOpsById([keyed, { updateMany: { filter: { _id }, update: {} } }], 4)
    ).toBeNull();
  });
});

describe("partitionedBulkWrite", () => {
  const manyOps = (count: number): Op[] =>
    Array.from({ length: count }, (_, sequence) => ({
      updateOne: { filter: { _id: new ObjectId() }, update: { $set: { sequence } } },
    }));

  it("sends small writes as the original single bulkWrite", async () => {
    const bulkWrite = vi.fn().mockResolvedValue({});
    const ops = manyOps(10);
    await partitionedBulkWrite({ bulkWrite } as unknown as Collection<Document>, ops);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(bulkWrite).toHaveBeenCalledWith(ops);
  });

  it("splits large writes and waits for every partition before rethrowing", async () => {
    const settled: number[] = [];
    let call = 0;
    const bulkWrite = vi.fn(async (group: Op[]) => {
      const mine = call++;
      await new Promise((resolve) => setTimeout(resolve, mine === 0 ? 0 : 20));
      settled.push(group.length);
      if (mine === 0) throw new Error("boom");
      return {};
    });
    const ops = manyOps(5000);
    await expect(
      partitionedBulkWrite({ bulkWrite } as unknown as Collection<Document>, ops)
    ).rejects.toThrow("boom");
    expect(bulkWrite).toHaveBeenCalledTimes(4);
    expect(settled).toHaveLength(4);
    expect(settled.reduce((sum, count) => sum + count, 0)).toBe(5000);
  });
});
