/* READ ONLY. Snapshot every row scoped to either Germany, before any reversal.
 *
 * The t545 backup taken during the first heal covered ten collections and was
 * taken AFTER the merge had begun, so it is not a pre-merge snapshot and cannot
 * be restored from. This one is the safety net for the reversal: it captures the
 * world as it stands now, so a botched heal can be put back.
 */
import { MongoClient } from "mongodb";
import fs from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });

/** Collections carrying a `countryId` that names one of the two Germanies. */
const COUNTRY_SCOPED = [
  "states",
  "politicalParties",
  "characters",
  "electedOfficials",
  "cabinetMembers",
  "militaryUnits",
  "militaryCommands",
  "militaryFormations",
  "nationalArsenal",
  "nationalManpower",
  "nationalDoctrine",
  "bills",
  "tariffs",
  "subsidies",
  "npps",
  "organizationMemberships",
  "countryLeaderStates",
  "legislationTypes",
  "corporations",
  "elections",
  "seats",
  "politicalPartyOrg",
];

/** Collections keyed by the country id itself. */
const ID_KEYED = ["federalBudget", "governmentFormations", "countryGameStates", "countryState"];

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const out: Record<string, unknown> = { takenAt: new Date().toISOString() };
  let total = 0;

  for (const name of COUNTRY_SCOPED) {
    const rows = await db
      .collection(name)
      .find({ countryId: { $in: ["DE", "DD"] } })
      .toArray();
    if (rows.length > 0) {
      out[name] = rows;
      total += rows.length;
      console.log(`  ${name.padEnd(24)} ${rows.length}`);
    }
  }
  for (const name of ID_KEYED) {
    const rows = await db
      .collection(name)
      .find({ _id: { $in: ["DE", "DD"] } as never })
      .toArray();
    if (rows.length > 0) {
      out[name] = rows;
      total += rows.length;
      console.log(`  ${name.padEnd(24)} ${rows.length} (id-keyed)`);
    }
  }

  // Composite-keyed region rows: `${countryId}_${stateId}`.
  const composite = await db
    .collection("stateRegistrationPool")
    .find({ _id: { $regex: "^(DE|DD)_" } as never })
    .toArray();
  if (composite.length > 0) {
    out.stateRegistrationPool = composite;
    total += composite.length;
    console.log(`  stateRegistrationPool   ${composite.length} (composite)`);
  }

  out.settlementCrises = await db.collection("settlementCrises").find({}).toArray();
  out.conflict = await db.collection("conflicts").findOne({ _id: "war_us_dd_415" as never });

  const path = `scripts/debug/backup-german-shells-${Date.now()}.json`;
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\n${total} rows -> ${path}`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
