/**
 * Send the Federal Republic's catalogue entries back to the dissolved shell.
 *
 * The reversal moved every `countryScope: "de"` type onto DD, so the unified
 * state's law list offers both statute books. Scoped back to "de" they leave the
 * GDR's catalogue while staying resolvable by `_id` — which matters, because 33
 * bills and the FRG's own election history still name them. The seats were
 * handled the same way and for the same reason: a row is looked up by id, listed
 * by country.
 *
 * ⚠️ NOT THE ONES STILL IN FORCE. Sixteen FRG laws survived the dedupe because
 * the GDR has no programme covering them — rail transport, asylum and
 * immigration, agriculture, foreign aid, the police and justice acts, public
 * broadcasting, and the Majoritarian Reform Act a player passed. Scoping their
 * types away would leave the unified state enforcing a law it cannot see, amend
 * or repeal. Those types stay on DD; only the unused ones go home.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const TO = "DD";

const isWest = (id: string) => id.startsWith("de_") || id.startsWith("de.");

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const types = await db
    .collection("legislationTypes")
    .find({ countryScope: "dd" } as never)
    .project({ _id: 1, name: 1 })
    .toArray();
  const west = types.filter((t) => isWest(String(t._id)));
  console.log(`legislationTypes scoped "dd": ${types.length}  (FRG entries ${west.length})`);

  // Types still carrying a live law under the unified state.
  const inForce = new Set(
    (
      await db
        .collection("enactedLaws")
        .find({ countryId: TO } as never)
        .project({ legislationTypeId: 1 })
        .toArray()
    ).map((l) => String(l.legislationTypeId))
  );

  const move = west.filter((t) => !inForce.has(String(t._id)));
  const stay = west.filter((t) => inForce.has(String(t._id)));

  console.log(`\nSTAY on DD — still in force (${stay.length}):`);
  for (const t of stay)
    console.log(`  ${String(t._id).padEnd(32)} ${String(t.name ?? "").slice(0, 44)}`);

  console.log(`\nMOVE to DE — no law in force (${move.length}):`);
  for (const t of move.slice(0, 12))
    console.log(`  ${String(t._id).padEnd(32)} ${String(t.name ?? "").slice(0, 44)}`);
  if (move.length > 12) console.log(`  … and ${move.length - 12} more`);

  if (APPLY && move.length > 0) {
    const res = await db.collection("legislationTypes").updateMany(
      { _id: { $in: move.map((t) => t._id) } } as never,
      {
        $set: { countryScope: "de" },
      } as never
    );
    console.log(`\nAPPLIED — ${res.modifiedCount} type(s) scoped back to the dissolved shell.`);
  } else if (!APPLY) {
    console.log("\nDRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
