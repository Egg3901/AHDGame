/**
 * #912 — seed Nigeria's national legislation types into a live world.
 *
 * The 55 `countryScope:"ng"` entries already ship in the reference array
 * (src/lib/seeds/reference/legislationTypes.ts) but were never seeded to the
 * prod world (only us/uk/jp/de/ie/cn are present), so NG's Propose-Legislation
 * provision picker had no NG laws to show. This upserts ONLY the NG entries
 * (replaceOne by _id, upsert) — additive, no prune, no effect on other scopes.
 *
 *   cd .
 *   node_modules/.bin/tsx ./scripts/seed-ng-legislation.ts          # dry run
 *   node_modules/.bin/tsx ./scripts/seed-ng-legislation.ts --apply  # write
 */
import path from "path";
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import type { LegislationType } from "@/lib/db/types";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const directUri = (u: string) =>
  u.includes("directConnection=") ? u : `${u}&directConnection=true`;

async function main() {
  const apply = process.argv.includes("--apply");
  const ng = legislationTypes.filter((t) => (t as { countryScope?: string }).countryScope === "ng");
  console.log(`Reference NG legislation types: ${ng.length}`);
  if (ng.length === 0) throw new Error("No countryScope:'ng' entries in the reference — aborting.");

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(directUri(uri));
  await client.connect();
  const col = client.db().collection<LegislationType>("legislationTypes");

  const before = await col.countDocuments({ countryScope: "ng" });
  console.log(`NG docs currently in DB: ${before}`);
  console.log("Sample of entries to upsert:");
  for (const t of ng.slice(0, 6))
    console.log(
      `  ${t._id}  ${(t as { name?: string }).name} [${(t as { policyDomain?: string }).policyDomain}]`
    );

  if (!apply) {
    console.log(
      `\nDRY RUN — would upsert ${ng.length} NG entries (no prune). Re-run with --apply.`
    );
    await client.close();
    return;
  }

  const res = await col.bulkWrite(
    ng.map((t) => ({ replaceOne: { filter: { _id: t._id }, replacement: t, upsert: true } }))
  );
  const after = await col.countDocuments({ countryScope: "ng" });
  console.log(
    `\nAPPLIED: upserts=${res.upsertedCount} modified=${res.modifiedCount}. NG docs now: ${after}`
  );
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
