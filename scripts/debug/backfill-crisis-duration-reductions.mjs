/**
 * Backfill `durationReductionTurns` onto the decision trees of crises that are
 * still running.
 *
 * Ticket #1250. A crisis interaction snapshots its decision tree at creation, so
 * the new per-option duration reduction reaches only crises created after the
 * change. Every crisis already running carries a tree authored before the field
 * existed, and would go on doing what the ticket complained about: a government
 * takes Moderate Stimulus, pays 1.5% of GDP, and the recession runs its full
 * term regardless.
 *
 * This backfills the field onto ACTIVE crises only, matching each interaction's
 * snapshotted options to the current template by option id. Resolved crises are
 * left exactly as they were: their ledger is history and must not move.
 *
 * SAFETY: an interaction whose leader has ALREADY chosen a reducing option would,
 * after the backfill, have its reduction applied on the next turn — which can
 * expire the crisis immediately if it is already past the shortened length. That
 * is the intended outcome (they paid for it), but it is called out per crisis in
 * the dry run so the effect is visible before it is written.
 *
 *   node scripts/debug/backfill-crisis-duration-reductions.mjs          # dry run
 *   node scripts/debug/backfill-crisis-duration-reductions.mjs --apply  # write
 */
import { MongoClient } from "mongodb";
import fs from "fs";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    })
);

/**
 * The authored reductions, mirrored from src/lib/crises/templates.ts. Kept
 * literal so this runs as plain node; keyed by option id, which is unique
 * across the templates that carry one.
 */
const REDUCTIONS = {
  stimulus_moderate: 2,
  stimulus_large: 4,
  response_federal: 1,
  response_lockdown: 3,
  response_targeted: 1,
};

let uri = env.MONGODB_URI_LIVE;
if (!uri.includes("directConnection"))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
const client = new MongoClient(uri);
await client.connect();
const db = client.db();

const gs = await db.collection("gameState").findOne({ _id: "current" });
const turn = gs?.currentTurn;
console.log(`World: turn ${turn}, year ${gs?.currentYear}`);
console.log(APPLY ? "MODE: APPLY\n" : "MODE: DRY RUN (pass --apply to write)\n");

const active = await db.collection("crises").find({ status: "active" }).toArray();
const byId = new Map(active.map((c) => [String(c._id), c]));

const interactions = await db
  .collection("crisisInteractions")
  .find({ crisisId: { $in: active.map((c) => c._id) } })
  .toArray();

let patched = 0;
let alreadyChosen = 0;

for (const ix of interactions) {
  const crisis = byId.get(String(ix.crisisId));
  if (!crisis) continue;

  let changed = false;
  const tree = (ix.decisionTree ?? []).map((node) => ({
    ...node,
    options: (node.options ?? []).map((opt) => {
      const cut = REDUCTIONS[opt.optionId];
      if (cut === undefined || opt.durationReductionTurns === cut) return opt;
      changed = true;
      return { ...opt, durationReductionTurns: cut };
    }),
  }));
  if (!changed) continue;

  // Would this immediately expire the crisis? Only matters where a reducing
  // option is already in the resolution path.
  const path = ix.resolutionPath ?? [];
  const earned = path.reduce((sum, id) => sum + (REDUCTIONS[id] ?? 0), 0);
  const base = crisis.durationTurns ?? 0;
  const effective = Math.max(1, base - earned);
  const expiresNow = earned > 0 && turn >= crisis.startTurn + effective;

  console.log(
    `  ${String(crisis.name).padEnd(24)} ${String(crisis.countryIds ?? []).padEnd(10)} ` +
      `start ${crisis.startTurn}, ${base} turns` +
      (earned > 0
        ? `, already chose -${earned} -> ${effective}${expiresNow ? "  [EXPIRES NEXT TURN]" : ""}`
        : ", unanswered")
  );
  if (earned > 0) alreadyChosen++;

  if (APPLY) {
    await db
      .collection("crisisInteractions")
      .updateOne({ _id: ix._id }, { $set: { decisionTree: tree, updatedAt: new Date() } });
  }
  patched++;
}

console.log(
  `\n${APPLY ? "Patched" : "Would patch"}: ${patched} interaction(s); ` +
    `${alreadyChosen} had already chosen a reducing option.`
);
await client.close();
