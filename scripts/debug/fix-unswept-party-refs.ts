/**
 * Apply the party renumber to the fields `PARTY_REF_COLLECTIONS` does not list.
 *
 * The reversal's two-phase sweep walks that table, and the table is incomplete:
 * `governmentFormations.governingPartyId` and `.seatsByParty` were both found
 * stale after the fact, each pointing at a BANNED Federal Republic party. A scan
 * for party-shaped fields on DD-scoped documents turned up more of the same.
 *
 * THE CORRECTION IS DETERMINISTIC. Anything the sweep missed still holds a
 * PRE-renumber id, so exactly one map applies — the same permutation, derived
 * from the party documents rather than typed out: a Federal Republic party
 * records where it came from in `mergedFrom.sequentialId`, and a GDR party that
 * went home sat six places higher before it moved.
 *
 * ObjectId-valued party fields (`coalitions.chairPartyId`,
 * `committeeProposals.partyId`, `financialTxLog.counterpartyId`) are NOT touched:
 * a party's ObjectId does not change when its number does.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";
import { NON_PARTY_SENTINELS } from "@/lib/country/partyMigrationCollections";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const TO = "DD";
const TEMP = 1000;

/** Sequential-id party fields the sweep does not cover. */
const TARGETS: Array<{ collection: string; field: string }> = [
  { collection: "countryLeaderStates", field: "governingPartyId" },
  { collection: "governorAddresses", field: "agendaEffect.partyId" },
  { collection: "partyMembershipEvents", field: "oldPartyId" },
  { collection: "partyMembershipEvents", field: "newPartyId" },
  { collection: "landeslisten", field: "partyId" },
  { collection: "executiveEndorsements", field: "candidatePartyId" },
  { collection: "governorEndorsements", field: "candidatePartyId" },
  { collection: "governorLegislationQueue", field: "targetPartyId" },
  { collection: "pmAppointmentVotes", field: "nomineePartyId" },
  { collection: "partyHistory", field: "partyId" },
  { collection: "activityLog", field: "details.party" },
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

  // Rebuild the map the renumber applied, from the documents it left behind.
  const parties = await db
    .collection("politicalParties")
    .find({ countryId: TO })
    .project({ sequentialId: 1, name: 1, mergedFrom: 1 })
    .toArray();
  const oldToNew = new Map<string, string>();
  for (const p of parties) {
    const cur = Number(p.sequentialId);
    const mf = p.mergedFrom as { countryId?: string; sequentialId?: number } | undefined;
    const old = mf?.sequentialId != null ? Number(mf.sequentialId) : cur + 6;
    if (old !== cur) oldToNew.set(String(old), String(cur));
  }
  console.log("map:", [...oldToNew.entries()].map(([a, b]) => `${a}->${b}`).join(" "), "\n");

  let touched = 0;
  for (const { collection, field } of TARGETS) {
    const coll = db.collection(collection);
    let n = 0;
    for (const oldId of oldToNew.keys()) {
      n += await coll.countDocuments({ countryId: TO, [field]: oldId } as never).catch(() => 0);
      n += await coll
        .countDocuments({ countryId: TO, [field]: Number(oldId) } as never)
        .catch(() => 0);
    }
    if (n === 0) continue;
    console.log(`  ${collection}.${field}`.padEnd(48) + `${n} row(s)`);
    touched += n;
    if (APPLY) {
      // Two phases, for the same reason the renumber needed them: the source and
      // target ranges overlap, so a direct pass would catch its own output.
      for (const phase of [1, 2] as const) {
        for (const [oldId, newId] of oldToNew) {
          const from = phase === 1 ? oldId : String(Number(oldId) + TEMP);
          const to = phase === 1 ? String(Number(oldId) + TEMP) : newId;
          if (NON_PARTY_SENTINELS.has(from)) continue;
          await coll.updateMany(
            { countryId: TO, [field]: from } as never,
            {
              $set: { [field]: to },
            } as never
          );
          await coll.updateMany(
            { countryId: TO, [field]: Number(from) } as never,
            {
              $set: { [field]: Number(to) },
            } as never
          );
        }
      }
    }
  }

  console.log(`\n${touched} row(s) ${APPLY ? "remapped" : "would be remapped"}`);
  console.log(APPLY ? "APPLIED" : "DRY RUN — nothing written.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
