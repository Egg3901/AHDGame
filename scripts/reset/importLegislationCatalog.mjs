/**
 * Deterministically import authored law text from the design prototype.
 * Prototype cost factors and outcome sensitivities are intentionally omitted:
 * they are not approved game balance or legal-component prices.
 *
 * Usage: node scripts/reset/importLegislationCatalog.mjs <prototype-catalog.js> <policy-levels.js> <prototypes.js>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [prototypePath, levelsPath, centerPath] = process.argv.slice(2);
if (!prototypePath || !levelsPath || !centerPath) {
  throw new Error("Pass prototype catalog, policy levels, and center briefs paths.");
}

const prototypeText = readFileSync(resolve(prototypePath), "utf8");
const prototype = JSON.parse(
  prototypeText.slice(prototypeText.indexOf("=") + 1, prototypeText.lastIndexOf(";"))
);
const levelsText = readFileSync(resolve(levelsPath), "utf8");
const centerText = readFileSync(resolve(centerPath), "utf8");

function parseRows(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Could not find ${startMarker}`);
  const rows = new Map();
  for (const match of text.slice(start, end).matchAll(/^\s*(L\d{2}):\s*(\[[^\n]+\]),?\s*$/gm)) {
    rows.set(match[1], JSON.parse(match[2]));
  }
  return rows;
}

const levels = parseRows(levelsText, "window.AHD_POLICY_LEVELS = {", "};");
const briefs = parseRows(levelsText, "window.AHD_POLICY_BRIEFS = {", "};");
const centers = parseRows(centerText, "const centerOptions = {", "};");
const positions = ["far_left", "center_left", "center", "center_right", "far_right"];
const plain = (value) => value.replace(/[\u2013\u2014]/g, "-").trim();

const laws = prototype.laws
  .filter((law) => /^L\d{2}$/.test(law.id))
  .map((law) => {
    const policy = levels.get(law.id);
    const descriptions = briefs.get(law.id);
    const center = centers.get(law.id);
    if (
      !policy ||
      !descriptions ||
      !center ||
      policy[0].length !== 5 ||
      descriptions.length !== 4
    ) {
      throw new Error(`Missing five authored positions for ${law.id}`);
    }
    return {
      id: law.id,
      title: plain(law.title),
      domain: plain(law.domain),
      scope: plain(law.scope),
      ownerCode: law.owner,
      primaryMetricIds: law.metrics,
      availability: law.availability,
      leaveToStates: law.leaveToStates,
      review: {
        legalComponents: "required",
        allocation: "required",
        outcomeCalibration: "required",
      },
      levels: positions.map((position, index) => ({
        position,
        title: plain(policy[0][index]),
        description: plain(index === 2 ? center[1] : descriptions[index < 2 ? index : index - 1]),
      })),
    };
  });

if (laws.length !== 51 || new Set(laws.map((law) => law.id)).size !== 51) {
  throw new Error(`Expected 51 unique law families, got ${laws.length}`);
}
const destination = resolve("src/lib/resetLegislation/familyCatalog.json");
writeFileSync(destination, `${JSON.stringify(laws, null, 2)}\n`, "utf8");
process.stdout.write(`${destination}: ${laws.length} law families\n`);
