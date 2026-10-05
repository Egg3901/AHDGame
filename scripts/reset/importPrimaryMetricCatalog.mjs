/**
 * One-time, deterministic import of the frozen reset metric table and its
 * machine-readable contract from the published design artifact.
 *
 * Usage: node scripts/reset/importPrimaryMetricCatalog.mjs <source.md> <metric-contract-1991.json>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [sourcePath, contractPath] = process.argv.slice(2);
if (!sourcePath || !contractPath) {
  throw new Error("Pass the design source and metric contract paths.");
}

const source = readFileSync(resolve(sourcePath), "utf8");
const contract = JSON.parse(readFileSync(resolve(contractPath), "utf8"));
const contractById = new Map(contract.map((entry) => [entry.id, entry]));
const lines = source.split(/\r?\n/);
const rows = [];

for (const line of lines) {
  const match = line.match(/^\|\s*(\d{2})\s*\|\s*\*\*(.+?)\*\*.*?`([^`]+)`\s*\|\s*(.*?)\s*\|$/);
  if (!match) continue;
  const [, id, name, path, detail] = match;
  const metadata = contractById.get(id);
  if (!metadata) continue;
  rows.push({
    id,
    path,
    name,
    description: detail
      .replace(/`/g, "")
      .replace(/\*\*/g, "")
      .replace(/[\u2013\u2014]/g, "-")
      .trim(),
    ...metadata,
  });
}

if (rows.length !== 58 || new Set(rows.map((row) => row.id)).size !== 58) {
  throw new Error(`Expected 58 unique primary metrics, got ${rows.length}.`);
}
for (const row of rows) {
  if (!row.path.includes(".") || !row.description || !row.name) {
    throw new Error(`Incomplete metric ${row.id}.`);
  }
}

const destination = resolve("src/lib/resetMetrics/primaryCatalog.json");
writeFileSync(destination, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
process.stdout.write(`${destination}: ${rows.length} primary metrics\n`);
