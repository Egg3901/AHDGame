/**
 * Import only the reviewed 1991 current-law reference text and source lineage.
 * Option supersession and cost fields in the design file are intentionally NOT
 * imported; those are explicitly unreviewed and cannot authorize a proposal.
 * Usage: node scripts/reset/importOpeningLawReferences.mjs <component-comparisons-1991.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("Pass component-comparisons-1991.json");
const source = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
const plain = (value) => value.replace(/[\u2013\u2014]/g, "-").trim();
// These opening transfers are already reserved from spendable Cabinet cash.
// An ordinary law option cannot release them without a separate grant-ledger
// transition; preserve the restriction if the crosswalk is re-imported.
const protectedTransfers = new Set(["jp_local_allocation_tax", "uk_local_government_funding"]);
const rows = source.rows.map((row) => ({
  key: `${row.country}:${row.scope === "state" ? "regional" : row.scope}:${row.id}`,
  country: row.country,
  scope: row.scope === "state" ? "regional" : row.scope,
  familyId: row.id,
  status: row.status,
  currentLaw: plain(row.currentLaw),
  legalNote: plain(row.legalNote),
  sourceComponents: row.components.map((component) => ({
    sourceId: component.sourceId,
    selectedOption: plain(component.selectedOption),
    optionIndex: component.optionIndex,
    historicalDisposition: component.historicalDisposition,
    fiscalOwner: component.fiscalOwner,
    fiscalRole: component.fiscalRole,
    annualBooked: component.annualBooked,
    treatment: component.treatment,
    ...(protectedTransfers.has(component.sourceId)
      ? { replacementRestriction: "protected-transfer" }
      : {}),
  })),
}));
if (rows.length !== 360 || new Set(rows.map((row) => row.key)).size !== 360) {
  throw new Error(
    `Expected 360 unique country/scope/family opening references, got ${rows.length}`
  );
}
const destination = resolve("src/lib/resetLegislation/openingLawReferences.json");
writeFileSync(destination, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
process.stdout.write(`${destination}: ${rows.length} opening references\n`);
