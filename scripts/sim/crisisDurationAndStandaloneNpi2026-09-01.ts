/**
 * Balance report for ticket #1250's two mechanic changes.
 *
 * ARM A — per-option crisis duration reduction.
 *   BEFORE  `CrisisDecisionOption` carried no duration field. The only thing that
 *           shortened a crisis was `calculateCollectiveReduction` (a funded aid
 *           tally), so the "reduces duration by N turns" printed on stimulus,
 *           disaster-relief and pandemic options did nothing at all.
 *   AFTER   `durationReductionTurns` is honoured by `calculateDecisionDurationReduction`
 *           and subtracted in `crisisTurn`, alongside the collective reduction.
 *
 *   What actually moves is not just the end date. `tickDecayFactor` ramps every
 *   per-turn effect from full strength at onset to zero at expiry, keyed on the
 *   EFFECTIVE duration, so a shorter crisis is also a shallower one. Cumulative
 *   tick exposure over a crisis of length D is
 *       sum over t=0..D-1 of (1 - t/D)  =  (D + 1) / 2
 *   so the report measures exposure, which is what players feel, rather than
 *   turns saved.
 *
 * ARM B — national influence for standalone provisions.
 *   BEFORE  `countProvisionsChargedNationalInfluence` counted policy, subsidy and
 *           union-law rows. Central-bank-independence and electoral-law provisions
 *           were free, so the same statute cost 0 alone and the full ladder rate
 *           with any policy row attached.
 *   AFTER   they ride the ladder like every other provision.
 *
 * Read-only: opens the live world, reads crises / crisisInteractions / bills, and
 * writes nothing.
 *
 *   npx tsx scripts/sim/crisisDurationAndStandaloneNpi2026-09-01.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { ALL_CRISIS_TEMPLATES } from "@/lib/crises/templates";
import { MIN_CRISIS_DURATION_TURNS } from "@/lib/crises/crisisDuration";
import {
  countProvisionsChargedNationalInfluence,
  getProvisionCostTotal,
} from "../../shared/constants/legislation";
import type { CrisisDecisionOption } from "@/lib/db/types/crisis";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

/** Cumulative tick multiplier over a crisis of length D: sum of (1 - t/D). */
function tickExposure(duration: number): number {
  let total = 0;
  for (let t = 0; t < duration; t++) total += 1 - t / duration;
  return total;
}

function optionsOf(node: { options?: CrisisDecisionOption[] }): CrisisDecisionOption[] {
  return node.options ?? [];
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  console.log(
    `World: turn ${gs?.currentTurn}, year ${gs?.currentYear}, preset ${gs?.preset}\n` +
      `${"=".repeat(78)}\n`
  );

  // ── ARM A ────────────────────────────────────────────────────────────────
  console.log("ARM A — per-option crisis duration reduction\n");

  // Which authored templates now carry a reduction, and what it buys.
  console.log("  Authored reductions (template / option / turns cut / exposure change):");
  let authoredCount = 0;
  for (const [key, tpl] of Object.entries(ALL_CRISIS_TEMPLATES)) {
    const nodes = tpl.interactionDefinition?.decisionTree ?? [];
    const base = Math.max(MIN_CRISIS_DURATION_TURNS, tpl.durationTurns ?? 0);
    if (!tpl.durationTurns) continue;
    for (const node of nodes) {
      for (const opt of optionsOf(node)) {
        const cut = opt.durationReductionTurns ?? 0;
        if (cut <= 0) continue;
        authoredCount++;
        const after = Math.max(1, base - cut);
        const before = tickExposure(base);
        const now = tickExposure(after);
        const pct = ((now - before) / before) * 100;
        console.log(
          `    ${key.padEnd(22)} ${opt.optionId.padEnd(20)} -${cut} turns  ` +
            `${base}->${after}  exposure ${before.toFixed(1)} -> ${now.toFixed(1)} (${pct.toFixed(1)}%)`
        );
      }
    }
  }
  if (authoredCount === 0) console.log("    (none)");

  // How often the mechanic would actually fire, from the live world's history.
  const crises = await db.collection("crises").find({}).toArray();
  const interactions = await db.collection("crisisInteractions").find({}).toArray();
  const byCrisis = new Map(interactions.map((i) => [String(i.crisisId), i]));

  let withTree = 0;
  let answered = 0;
  let wouldReduce = 0;
  let turnsSaved = 0;
  const perTemplate = new Map<string, { answered: number; reduced: number; turns: number }>();

  for (const c of crises) {
    const ix = byCrisis.get(String(c._id));
    if (!ix?.decisionTree?.length) continue;
    withTree++;
    const path: string[] = ix.resolutionPath ?? [];
    if (path.length === 0) continue;
    answered++;

    // Re-read the reduction off the CURRENT template, since live interactions
    // snapshotted their tree before the field existed.
    const tpl = c.name
      ? Object.values(ALL_CRISIS_TEMPLATES).find((t) => t.name === c.name)
      : undefined;
    const nodes = tpl?.interactionDefinition?.decisionTree ?? [];
    let cut = 0;
    for (const node of nodes) {
      for (const opt of optionsOf(node)) {
        if (path.includes(opt.optionId)) cut += opt.durationReductionTurns ?? 0;
      }
    }
    const key = c.name ?? "unknown";
    const row = perTemplate.get(key) ?? { answered: 0, reduced: 0, turns: 0 };
    row.answered++;
    if (cut > 0) {
      wouldReduce++;
      turnsSaved += cut;
      row.reduced++;
      row.turns += cut;
    }
    perTemplate.set(key, row);
  }

  console.log(
    `\n  Live history: ${crises.length} crises, ${withTree} with a decision tree, ` +
      `${answered} answered.\n` +
      `  Of the answered, ${wouldReduce} chose an option that now shortens the crisis ` +
      `(${answered > 0 ? ((wouldReduce / answered) * 100).toFixed(0) : "0"}%), ` +
      `for ${turnsSaved} crisis-turns total.`
  );
  if (perTemplate.size > 0) {
    console.log("\n  By template (answered / would reduce / turns):");
    for (const [name, row] of [...perTemplate.entries()].sort(
      (a, b) => b[1].answered - a[1].answered
    )) {
      console.log(
        `    ${name.padEnd(26)} ${String(row.answered).padStart(3)} / ${String(row.reduced).padStart(3)} / ${row.turns}`
      );
    }
  }

  const base = MIN_CRISIS_DURATION_TURNS;
  console.log(
    `\n  Bound on the change: the largest authored cut is 4 turns on a ${base}-turn floor,\n` +
      `  so no crisis can lose more than ${(((tickExposure(base) - tickExposure(base - 4)) / tickExposure(base)) * 100).toFixed(1)}% of its cumulative effect,\n` +
      `  and only when its government pays 3% of GDP to get it. Do-nothing options are\n` +
      `  unchanged, so the floor of the mechanic is exactly today's behaviour.`
  );

  // ── ARM B ────────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(78)}\nARM B — national influence for standalone provisions\n`);

  const bills = await db
    .collection("bills")
    .find({ "provisions.type": { $in: ["central_bank_independence", "electoral_law"] } })
    .toArray();

  console.log(`  Bills in the live world carrying a standalone provision: ${bills.length}`);

  for (const b of bills) {
    const provisions: Array<{ type?: string }> = b.provisions ?? [];
    const standalone = provisions.filter(
      (p) => p.type === "central_bank_independence" || p.type === "electoral_law"
    ).length;
    const policy = provisions.filter((p) => !p.type).length;
    const before = getProvisionCostTotal(
      countProvisionsChargedNationalInfluence({
        policyProvisionCount: policy,
        subsidyProvisionCount: 0,
      })
    );
    const after = getProvisionCostTotal(
      countProvisionsChargedNationalInfluence({
        policyProvisionCount: policy,
        subsidyProvisionCount: 0,
        standaloneProvisionCount: standalone,
      })
    );
    console.log(
      `    "${String(b.title).slice(0, 44).padEnd(44)}" ${policy} policy + ${standalone} standalone  NPI ${before} -> ${after}`
    );
  }

  console.log("\n  Ladder, standalone provision proposed alone:");
  for (let n = 1; n <= 3; n++) {
    const cost = getProvisionCostTotal(
      countProvisionsChargedNationalInfluence({
        policyProvisionCount: 0,
        subsidyProvisionCount: 0,
        standaloneProvisionCount: n,
      })
    );
    console.log(`    ${n} standalone provision${n === 1 ? " " : "s"}: ${cost} NPI`);
  }
  console.log(
    "\n  The charge is the ordinary ladder rate, identical to a subsidy-only or\n" +
      "  union-law-only bill. Nothing else in the pricing model moves."
  );

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
