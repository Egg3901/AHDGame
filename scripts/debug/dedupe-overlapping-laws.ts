/**
 * Remove only the FRG programmes the GDR already duplicates.
 *
 * THE DOUBLE-COUNT IS AN OVERLAP PROBLEM, not a statute-book problem. Spending
 * laws are costed against GDP and population, so two programmes covering the same
 * ground both bill the whole unified state: measured against the last pre-merge
 * gate, spending came to 2.19x what East and West actually spent between them.
 * But that only holds where BOTH sides legislated. Deleting the FRG's book
 * wholesale — which I did once — takes the areas it alone covered with it, and
 * `transport` is exactly that: East Germany spent nothing on it and the Federal
 * Republic spent 12.7bn, so the unified state was left with no transport policy.
 *
 * THE TEST IS BOTH THE POLICY DOMAIN AND THE BUDGET LINE, because either alone
 * gets it wrong in a different direction. Domain alone judged `de_rail_transport`
 * covered — its domain is `infrastructure`, which the GDR legislates — while the
 * GDR spends nothing on the `transport` BUDGET LINE, so removing it reopens the
 * hole this script exists to avoid. Budget line alone is too coarse the other
 * way: "other" holds 85 GDR laws and would swallow every unmatched programme.
 *
 * So an FRG law is removed only when the GDR has an enacted law in the same
 * policy domain AND one charging the same budget line. Anything else is a gap the
 * GDR does not fill, and it stays.
 *
 * TAX IS EXEMPT and removed regardless of domain. The GDR carries its own
 * `incomeTax`, `salesTax`, `payrollTax`, `tariffs` and `domesticCorporateTax`,
 * and two live rate statutes for one tax is not a duplicated programme but a
 * contradiction — the unified state taxes under one code.
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

  const laws = await db.collection("enactedLaws").find({ countryId: TO }).toArray();
  const west = laws.filter((l) => isWest(String(l.legislationTypeId ?? "")));
  const east = laws.filter((l) => !isWest(String(l.legislationTypeId ?? "")));
  console.log(`enacted: ${laws.length} (GDR ${east.length}, FRG ${west.length})\n`);

  const typeIds = [...new Set(laws.map((l) => String(l.legislationTypeId)))];
  const types = await db
    .collection("legislationTypes")
    .find({ _id: { $in: typeIds } } as never)
    .project({ _id: 1, name: 1, policyDomain: 1 })
    .toArray();
  const domainOf = new Map(types.map((t) => [String(t._id), String(t.policyDomain ?? "(none)")]));

  // What the GDR already legislates on, and what it actually pays for.
  const gdrDomains = new Set(
    east.map((l) => domainOf.get(String(l.legislationTypeId)) ?? "(none)")
  );
  const gdrBudgetLines = new Set(east.map((l) => String(l.budgetCategory)));
  console.log(
    `GDR covers ${gdrDomains.size} policy domain(s): ${[...gdrDomains].sort().join(", ")}`
  );
  console.log(
    `GDR charges ${gdrBudgetLines.size} budget line(s): ${[...gdrBudgetLines].sort().join(", ")}\n`
  );

  const remove: typeof west = [];
  const keep: typeof west = [];
  for (const l of west) {
    const id = String(l.legislationTypeId);
    const domain = domainOf.get(id) ?? "(none)";
    const line = String(l.budgetCategory);
    const isTax = line === "tax";
    const duplicated = gdrDomains.has(domain) && gdrBudgetLines.has(line);
    if (isTax || duplicated) remove.push(l);
    else keep.push(l);
  }

  console.log(`KEEP — the GDR has no programme here (${keep.length}):`);
  for (const l of keep) {
    const domain = domainOf.get(String(l.legislationTypeId)) ?? "-";
    const line = String(l.budgetCategory);
    const why = !gdrBudgetLines.has(line) ? `no GDR "${line}" spending` : `no GDR "${domain}" law`;
    console.log(
      `  ${String(l.legislationTypeId).padEnd(30)} ${why.padEnd(26)} ${String(l.title ?? "").slice(0, 40)}`
    );
  }
  console.log(`\nREMOVE — duplicated by a GDR programme, or a tax rate (${remove.length}):`);
  for (const l of remove) {
    const why = String(l.budgetCategory) === "tax" ? "tax code" : "domain + line covered";
    console.log(
      `  ${String(l.legislationTypeId).padEnd(30)} ${why.padEnd(15)} ${String(l.title ?? "").slice(0, 42)}`
    );
  }

  if (APPLY) {
    const res = await db
      .collection("enactedLaws")
      .deleteMany({ _id: { $in: remove.map((l) => l._id) } } as never);
    console.log(`\nAPPLIED — removed ${res.deletedCount}, kept ${keep.length} FRG law(s).`);
  } else {
    console.log("\nDRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
