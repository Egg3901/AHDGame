/** Import the authored 90-action reset register without enabling live actions. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("Pass prototype-catalog.js");
const text = readFileSync(resolve(inputPath), "utf8");
const source = JSON.parse(text.slice(text.indexOf("=") + 1, text.lastIndexOf(";")));
const plain = (value) => value.replace(/[\u2013\u2014]/g, "-").trim();
const rows = source.cabinetActions.map((action) => ({
  id: `${action.country}:${action.seat}:${action.slot}`,
  country: action.country,
  seatId: action.seat,
  slot: action.slot,
  title: plain(action.title),
  target: action.target,
  targetNames: action.targetNames.map(plain),
  strength: action.strength,
  costClass: action.cost,
  scope: action.scope,
  brief: plain(action.brief),
  description: plain(action.description),
}));
if (rows.length !== 90 || new Set(rows.map((row) => row.id)).size !== 90) {
  throw new Error(`Expected 90 unique actions, got ${rows.length}`);
}
const destination = resolve("src/lib/resetCabinet/actionCatalog.json");
writeFileSync(destination, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
process.stdout.write(`${destination}: ${rows.length} Cabinet actions\n`);
