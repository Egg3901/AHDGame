/**
 * Create the GDR's seat rows, which have not existed since the first merge.
 *
 * `evacuateRegionPolitics` DELETES the source country's seats as each region
 * transfers, on the stated understanding that "the target's election engine
 * re-spawns the region's own races next turn". It respawns the RACES; nothing
 * respawns the SEATS. So DD's seat rows went at turn 545 and never came back:
 * 48 active elections and 66 of the GDR's own resolved elections all name a
 * `DD-…` seat that does not exist.
 *
 * THE BASIS IS THE REGION FIELDS, NOT THE SURVIVING FRG ROWS. Copying
 * `DE-bundestag-*` was the obvious shortcut and is wrong: those rows sum to 299
 * and were never rescaled when the eastern Laender arrived, while
 * `states.houseDistricts` sums to 693 — exactly the `totalSeats` the government
 * formation is currently running. `landAssembly` takes `stateSenateSeats`, which
 * is what DD's own config says its Landtage are sized from. The two bases
 * disagree on precisely the six eastern Laender.
 *
 * The Federal Republic's seat rows are moved back to DE rather than deleted: 83
 * of its own pre-merge elections still name them, and a seat is resolved by `_id`
 * regardless of `countryId`, so history keeps working while the GDR's seat list
 * stops showing a Bundestag.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const TO = "DD";

/** office -> [display label, short label, which region field sizes it] */
const OFFICES: Array<[string, string, string, "houseDistricts" | "stateSenateSeats" | null]> = [
  // The People's Chamber, sized like any lower house: one delegation per Land.
  ["volkskammerDeputy", "Volkskammer", "Vk", "houseDistricts"],
  // The Landtage, sized from `stateSenateSeats` per DD's own config comment.
  ["landAssembly", "Landtag", "Ltg", "stateSenateSeats"],
  // The Land First Secretary is an executive: a seat row with no seat count,
  // exactly as a US governor's row carries none.
  ["governor", "Land First Secretary", "Gov", null],
];

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — turn ${gs?.currentTurn} processing=${gs?.processingStartedAt ?? "-"}\n`
  );

  const states = await db
    .collection("states")
    .find({ countryId: TO })
    .project({ _id: 1, name: 1, houseDistricts: 1, stateSenateSeats: 1 })
    .sort({ _id: 1 })
    .toArray();
  console.log(`regions: ${states.length}`);

  const now = new Date();
  let created = 0;
  let skipped = 0;
  const totals = new Map<string, number>();

  for (const [electionType, label, shortLabel, basis] of OFFICES) {
    for (const s of states) {
      const _id = `${TO}-${electionType}-${String(s._id)}`;
      const existing = await db.collection("seats").findOne({ _id: _id as never });
      if (existing) {
        skipped++;
        continue;
      }
      const doc: Record<string, unknown> = {
        _id,
        countryId: TO,
        electionType,
        state: String(s._id),
        displayName: `${s.name} ${label}`,
        shortName: `${String(s._id)} ${shortLabel}`,
        createdAt: now,
        updatedAt: now,
      };
      if (basis) {
        const n = Number(s[basis] ?? 0);
        doc.totalSeats = n;
        totals.set(electionType, (totals.get(electionType) ?? 0) + n);
      }
      created++;
      if (APPLY) await db.collection("seats").insertOne(doc as never);
    }
  }
  console.log(`seat rows to create: ${created}  (already present: ${skipped})`);
  for (const [t, n] of totals) console.log(`  ${t}: totalSeats sum = ${n}`);

  // The Federal Republic's rows go home to the dissolved shell.
  const frg = await db
    .collection("seats")
    .countDocuments({ countryId: TO, _id: { $regex: "^DE-" } } as never);
  console.log(`\nFRG seat rows to re-scope to DE: ${frg}`);
  if (APPLY && frg > 0) {
    await db.collection("seats").updateMany(
      { countryId: TO, _id: { $regex: "^DE-" } } as never,
      {
        $set: { countryId: "DE" },
      } as never
    );
  }

  console.log(APPLY ? "\nAPPLIED" : "\nDRY RUN — nothing written.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
