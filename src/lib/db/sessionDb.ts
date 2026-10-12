import type { ClientSession, Db } from "mongodb";
import { runRequiredTransaction, RequiredTransactionCleanupError } from "./runRequiredTransaction";

interface Scope {
  originalDb: Db;
  session: ClientSession;
  effects: Array<() => Promise<unknown>>;
}
const scopes = new WeakMap<Db, Scope>();
const optionIndex: Record<string, number> = {
  find: 1,
  findOne: 1,
  aggregate: 1,
  distinct: 2,
  countDocuments: 1,
  insertOne: 1,
  insertMany: 1,
  updateOne: 2,
  updateMany: 2,
  replaceOne: 2,
  deleteOne: 1,
  deleteMany: 1,
  bulkWrite: 1,
  findOneAndUpdate: 2,
  findOneAndDelete: 1,
  findOneAndReplace: 2,
};
export function unboundDb(db: Db): Db {
  return scopes.get(db)?.originalDb ?? db;
}
export function boundSession(db: Db): ClientSession | undefined {
  return scopes.get(db)?.session;
}

/** Bind an existing domain shell to one session, including lazy cursor reads.
 * This is session plumbing, not a second collection/repository abstraction.
 * Serial scheduling also covers legacy Promise.all reads inside a transaction.
 */
function bindDb(db: Db, scope: Scope): Db {
  let tail: Promise<unknown> = Promise.resolve();
  let failed = false;
  let failure: unknown;
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(() => {
      if (failed) throw failure;
      return work();
    });
    tail = next.catch((error) => {
      failed = true;
      failure = error;
    });
    return next;
  };
  const bound = new Proxy(db, {
    get(target, key) {
      if (key !== "collection") {
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (name: string) =>
        new Proxy(target.collection(name), {
          get(collection, method) {
            const value = Reflect.get(collection, method);
            const index = optionIndex[String(method)];
            if (index === undefined || typeof value !== "function")
              return typeof value === "function" ? value.bind(collection) : value;
            return (...args: unknown[]) => {
              args[index] = { ...((args[index] as object) ?? {}), session: scope.session };
              if (method !== "find" && method !== "aggregate")
                return serial(() => value.apply(collection, args));
              const cursor = value.apply(collection, args);
              const wrapped = new Proxy(cursor, {
                get(c, prop) {
                  const fn = Reflect.get(c, prop);
                  if (typeof fn !== "function") return fn;
                  if (["toArray", "next", "hasNext", "close"].includes(String(prop)))
                    return (...a: unknown[]) => serial(() => fn.apply(c, a));
                  return (...a: unknown[]) => {
                    const result = fn.apply(c, a);
                    return result === c ? wrapped : result;
                  };
                },
              });
              return wrapped;
            };
          },
        });
    },
  });
  scopes.set(bound, scope);
  return bound;
}

/** External notifications and getDb-owned election spawners run only after commit. */
export async function afterCommit(db: Db, effect: () => Promise<unknown>): Promise<void> {
  const scope = scopes.get(db);
  if (scope) scope.effects.push(effect);
  else await effect();
}

/** Never fall back to unsafe multi-document writes on unsupported deployments. */
export async function withSessionDb<T>(
  db: Db,
  work: (transactionDb: Db) => Promise<T>
): Promise<T> {
  if (scopes.has(db)) return work(db);
  if (!db.client)
    throw new Error("Atomic referendum operations require the supplied Mongo client.");
  let effects: Scope["effects"] = [];
  let result: T;
  try {
    result = await runRequiredTransaction(
      async (session) => {
        const scope: Scope = { session, effects: [], originalDb: db };
        effects = scope.effects;
        return work(bindDb(db, scope));
      },
      { client: db.client, timeoutMS: 60_000, maxCommitTimeMS: 10_000 }
    );
  } catch (error) {
    if (!(error instanceof RequiredTransactionCleanupError)) throw error;
    result = error.committedResult as T;
  }
  for (const effect of effects) await effect();
  return result;
}
