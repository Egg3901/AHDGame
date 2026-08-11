import type { ObjectId } from "mongodb";

/**
 * Per-corporation in-process serialization for money-mutating operations.
 *
 * Why: cash mutations that run OUTSIDE turn processing (bond issuance, hostile
 * takeover, share trades, sector buys) are multi-step and are NOT wrapped in a
 * DB transaction — prod Mongo is single-node rs0 with no multi-doc txns. When
 * two large cash operations hit the SAME corp document within the same instant
 * (e.g. a bond issuance and a hostile takeover 18s apart, issue #2942/#2949),
 * an interleaving read-then-write can clobber one of the writes and silently
 * lose money. Serializing per-corp so same-corp money ops apply one at a time
 * removes that interleave.
 *
 * Scope/caveat: this is an IN-PROCESS mutex (a per-key promise chain). It fully
 * serializes concurrent ops within a single Node process. It does NOT serialize
 * across horizontally-scaled instances — two ops on the same corp landing on
 * different instances can still race. The durable cross-instance fix is a
 * replica set with multi-doc transactions (or a DB advisory lock); tracked in
 * issue #2949. This helper is the low-risk mitigation that closes the common
 * case (a single user's rapid same-corp actions) with no infra change.
 *
 * Deadlock safety: acquire at most ONE corp lock per operation and never nest a
 * second acquisition inside `fn`. The wrapped handlers here lock only the corp
 * whose balance they mutate as the entry point, so there is no lock-ordering
 * cycle.
 */

// key = corp id string → tail of the pending-operation chain for that corp.
const chains = new Map<string, Promise<void>>();

/**
 * Run `fn` with exclusive access to `corpId`'s money-mutation slot. Operations
 * for the same corp run strictly in call order; different corps run in parallel.
 * `fn`'s resolution/rejection is returned to the caller unchanged; a rejection
 * does not poison the queue (the next waiter still runs).
 */
export async function withCorpLock<T>(corpId: ObjectId | string, fn: () => Promise<T>): Promise<T> {
  const key = corpId.toString();
  const prior = chains.get(key) ?? Promise.resolve();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  // The next op for this corp waits on our gate (which resolves when we finish,
  // regardless of outcome). This `mine` is the new tail of the chain.
  const mine = prior.then(() => gate);
  chains.set(key, mine);

  // Wait for the prior holder to finish; swallow its error so ordering holds.
  await prior.catch(() => {});

  try {
    return await fn();
  } finally {
    release();
    // If nobody chained after us, we're still the tail — drop the key so the
    // map doesn't retain resolved promises forever.
    if (chains.get(key) === mine) chains.delete(key);
  }
}
