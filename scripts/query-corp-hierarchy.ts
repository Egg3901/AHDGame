/**
 * One-off / CLI: list subsidiary (parent >50%) and merge-eligible (parent >75%, non-natcorp target) pairs.
 * Usage: npx tsx scripts/query-corp-hierarchy.ts
 */
import type { Corporation } from "../src/lib/db/types";
import {
  getControllingCorporateParent,
  HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT,
  SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT,
} from "../src/lib/corporations/corporateOwnership";
import { closeDb, connectDb } from "./utils/db";

function label(c: Pick<Corporation, "_id" | "name" | "sequentialId">): string {
  const id = c.sequentialId != null ? `#${c.sequentialId}` : c._id.toString().slice(-8);
  return `${c.name} (${id})`;
}

async function main() {
  const db = await connectDb();
  const corps = (await db
    .collection<Corporation>("corporations")
    .find({})
    .project({
      name: 1,
      sequentialId: 1,
      totalShares: 1,
      shareholders: 1,
      countryOwnerId: 1,
    })
    .toArray()) as Corporation[];

  const byId = new Map(corps.map((c) => [c._id.toString(), c]));

  console.log(
    `\nSubsidiaries — corporate parent holds > ${SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT}% (controlling stake)\n`
  );
  const subsidiaryRows: string[] = [];
  for (const c of corps) {
    const controlling = getControllingCorporateParent(c);
    if (!controlling) continue;
    const parent = byId.get(controlling.corporationId.toString());
    const nat = c.countryOwnerId ? " [national corp]" : "";
    subsidiaryRows.push(
      `  ${parent ? label(parent) : "?"} → ${label(c)} — ${controlling.ownershipPct}%${nat}`
    );
  }
  subsidiaryRows.sort();
  console.log(subsidiaryRows.length ? subsidiaryRows.join("\n") : "  (none)");

  console.log(
    `\nMerge-eligible (hostile takeover) — parent holds > ${HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT}%, target is not a national corp\n`
  );
  const mergeRows: string[] = [];
  for (const target of corps) {
    if (target.countryOwnerId) continue;
    const total = target.totalShares ?? 0;
    if (total <= 0) continue;
    for (const sh of target.shareholders ?? []) {
      if (!sh.corporationId || sh.shares <= 0) continue;
      const pct = (sh.shares / total) * 100;
      if (pct <= HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT) continue;
      const parent = byId.get(sh.corporationId.toString());
      mergeRows.push(
        `  ${parent ? label(parent) : "?"} → ${label(target)} — ${Math.round(pct * 100) / 100}%`
      );
    }
  }
  mergeRows.sort();
  console.log(mergeRows.length ? mergeRows.join("\n") : "  (none)");
  console.log("");
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
