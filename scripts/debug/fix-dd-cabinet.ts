/**
 * Give the GDR's ministers their own posts back.
 *
 * The cabinet was never cleared — the six ministers are all still there, and they
 * are the right people. What moved is the KEY: the original merge carried them
 * through `dissolvingCabinetRemap`, which rewrote each `positionId` into the
 * Federal Republic's vocabulary (`minister_of_defence` -> `defense_minister`).
 * The unified state is the GDR again, so its cabinet page looks up its own
 * positions, finds none of them filled, and reads as empty.
 *
 * NOT GUESSWORK: every row carries `mergedFrom.positionId`, which is the post it
 * held before the remap. That field is the reason this is recoverable, so it is
 * deliberately left in place rather than tidied away.
 *
 * IT ALSO RECONNECTS THE ESTATES. `cabinetEstates` under DD is keyed to the GDR
 * ids — 18 rows on `minister_of_health`, 18 on `minister_of_culture`, 16 on
 * `minister_of_machine_building` — while `cabinetMembers` was keyed to the FRG's,
 * so a minister and their own ministry's estate could not see each other.
 *
 * `cabinetPosition` ON THE CHARACTER IS LEFT ALONE where it is already null: it
 * reads null for every minister in RU, CN and the US, so null is the convention
 * and not damage. Only the one row still carrying a Federal Republic id is
 * corrected, and its office structure is not otherwise touched.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient, ObjectId } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const TO = "DD";

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const rows = await db.collection("cabinetMembers").find({ countryId: TO }).toArray();
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${rows.length} cabinet row(s) under ${TO}\n`);

  const missing = rows.filter(
    (r) => !(r.mergedFrom as { positionId?: string } | undefined)?.positionId
  );
  if (missing.length > 0) {
    for (const m of missing)
      console.log(`  !! ${m.positionId}: no mergedFrom.positionId to restore from`);
    throw new Error("refusing to guess a position id");
  }

  // Estates already keyed to the GDR vocabulary, to show the reconnection.
  const estateCounts = new Map<string, number>();
  for (const e of await db
    .collection("cabinetEstates")
    .find({ countryId: TO })
    .project({ positionId: 1 })
    .toArray()) {
    estateCounts.set(String(e.positionId), (estateCounts.get(String(e.positionId)) ?? 0) + 1);
  }

  for (const r of rows) {
    const want = String((r.mergedFrom as { positionId?: string }).positionId);
    const estates = estateCounts.get(want) ?? 0;
    console.log(
      `  ${String(r.positionId).padEnd(20)} -> ${want.padEnd(30)} ${String(r.characterName ?? "").padEnd(20)}` +
        (estates ? `  (${estates} estate row(s) reconnect)` : "")
    );
    if (APPLY) {
      await db
        .collection("cabinetMembers")
        .updateOne({ _id: r._id }, { $set: { positionId: want, updatedAt: new Date() } });

      // The stored pointers on the holder, where they still name the FRG post.
      if (r.characterId) {
        const cid = new ObjectId(String(r.characterId));
        await db.collection("characters").updateOne(
          { _id: cid, cabinetPosition: r.positionId } as never,
          {
            $set: { cabinetPosition: want, updatedAt: new Date() },
          } as never
        );
        await db.collection("characters").updateOne(
          { _id: cid, "currentOffice.positionId": r.positionId } as never,
          {
            $set: { "currentOffice.positionId": want, updatedAt: new Date() },
          } as never
        );
      }
    }
  }

  console.log(APPLY ? "\nAPPLIED" : "\nDRY RUN — nothing written.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
