/**
 * Run a full world bootstrap against an in-memory database.
 *
 * ⚠️ NEVER point this at Atlas. The free tier caps at 500 collections
 * CLUSTER-WIDE, 224 are already resident, and a bootstrapped world is roughly
 * 250 to 330. Tripping the quota blocks writes across the whole cluster,
 * including the testing world the dev server uses. See
 * `reference_atlas_sim_collection_limit`.
 *
 * Callers MUST `vi.mock("@/lib/mongodb")` so that any seeder reaching for
 * `getDb()` instead of taking the `db` argument is contained rather than
 * silently writing to whatever `MONGODB_URI` points at.
 *
 * Kept as a fixture rather than inlined in one test: the earlier spike was
 * deleted after it ran, which made its "34 seconds, 185 collections" figure
 * unreproducible. This is how that number gets re-derived.
 */
import type { Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";

/**
 * The database the current probe is writing to.
 *
 * Some seed-path code reaches for `getDb()` rather than taking the `db`
 * argument - `isLayer1PositionsEnabled` is one - so the caller's
 * `vi.mock("@/lib/mongodb")` factory reads this to hand back the same in-memory
 * instance. Without it those calls escape to whatever `MONGODB_URI` names.
 *
 * Module-level, so it is shared by every probe in one test FILE and by none
 * across files (vitest gives each file its own module registry). Probes within a
 * file must therefore run sequentially - `presetBootstrap.integration.test.ts`
 * builds its worlds one at a time in `beforeAll` for exactly this reason. Two
 * concurrent probes in one file would write into each other's database.
 */
let probeDb: Db | null = null;

export function currentProbeDb(): Db {
  if (!probeDb) throw new Error("No probe database is active; call probeBootstrap first.");
  return probeDb;
}

export interface BootstrapProbeResult {
  db: Db;
  memory: InMemoryDb;
  /** Wall-clock milliseconds for the bootstrap call itself. */
  elapsedMs: number;
  /** Collections that received at least one document. */
  collectionsTouched: string[];
  log: string[];
}

/**
 * Bootstrap a world for `preset` and hand back the database plus some coarse
 * shape information. Throws whatever the bootstrap throws: a probe that
 * swallowed failures would report a healthy world that never built.
 */
export async function probeBootstrap(preset: string): Promise<BootstrapProbeResult> {
  const { bootstrapGameWorld } = await import("@/lib/admin/bootstrapGameWorld");

  const memory = createInMemoryDb();
  const db = memory as unknown as Db;
  probeDb = db;
  const log: string[] = [];

  const started = Date.now();
  await bootstrapGameWorld({ db, preset, log: (msg: string) => log.push(msg) });
  const elapsedMs = Date.now() - started;

  const collectionsTouched = await listNonEmptyCollections(memory);
  return { db, memory, elapsedMs, collectionsTouched, log };
}

/**
 * Collection names holding at least one document.
 *
 * Reads `InMemoryDb.collections` directly rather than `listCollections()`, which
 * the in-memory driver does not implement. Adding a stub for it would have been
 * the wrong fix: nothing in the seed path calls it, so the shim would exist only
 * to serve this probe.
 */
export async function listNonEmptyCollections(memory: InMemoryDb): Promise<string[]> {
  const out: string[] = [];
  for (const name of memory.collections.keys()) {
    const count = await (memory as unknown as Db).collection(name).countDocuments({});
    if (count > 0) out.push(name);
  }
  return out.sort();
}

/** Document count for one country in one collection. */
export async function countFor(db: Db, collection: string, countryId: string): Promise<number> {
  return db.collection(collection).countDocuments({ countryId });
}
