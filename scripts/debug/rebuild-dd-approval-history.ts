/**
 * Put the GDR's own approval series back into the pre-merge half of its history.
 *
 * WHAT WENT WRONG. The reversal treated `governmentApprovals` as a country-keyed
 * singleton and replaced DD's row with DE's. That is right for the turns since
 * the merge — the unified state genuinely ran under the Federal Republic's id
 * from 545, so those entries ARE its record — and wrong for everything before it,
 * where the GDR was a separate country with its own approval near 68% and the
 * document now shows West Germany's 47%.
 *
 * NOT INVENTED. The page defines national approval as the population-weighted
 * average of region approval, and `stateApprovalHistory` is REGION-keyed, so it
 * survived the move untouched for all sixteen Laender across turns 531..550. The
 * pre-merge entries are recomputed with that same formula over the eastern
 * Laender alone — the country that actually existed then.
 *
 * `net` is not guessed either: it is exactly `2 * approval - 100` in every stored
 * entry (turn 550: 47.4 -> -5.2; turn 531: 47.1 -> -5.8), so it is derived rather
 * than carried over from the wrong country.
 *
 * ONLY `approval` AND `net` ARE REBUILT, and only for turns before the merge.
 * Entries from 545 on are left exactly as they are.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
/** The last turn on which the GDR was still a country of its own. */
const LAST_SEPARATE_TURN = 544;
/** The Laender that were East German. BEO is East Berlin, fused into BE at the merge. */
const EAST = ["BEO", "MV", "BB", "ST", "SN", "TH"];

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  // Populations: the live rows, plus East Berlin if anything still records it.
  const states = await db
    .collection("states")
    .find({ _id: { $in: EAST } as never })
    .project({ _id: 1, name: 1, population: 1 })
    .toArray();
  const pop = new Map(states.map((s) => [String(s._id), Number(s.population ?? 0)]));
  const missing = EAST.filter((id) => !pop.has(id));
  if (missing.length > 0) {
    console.log(`  note: no population row for ${missing.join(",")} — excluded from the weighting`);
  }

  const series = new Map<string, Map<number, number>>();
  for (const id of EAST) {
    const doc = await db.collection("stateApprovalHistory").findOne({ _id: id as never });
    const entries = (doc?.entries ?? doc?.history ?? []) as Array<Record<string, unknown>>;
    const m = new Map<number, number>();
    for (const e of entries) {
      const t = Number(e.turn);
      const v = Number(e.approval ?? e.value);
      if (Number.isFinite(t) && Number.isFinite(v)) m.set(t, v);
    }
    if (m.size > 0) series.set(id, m);
  }
  console.log(`  eastern Laender with history: ${[...series.keys()].join(",")}\n`);

  const approvals = db.collection("governmentApprovals");
  const doc = await approvals.findOne({ _id: "DD" as never });
  if (!doc) throw new Error("no governmentApprovals row for DD");
  const history = (doc.history ?? []) as Array<Record<string, unknown>>;

  const rebuilt = history.map((e) => {
    const turn = Number(e.turn);
    if (turn > LAST_SEPARATE_TURN) return e;
    let num = 0;
    let den = 0;
    for (const [id, m] of series) {
      const v = m.get(turn);
      const p = pop.get(id) ?? 0;
      if (v != null && p > 0) {
        num += v * p;
        den += p;
      }
    }
    if (den === 0) return e;
    const approval = Math.round((num / den) * 10) / 10;
    return { ...e, approval, net: Math.round((approval * 2 - 100) * 10) / 10 };
  });

  console.log("  turn   was     ->  GDR's own");
  for (let i = 0; i < history.length; i++) {
    const t = Number(history[i].turn);
    const before = history[i].approval;
    const after = rebuilt[i].approval;
    console.log(
      `  ${String(t).padEnd(6)} ${String(before).padEnd(7)} -> ${after}${t > LAST_SEPARATE_TURN ? "   (unified — kept)" : ""}`
    );
  }

  if (APPLY) {
    await approvals.updateOne({ _id: "DD" as never }, { $set: { history: rebuilt } } as never);
    console.log("\nAPPLIED");
  } else {
    console.log("\nDRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
