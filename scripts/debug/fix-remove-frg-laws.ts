/**
 * Repeal the Federal Republic's statute book from the unified state.
 *
 * The merge moved the FRG's enacted laws onto the surviving country alongside
 * the GDR's own, and nothing reconciles two overlapping statute books. Both sets
 * then bill the WHOLE unified population: spending laws are costed against GDP
 * and population, so a welfare act written for 59 million and one written for 21
 * million both charge for 80 million. Measured against the last pre-merge fiscal
 * gate, spending came to 2.19x the sum of the two halves — 235bn against the
 * 107bn East and West actually spent between them — while both had been in
 * surplus (+5.9bn and +23.1bn).
 *
 * ONLY THE GDR'S LAWS REMAIN. The catalogue prefix is the discriminator and it is
 * exact: 210 rows are `dd.*` and 36 are `de_*`, with nothing ambiguous.
 *
 * SAFE ON TAX, which is the one that could crater revenue: the GDR carries its
 * own `dd.tax.incomeTax`, `salesTax`, `payrollTax`, `tariffs` and
 * `domesticCorporateTax`, so removing the FRG's nine tax acts leaves the unified
 * state fully covered.
 *
 * ⚠️ TEN OF THE THIRTY-SIX WERE PASSED BY PLAYERS, not seeded defaults. They are
 * listed in full by the dry run before anything is removed, because deleting them
 * erases real legislative work — the price of the GDR's statute book being the
 * one that survives.
 *
 * NOT the catalogue. `legislationTypes` keeps its FRG entries: the historical
 * bills and elections still reference them, and what the unified state may
 * legislate in future is a separate decision from what it is charged for now.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const TO = "DD";

const isWest = (id: string) => id.startsWith("de_") || id.startsWith("de.");

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

  const laws = await db.collection("enactedLaws").find({ countryId: TO }).toArray();
  const west = laws.filter((l) => isWest(String(l.legislationTypeId ?? "")));
  const east = laws.filter((l) => !isWest(String(l.legislationTypeId ?? "")));

  console.log(`enacted laws under ${TO}: ${laws.length}`);
  console.log(`  GDR (kept):              ${east.length}`);
  console.log(`  Federal Republic (removed): ${west.length}`);

  // Refuse if the GDR would be left without a tax base.
  const eastTax = new Set(
    east
      .map((l) => String(l.legislationTypeId))
      .filter((id) => id.includes(".tax."))
      .map((id) => id.split(".").pop())
  );
  console.log(`\nGDR tax coverage retained: ${[...eastTax].join(", ") || "(NONE)"}`);
  if (eastTax.size === 0) {
    throw new Error("the GDR has no tax laws of its own — refusing to remove the FRG's");
  }

  const passed = west.filter((l) => !String(l.title ?? "").includes("(Default)"));
  console.log(
    `\nof the ${west.length}: ${west.length - passed.length} seeded defaults, ${passed.length} PASSED BY PLAYERS:`
  );
  for (const l of passed) {
    console.log(`   ${String(l.title ?? "").slice(0, 62)}`);
    console.log(
      `      type=${l.legislationTypeId} bill=${l.billId ?? "-"} enacted=${l.enactedAt ?? l.enactedYear ?? "-"}`
    );
  }

  if (APPLY) {
    const ids = west.map((l) => l._id);
    const res = await db.collection("enactedLaws").deleteMany({ _id: { $in: ids } } as never);
    console.log(`\nremoved ${res.deletedCount} row(s)`);
    console.log("APPLIED — spending recomputes on the next turn.");
  } else {
    console.log("\nDRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
