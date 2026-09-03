/**
 * Put Delaware back.
 *
 * WHAT I BROKE. The reversal's singleton step swept every collection for a doc
 * keyed `_id: "DE"` and moved it to `_id: "DD"`, on the assumption that a doc so
 * keyed named Germany. In REGION-keyed collections it does not: the ids there are
 * region codes, and `DE` is Delaware. Eleven collections had Delaware's documents
 * moved under East Germany's id, and the United States lost a state.
 *
 * The country-keyed collections in that same sweep (`governmentApprovals`,
 * `governmentFormations`, `politicalCabinetContribution`,
 * `politicalMetricsHistory`, `regimeEscalation`) were moved correctly and are NOT
 * touched here.
 *
 * SAFE BECAUSE NOTHING WAS OVERWRITTEN: every one of these collections held no
 * `_id: "DD"` row before the move (checked before it ran), so the Delaware doc
 * sits alone under the wrong key and can simply go home. Each restore is refused
 * if a `DE` row already exists or if the doc does not look like Delaware.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

/** Region-keyed collections the sweep wrongly moved. */
const REGION_KEYED = [
  "demographicDefaults",
  "macroMetrics",
  "macroMetricsHistory",
  "politicalMetrics",
  "regionDemographics",
  "stateApprovalHistory",
  "stateBaselines",
  "stateBudgets",
  "stateDemographicTurnout",
  "stateDemographics",
  "states",
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

  let restored = 0;
  for (const coll of REGION_KEYED) {
    const dd = await db.collection(coll).findOne({ _id: "DD" as never });
    if (!dd) {
      console.log(`  ${coll.padEnd(28)} nothing at _id:DD — skipped`);
      continue;
    }
    const existing = await db.collection(coll).countDocuments({ _id: "DE" } as never);
    if (existing > 0) {
      console.log(`  ${coll.padEnd(28)} REFUSED — a _id:DE row already exists`);
      continue;
    }
    // It must look like a region row, not East Germany's.
    const owner = (dd as Record<string, unknown>).countryId;
    const regionKeyed = (await db.collection(coll).countDocuments({ _id: "AK" } as never)) > 0;
    if (!regionKeyed || (owner != null && owner !== "US")) {
      console.log(
        `  ${coll.padEnd(28)} REFUSED — does not look like Delaware (countryId=${owner})`
      );
      continue;
    }
    console.log(`  ${coll.padEnd(28)} DD -> DE  (countryId=${owner ?? "-"})`);
    restored++;
    if (APPLY) {
      const { _id: _drop, ...rest } = dd as Record<string, unknown>;
      await db
        .collection(coll)
        .replaceOne({ _id: "DE" as never }, { ...rest, _id: "DE" }, { upsert: true });
      await db.collection(coll).deleteOne({ _id: "DD" as never });
    }
  }

  console.log(`\n${restored} collection(s) ${APPLY ? "restored" : "would be restored"}`);
  console.log(APPLY ? "APPLIED" : "DRY RUN — nothing written.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
