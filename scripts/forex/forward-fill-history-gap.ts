/**
 * Forward-fill history collections across the turn-83/84 gap.
 *
 * Context:
 *   Two earlier repair scripts deleted turn-83 (mixed-unit corruption) and
 *   turn-84 (wrong-unit storage) snapshots. Charts now show a 2-turn hole.
 *   Rather than synthesize bogus prices, this script clones each corp's/char's
 *   turn-82 snapshot forward into turns 83 and 84 when missing. Prices/values
 *   appear flat across the gap — visually clean and truthful: "no change
 *   recorded during the transition window."
 *
 *   The next turn processor run writes genuine turn-85 data; turn-83/84 ghost
 *   copies remain as flat-line placeholders.
 *
 * Collections handled (per-turn time-series):
 *   - corporationHistory  (keyed by corporationId)
 *   - portfolioHistory    (keyed by characterId)
 *   - corporationPortfolioHistory (keyed by corporationId)
 *   - marketCapHistory    (singleton per turn)
 *   - wealthListHistory   (keyed by exchange)
 *   - investorRankingSnapshots (singleton per turn)
 *
 * Skipped (latest-only, regenerate naturally next turn):
 *   - stockExchangeSnapshots, wealthListSnapshots
 *
 * Idempotent: skips writes when a (key, turn) already exists.
 *
 * Run: npx tsx scripts/forex/forward-fill-history-gap.ts [--dry-run]
 */

import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DB_NAME = "a-house-divided";
const DRY_RUN = process.argv.includes("--dry-run");
const SOURCE_TURN = 82;
const FILL_TURNS = [83, 84];

type AnyDoc = Record<string, unknown> & { _id?: ObjectId | string; turn: number };

type Plan = {
  coll: string;
  keyFields: string[]; // fields (besides `turn`) that identify uniqueness
};

const PLANS: Plan[] = [
  { coll: "corporationHistory", keyFields: ["corporationId"] },
  { coll: "portfolioHistory", keyFields: ["characterId"] },
  { coll: "corporationPortfolioHistory", keyFields: ["corporationId"] },
  { coll: "marketCapHistory", keyFields: [] }, // one per turn
  { coll: "wealthListHistory", keyFields: ["exchange"] },
  { coll: "investorRankingSnapshots", keyFields: [] },
];

function stringifyKey(doc: AnyDoc, keyFields: string[]): string {
  return keyFields.map((f) => String(doc[f] ?? "")).join("|");
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    console.log(
      `Dry run: ${DRY_RUN}  |  Source turn: ${SOURCE_TURN}  |  Fill: ${FILL_TURNS.join(", ")}\n`
    );

    for (const plan of PLANS) {
      const coll = db.collection<AnyDoc>(plan.coll);
      const sourceDocs = (await coll.find({ turn: SOURCE_TURN }).toArray()) as unknown as AnyDoc[];
      if (sourceDocs.length === 0) {
        console.log(`  ${plan.coll}: no source docs at turn ${SOURCE_TURN} — skipped`);
        continue;
      }

      // Existing docs per fill turn, keyed by the identity fields
      const existingByTurn = new Map<number, Set<string>>();
      for (const t of FILL_TURNS) {
        const existing = (await coll.find({ turn: t }).toArray()) as unknown as AnyDoc[];
        existingByTurn.set(t, new Set(existing.map((d) => stringifyKey(d, plan.keyFields))));
      }

      const inserts: AnyDoc[] = [];
      for (const src of sourceDocs) {
        const key = stringifyKey(src, plan.keyFields);
        for (const t of FILL_TURNS) {
          if (existingByTurn.get(t)!.has(key)) continue;
          // Clone, overwrite turn/createdAt, drop _id so MongoDB assigns a fresh one
          const clone: AnyDoc = { ...src, turn: t, createdAt: new Date() };
          delete clone._id;
          inserts.push(clone);
        }
      }

      if (inserts.length === 0) {
        console.log(
          `  ${plan.coll}: ${sourceDocs.length} source docs; nothing to fill (all turns already covered)`
        );
        continue;
      }

      if (DRY_RUN) {
        console.log(
          `  ${plan.coll}: would insert ${inserts.length} docs (from ${sourceDocs.length} source docs × up-to-${FILL_TURNS.length} turns)`
        );
      } else {
        const res = await coll.insertMany(inserts as unknown as AnyDoc[]);
        console.log(
          `  ${plan.coll}: inserted ${res.insertedCount} docs (from ${sourceDocs.length} source docs)`
        );
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
