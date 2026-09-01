/**
 * Point `governmentFormations.governingPartyId` at the SED's NEW number.
 *
 * The reversal's renumber sweeps `PARTY_REF_COLLECTIONS`, which is the canonical
 * table of every place a party is referenced by `sequentialId` — and
 * `governmentFormations.governingPartyId` is not in it. So the government of the
 * unified state still named party #7, which after the renumber is the Christian
 * Democratic Union: an absorbed, BANNED Federal Republic party.
 *
 * That is not cosmetic. `updateParliamentaryGovernmentSeats` does not recompute
 * this for an already-formed government — it reads `existing.governingPartyId` to
 * size the government's support — so the value does not heal on the next tick,
 * and the one-party state would have counted its support from the wrong benches
 * while `applyWhipVotes` treated the ruling party as the opposition.
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

  const ruling = await db
    .collection("politicalParties")
    .findOne(
      { countryId: TO, regimeStatus: "ruling" },
      { projection: { sequentialId: 1, name: 1 } }
    );
  if (!ruling) throw new Error("no ruling party");

  const gov = await db.collection("governmentFormations").findOne({ _id: TO as never });
  const current = gov?.governingPartyId;
  const names = await db
    .collection("politicalParties")
    .findOne(
      { countryId: TO, sequentialId: Number(current) },
      { projection: { name: 1, regimeStatus: 1 } }
    );

  console.log(`${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(
    `  governingPartyId is "${current}" -> ${names?.name ?? "(no such party)"} [${names?.regimeStatus ?? "-"}]`
  );
  console.log(`  should be "${ruling.sequentialId}" -> ${ruling.name} [ruling]`);

  if (APPLY) {
    await db.collection("governmentFormations").updateOne({ _id: TO as never }, {
      $set: { governingPartyId: String(ruling.sequentialId), updatedAt: new Date() },
    } as never);
    console.log("APPLIED");
  } else {
    console.log("DRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
