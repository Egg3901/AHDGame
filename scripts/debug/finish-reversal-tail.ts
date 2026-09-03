/**
 * The last three steps of the reversal, which the E11000 on the party documents
 * stopped short of: the law catalogue, the books, and the war's victor.
 *
 * SEPARATE FROM THE MAIN SCRIPT ON PURPOSE. Re-running that would re-enter the
 * party step, and its document write now derives "which side is this party from"
 * off a `mergedFrom` it has already corrected — so a second pass would stamp the
 * SED as an absorbed Federal Republic party. The renumber is done; only the tail
 * is missing.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";
import { nationalDebtFromBalance } from "@/lib/budget/treasuryBalance";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const FROM = "DE";
const TO = "DD";

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  const currentTurn = Number(gs?.currentTurn ?? 0);
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — reversal tail at turn ${currentTurn}\n`);

  // ── The law catalogue, lower-cased ───────────────────────────────────────
  const laws = await db
    .collection("legislationTypes")
    .countDocuments({ countryScope: "de" } as never);
  console.log(`legislationTypes countryScope "de" -> "dd": ${laws}`);
  if (APPLY && laws > 0) {
    await db
      .collection("legislationTypes")
      .updateMany({ countryScope: "de" } as never, { $set: { countryScope: "dd" } } as never);
  }

  // ── The books ────────────────────────────────────────────────────────────
  const fromBudget = await db.collection("federalBudget").findOne({ _id: FROM as never });
  const toBudget = await db.collection("federalBudget").findOne({ _id: TO as never });
  if (fromBudget && !fromBudget.mergedInto) {
    const summed = (fromBudget.treasuryBalance ?? 0) + (toBudget?.treasuryBalance ?? 0);
    console.log(`\nfederalBudget`);
    console.log(`  ${FROM} = ${fromBudget.treasuryBalance}`);
    console.log(`  ${TO}  = ${toBudget?.treasuryBalance}  MERGED IN`);
    console.log(`  unified = ${summed}`);
    if (APPLY) {
      const { _id: _b, mergedInto: _mi, ...carried } = fromBudget as Record<string, unknown>;
      await db.collection("federalBudget").replaceOne(
        { _id: TO as never },
        {
          ...carried,
          _id: TO,
          countryId: TO,
          treasuryBalance: summed,
          debt: {
            ...((carried.debt as Record<string, unknown>) ?? {}),
            principal: nationalDebtFromBalance(summed),
          },
        },
        { upsert: true }
      );
      await db.collection("federalBudget").updateOne({ _id: FROM as never }, {
        $set: {
          treasuryBalance: 0,
          mergedInto: { countryId: TO, turn: currentTurn },
          updatedAt: new Date(),
        },
      } as never);
    }
  } else {
    console.log(`\nfederalBudget: already done (${FROM} carries mergedInto)`);
  }

  // ── The war names its victor ─────────────────────────────────────────────
  const war = await db.collection("conflicts").findOne({ _id: "war_us_dd_415" as never });
  console.log(`\nwar_us_dd_415 victor ${war?.victor ?? "(unset)"} -> ${TO}`);
  if (APPLY) {
    await db
      .collection("conflicts")
      .updateOne(
        { _id: "war_us_dd_415" as never },
        { $set: { victor: TO, updatedAt: new Date() } }
      );
  }

  console.log(APPLY ? "\nAPPLIED" : "\nDRY RUN — nothing written.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
