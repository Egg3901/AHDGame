/**
 * Migration: Indexes for `siteTrafficPageviews` (first-party admin traffic analytics).
 *
 * - TTL on recordedAt (~180d) caps collection growth.
 * - Compound index supports admin range queries and top-path aggregations.
 */

import { connectDb, closeDb } from "../../utils/db";

async function migrate() {
  console.log("Adding siteTrafficPageviews indexes...");
  const db = await connectDb();
  const coll = db.collection("siteTrafficPageviews");

  const results: string[] = [];

  async function ensure(
    keys: Record<string, 1 | -1>,
    name: string,
    opts?: { expireAfterSeconds?: number }
  ) {
    try {
      await coll.createIndex(keys, { name, ...opts });
      results.push(`✓ siteTrafficPageviews.${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        results.push(`= siteTrafficPageviews.${name} (already exists)`);
      } else {
        results.push(`✗ siteTrafficPageviews.${name}: ${msg}`);
      }
    }
  }

  await ensure({ recordedAt: 1 }, "stpv_recordedAt_ttl", { expireAfterSeconds: 15552000 });
  await ensure({ recordedAt: -1, path: 1 }, "stpv_recordedAt_path");

  for (const line of results) console.log(line);
  await closeDb();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
