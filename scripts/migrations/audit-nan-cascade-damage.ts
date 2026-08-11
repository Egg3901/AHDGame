/**
 * Read-only audit of damage from the turn-269 NaN cascade.
 *
 * Lists every character whose CEO corp has/had NaN financials, the corp's
 * state before heal, and any character-level NaN contamination.
 *
 * Run: npx tsx scripts/migrations/audit-nan-cascade-damage.ts
 */
import { connectDb, closeDb } from "../utils/db";

async function main() {
  const db = await connectDb();

  const corps = await db
    .collection("corporations")
    .find(
      {},
      {
        projection: {
          _id: 1,
          name: 1,
          sequentialId: 1,
          ceoId: 1,
          userId: 1,
          countryId: 1,
          liquidCapital: 1,
          liquidCurrencyCode: 1,
          sharePrice: 1,
          ceoVacant: 1,
        },
      }
    )
    .toArray();

  const badCorps = corps.filter((c) => {
    const lc = c.liquidCapital;
    const sp = c.sharePrice;
    return (
      (typeof lc === "number" && !Number.isFinite(lc)) ||
      (typeof sp === "number" && !Number.isFinite(sp))
    );
  });

  console.log(`=== CORPS AFFECTED BY NaN CASCADE ===`);
  console.log(`Total corporations: ${corps.length}`);
  console.log(`NaN-affected: ${badCorps.length}`);

  const charIds = Array.from(
    new Set(badCorps.filter((c) => c.ceoId).map((c) => c.ceoId.toString()))
  );
  console.log(`Distinct CEOs of affected corps: ${charIds.length}`);

  // Load characters for affected CEOs
  const { ObjectId } = await import("mongodb");
  const ceoObjectIds = charIds.map((id) => new ObjectId(id));
  const chars = await db
    .collection("characters")
    .find(
      { _id: { $in: ceoObjectIds } },
      { projection: { _id: 1, name: 1, userId: 1, funds: 1, bannedUntil: 1 } }
    )
    .toArray();
  const charById = new Map(chars.map((c) => [c._id.toString(), c]));

  // Character funds NaN check
  const allChars = await db
    .collection("characters")
    .find({}, { projection: { _id: 1, name: 1, funds: 1, userId: 1 } })
    .toArray();
  const nanChars = allChars.filter((c) => typeof c.funds === "number" && !Number.isFinite(c.funds));
  console.log(`\n=== CHARACTER FUNDS INTEGRITY ===`);
  console.log(`Total characters: ${allChars.length}`);
  console.log(`Characters with NaN funds: ${nanChars.length} (expected: 0)`);

  // Look up turn-268 baseline for each affected corp so we can show the delta
  const hist268 = await db.collection("corporationHistory").find({ turn: 268 }).toArray();
  const histByCorp = new Map(hist268.map((h) => [h.corporationId.toString(), h]));

  console.log(`\n=== PER-CORP RECOVERY PREVIEW ===`);
  console.log(
    "corpId".padEnd(26) +
      " | " +
      "name".padEnd(30) +
      " | country | " +
      "restore liquidCapital".padStart(22) +
      " | " +
      "restore sharePrice".padStart(20) +
      " | CEO"
  );
  console.log("-".repeat(140));

  let totalAffectedLiquid = 0;
  let totalMissingHistory = 0;

  for (const c of badCorps) {
    const h = histByCorp.get(c._id.toString());
    const ceo = c.ceoId ? charById.get(c.ceoId.toString()) : undefined;
    const restoreLc = h && typeof h.liquidCapital === "number" ? h.liquidCapital : null;
    const restoreSp = h && typeof h.sharePrice === "number" ? h.sharePrice : null;
    if (restoreLc !== null) totalAffectedLiquid += restoreLc;
    if (!h) totalMissingHistory++;
    const corpId = c._id.toString().slice(-8);
    const name = (c.name ?? "(unnamed)").slice(0, 30);
    const ccy = c.liquidCurrencyCode ?? "???";
    console.log(
      corpId.padEnd(26) +
        " | " +
        name.padEnd(30) +
        " | " +
        (c.countryId ?? "??").padEnd(7) +
        " | " +
        (restoreLc === null
          ? "(no history)".padStart(22)
          : `${Math.round(restoreLc).toLocaleString()} ${ccy}`.padStart(22)) +
        " | " +
        (restoreSp === null ? "(no history)".padStart(20) : restoreSp.toFixed(4).padStart(20)) +
        " | " +
        (ceo?.name ?? (c.ceoVacant ? "(vacant)" : "(no char)"))
    );
  }

  console.log(
    `\nSummary: ${badCorps.length} corps to restore, ${totalMissingHistory} missing turn-268 history.`
  );
  console.log(
    `Sum of restore liquidCapital (mixed currencies): ${Math.round(totalAffectedLiquid).toLocaleString()}`
  );

  // Portfolio / trade damage
  const portNull = await db
    .collection("corporationPortfolioHistory")
    .countDocuments({ turn: { $gte: 269 }, totalValue: null });
  const shareTradesBad = await db
    .collection("shareTradeHistory")
    .countDocuments({ turn: { $gte: 269 } });
  const tradeRateNull = await db
    .collection("tradeHistory")
    .countDocuments({ turn: { $gte: 269 }, rate: null });
  console.log(`\n=== DOWNSTREAM DAMAGE ===`);
  console.log(`corporationPortfolioHistory rows with null totalValue (turn 269+): ${portNull}`);
  console.log(`shareTradeHistory rows in NaN window (turn 269+): ${shareTradesBad}`);
  console.log(`tradeHistory auto-conversion rows with null rate (turn 269+): ${tradeRateNull}`);

  await closeDb();
}

main().catch((e) => {
  console.error("[audit] failed:", e);
  process.exit(1);
});
