/**
 * Undo the seizure of foreign corporations.
 *
 * WHAT I GOT WRONG. `corporations.countryOwnerId` is a WHOLE-COMPANY field, not a
 * per-operation one, and I set it from a query that only looked at operations
 * inside Germany. Twelve of the forty-six were foreign firms with a branch here:
 * the GDR ended up owning Marks & Spencer's eight British and thirteen American
 * stores on the strength of three German ones, Dangote across seven countries,
 * Powell Industries' ten UK operations, and so on. A command economy nationalises
 * what is inside its borders; it does not acquire a multinational by taxing a
 * warehouse.
 *
 * REVERTED TO UNOWNED, NOT TO A GUESS. Three of the twelve carry state-sounding
 * names — Great British Energy, Great British Realty, Soviet Technology Testing
 * Ministry — and it is tempting to hand them to the UK and the USSR. Structure
 * says otherwise: every confirmed state enterprise in this world has zero shares
 * and zero shareholders (Soviet Auto, Soviet Energy, the NHS), while all three of
 * these are shareholder-held, and a genuinely private firm here is called the
 * "American National Electrical Authority". Names are not evidence. They go back
 * to unowned, which is what 34 of the 53 corporations in this country already
 * are, and the three are reported so a human can correct them if I am wrong.
 *
 * The operating mandate is lifted from their German branches too, since a private
 * foreign firm should not be left under a state production mandate it never had.
 *
 * DD-DOMICILED CORPORATIONS ARE LEFT NATIONALISED. That part was the point.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
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

  const foreign = await db
    .collection("corporations")
    .find({ countryOwnerId: TO, countryId: { $ne: TO } } as never)
    .project({ name: 1, countryId: 1, ceoType: 1 })
    .toArray();
  const domestic = await db
    .collection("corporations")
    .countDocuments({ countryOwnerId: TO, countryId: TO } as never);

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — turn check\n`);
  console.log(`state-owned and DD-domiciled (kept): ${domestic}`);
  console.log(`foreign, to release: ${foreign.length}\n`);

  const ids = foreign.map((c) => c._id);
  for (const c of foreign) {
    const ops = await db
      .collection("corporateSectors")
      .aggregate([
        { $match: { corporationId: c._id } },
        { $group: { _id: "$countryId", n: { $sum: 1 } } },
      ])
      .toArray();
    console.log(
      `  ${String(c.name).padEnd(38)} home=${String(c.countryId).padEnd(4)} ops: ${ops.map((o) => `${o._id}:${o.n}`).join(" ")}`
    );
  }

  const mandated = await db.collection("corporateSectors").countDocuments({
    corporationId: { $in: ids },
    countryId: TO,
    soeMandate: { $ne: null },
  } as never);
  console.log(`\nGerman operations of those firms under a state mandate: ${mandated}`);

  if (APPLY) {
    await db.collection("corporations").updateMany(
      { _id: { $in: ids } } as never,
      {
        $set: { isNationalized: false, updatedAt: new Date() },
        $unset: { countryOwnerId: "" },
      } as never
    );
    await db.collection("corporateSectors").updateMany(
      { corporationId: { $in: ids }, countryId: TO } as never,
      {
        $unset: { soeMandate: "" },
      } as never
    );
    console.log(`\nAPPLIED — ${foreign.length} firm(s) released, ${mandated} mandate(s) lifted.`);
  } else {
    console.log("\nDRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
