/**
 * Put the unified German state back on the Mark.
 *
 * The budget page renders "€132.6B" while the economy page renders "M271B" for
 * the same country, because they resolve currency differently: the economy page
 * derives it from config (COUNTRY_CURRENCY_MAP.DD = "DDM"), while
 * `federalBudgetDetail` PREFERS the stored `budget.currencyCode` and only falls
 * back to config. The live `federalBudget` doc for DD carries EUR — the Federal
 * Republic's currency, which rode along when its budget document became DD's.
 *
 * THE NUMBERS DO NOT MOVE. `exchangeRates` holds DE/EUR at 4.2 and DD/DDM at
 * 4.2 — the Mark der DDR was administered at par with the West DEM. So this is a
 * 1:1 redenomination: every stored magnitude keeps its meaning and only the
 * label changes. If the two rates ever diverge this script must not be reused
 * as-is, so it asserts parity before writing.
 *
 * ⚠️ PRE-MERGE HISTORY IS LEFT IN EUR ON PURPOSE. My reversal moved the FRG's
 * whole history under `countryId: "DD"`, so ~28,000 rows there are genuine West
 * German records that really were denominated in EUR when they happened —
 * including a complete parallel `moneySupplySnapshots` series on bankId ECB
 * going back to turn 9. Rewriting those would be falsifying the record, not
 * fixing it. Only rows written from the merge turn onward are wrong, because by
 * then the issuing state no longer existed.
 *
 * Stages, each independently flagged:
 *   --budget  the live federalBudget doc (what the page reads)
 *   --bonds   68 outstanding sovereign bonds maturing as late as turn 780
 *   --ledger  ~952 post-merge transaction rows (turn >= MERGE_TURN)
 *   --all     all three
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const want = (flag: string) => ALL || process.argv.includes(flag);

const COUNTRY = "DD";
const FROM = "EUR";
const TO = "DDM";
/** First turn at which the Federal Republic no longer existed. */
const MERGE_TURN = 540;

/** Collections whose post-merge rows should never have said EUR. */
const LEDGERS = [
  "treasuryTransactions",
  "financialTxLog",
  "moneySupplySnapshots",
  "savingsLedger",
  "actionLogs",
] as const;

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI_LIVE!, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  // Refuse mid-turn, as the national-corp heal does: the turn phases read and
  // rewrite these same documents, so a relabel landing between two phases can be
  // half-overwritten by the rest of the tick.
  if (APPLY && gs?.processingStartedAt) {
    throw new Error(`turn ${gs.currentTurn} is PROCESSING — refusing to write mid-turn`);
  }
  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — turn ${gs?.currentTurn} processing=${gs?.processingStartedAt ?? "-"}\n`
  );

  // Parity guard: a 1:1 relabel is only honest while the two rates match.
  const rates = await db
    .collection("exchangeRates")
    .find({ currencyCode: { $in: [FROM, TO] } } as never)
    .project({ currencyCode: 1, rate: 1 })
    .toArray();
  const rateOf = (c: string) => rates.find((r) => r.currencyCode === c)?.rate;
  const [eur, ddm] = [rateOf(FROM), rateOf(TO)];
  console.log(`exchange rates: ${FROM}=${eur}  ${TO}=${ddm}`);
  if (eur == null || ddm == null || Math.abs(Number(eur) - Number(ddm)) > 1e-9) {
    throw new Error(
      `refusing to relabel: ${FROM} and ${TO} are not at par (${eur} vs ${ddm}) — a real conversion is needed, not a rename`
    );
  }
  console.log("parity confirmed — relabel is 1:1, no magnitude changes\n");

  if (want("--budget")) {
    const before = await db.collection("federalBudget").findOne({ _id: COUNTRY as never });
    console.log(`[budget] federalBudget.${COUNTRY}.currencyCode = ${before?.currencyCode}`);
    if (APPLY) {
      const r = await db.collection("federalBudget").updateOne(
        { _id: COUNTRY as never, currencyCode: FROM } as never,
        {
          $set: { currencyCode: TO, updatedAt: new Date() },
        } as never
      );
      console.log(`[budget] modified ${r.modifiedCount}`);
    }
  }

  if (want("--bonds")) {
    const cohorts = await db
      .collection("bonds")
      .aggregate([
        { $match: { countryId: COUNTRY, currencyCode: FROM } },
        { $group: { _id: "$issuerName", n: { $sum: 1 }, maxMaturity: { $max: "$maturityTurn" } } },
      ])
      .toArray();
    console.log(`\n[bonds] outstanding ${FROM} bonds under ${COUNTRY}:`);
    for (const c of cohorts) {
      console.log(`  issuer=${String(c._id).padEnd(16)} n=${c.n} lastMaturity=${c.maxMaturity}`);
    }
    if (APPLY) {
      const r = await db.collection("bonds").updateMany(
        { countryId: COUNTRY, currencyCode: FROM } as never,
        {
          $set: { currencyCode: TO, updatedAt: new Date() },
        } as never
      );
      console.log(`[bonds] modified ${r.modifiedCount}`);
    }
  }

  if (want("--ledger")) {
    console.log(
      `\n[ledger] rows at turn >= ${MERGE_TURN} (post-merge, wrong) vs earlier (real FRG history):`
    );
    for (const coll of LEDGERS) {
      const post = await db.collection(coll).countDocuments({
        countryId: COUNTRY,
        currencyCode: FROM,
        turn: { $gte: MERGE_TURN },
      } as never);
      const pre = await db.collection(coll).countDocuments({
        countryId: COUNTRY,
        currencyCode: FROM,
        turn: { $lt: MERGE_TURN },
      } as never);
      console.log(
        `  ${coll.padEnd(22)} post=${String(post).padStart(5)}  pre=${String(pre).padStart(6)} (left alone)`
      );
      if (APPLY && post > 0) {
        const r = await db
          .collection(coll)
          .updateMany(
            { countryId: COUNTRY, currencyCode: FROM, turn: { $gte: MERGE_TURN } } as never,
            { $set: { currencyCode: TO } } as never
          );
        console.log(`    modified ${r.modifiedCount}`);
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
