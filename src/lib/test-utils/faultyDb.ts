/**
 * An in-memory store that crashes on cue.
 *
 * Crash-injection tests need to stop a flow at an exact write: after the
 * journal claim but before the first leg, between two legs, after the money
 * but before a projection. This wraps the in-memory store and throws on the
 * Nth matching write, then behaves normally so the retry can be observed.
 */

import type { Db } from "mongodb";
import type { InMemoryDb } from "@/lib/test-utils/inMemoryDb";

export type WriteOp = "insertOne" | "updateOne" | "updateMany" | "findOneAndUpdate" | "bulkWrite";

export interface FaultPlan {
  /** Only writes to this collection count. Omit to count every collection. */
  collection?: string;
  op?: WriteOp;
  /** Throw on the Nth matching write (1-based). */
  onCall: number;
  /**
   * Throw AFTER the write has landed rather than before, to model a crash
   * between the write returning and the caller's next step.
   */
  afterWrite?: boolean;
}

export class InjectedCrash extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InjectedCrash";
  }
}

const WRITE_OPS: WriteOp[] = [
  "insertOne",
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "bulkWrite",
];

export interface FaultyDb {
  db: Db;
  /** Writes seen so far, in order, for assertions and for choosing `onCall`. */
  log: { collection: string; op: WriteOp }[];
  /** Disarm the fault so the retry runs clean. */
  disarm(): void;
}

export function withInjectedCrash(memory: InMemoryDb, plan: FaultPlan): FaultyDb {
  let armed = true;
  let matches = 0;
  const log: { collection: string; op: WriteOp }[] = [];

  const proxyCollection = (name: string) => {
    const target = memory.collection(name);
    return new Proxy(target, {
      get(obj, prop, receiver) {
        const value = Reflect.get(obj, prop, receiver);
        if (typeof prop !== "string" || !WRITE_OPS.includes(prop as WriteOp)) {
          return typeof value === "function" ? value.bind(obj) : value;
        }
        const op = prop as WriteOp;
        return async (...args: unknown[]) => {
          log.push({ collection: name, op });
          const counts =
            armed &&
            (plan.collection === undefined || plan.collection === name) &&
            (plan.op === undefined || plan.op === op);
          if (counts) matches += 1;
          const fire = counts && matches === plan.onCall;
          if (fire && !plan.afterWrite) {
            armed = false;
            throw new InjectedCrash(`crash before ${name}.${op} #${matches}`);
          }
          const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(obj, args);
          if (fire && plan.afterWrite) {
            armed = false;
            throw new InjectedCrash(`crash after ${name}.${op} #${matches}`);
          }
          return result;
        };
      },
    });
  };

  const db = {
    collection: (name: string) => proxyCollection(name),
  } as unknown as Db;

  return {
    db,
    log,
    disarm() {
      armed = false;
    },
  };
}
