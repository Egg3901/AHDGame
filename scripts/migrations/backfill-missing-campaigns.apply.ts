/**
 * One-time backfill: create a live Campaign document for every active player
 * candidate in a Campaign-eligible election that is missing one.
 *
 * Background: the `campaigns` collection was wiped around 2026-06-01, stranding
 * active candidates (incl. char 62 / 83) without a Campaign Manager. The
 * permanent fix is the per-turn self-heal sweep in campaignTurn; this script
 * applies the same heal immediately so players don't wait for the next turn.
 *
 * Reuses the exact production heal (`selfHealMissingCampaigns`) so behavior and
 * the created document shape match the turn sweep. Idempotent: existing active
 * campaigns are a no-op, archived ones for a re-active candidate are reactivated.
 *
 * Run from the worktree (this branch has the new code). `.env.local` is resolved
 * by walking up parent directories, so the main checkout's env is picked up.
 *
 * Usage:
 *   npx tsx scripts/migrations/backfill-missing-campaigns.apply.ts            # dry-run (read-only)
 *   npx tsx scripts/migrations/backfill-missing-campaigns.apply.ts --apply    # performs the backfill
 *   ... --db=local                                                            # target MONGODB_URI instead of LIVE
 *
 * Defaults to MONGODB_URI_LIVE.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import type { Db } from "mongodb";
import { selfHealMissingCampaigns } from "../../src/lib/campaigns/selfHealCampaigns";
import { isCampaignEligibleElection } from "../../src/lib/campaigns/isCampaignEligible";
import type { Election, ElectionCandidate } from "../../src/lib/db/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Walk up from this script until a `.env.local` is found (covers running from a
// worktree whose env lives in the parent checkout).
function loadEnv() {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, ".env.local");
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
const envPath = loadEnv();

const APPLY = process.argv.includes("--apply");
const useLocal = process.argv.includes("--db=local");
const uri = useLocal ? process.env.MONGODB_URI : process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error(
    `${useLocal ? "MONGODB_URI" : "MONGODB_URI_LIVE"} not set (env loaded from: ${envPath ?? "none"})`
  );
  process.exit(1);
}

/** Read-only count of what the heal would create (mirrors selfHealMissingCampaigns selection). */
async function plan(db: Db) {
  const active = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ status: "active" })
    .toArray();
  const elections = await db
    .collection<Election>("elections")
    .find({ _id: { $in: active.map((c) => c.electionId) } })
    .toArray();
  const elById = new Map(elections.map((e) => [e._id.toString(), e]));
  const camps = await db.collection("campaigns").find({}).toArray();
  const status = new Map(
    camps.map((c) => [`${c.electionId}:${c.candidateId}`, (c.status as string) ?? "active"])
  );

  let create = 0;
  let reactivate = 0;
  const byType: Record<string, number> = {};
  for (const c of active) {
    if (c.isNPP || !c.characterId) continue;
    const el = elById.get(c.electionId.toString());
    if (!el || !isCampaignEligibleElection(el)) continue;
    const st = status.get(`${c.electionId}:${c.characterId}`);
    if (st === undefined) {
      create++;
      byType[el.electionType ?? "?"] = (byType[el.electionType ?? "?"] ?? 0) + 1;
    } else if (st === "archived") {
      reactivate++;
    }
  }
  return { create, reactivate, byType };
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  const before = await plan(db);
  console.log(`[backfill-missing-campaigns] target=${useLocal ? "LOCAL" : "LIVE"}`);
  console.log(`  would create:     ${before.create}  ${JSON.stringify(before.byType)}`);
  console.log(`  would reactivate: ${before.reactivate}`);

  if (!APPLY) {
    console.log("\nDRY-RUN — no writes. Re-run with --apply to perform the backfill.");
    await client.close();
    return;
  }

  const healed = await selfHealMissingCampaigns(db, new Date());
  console.log(`\nAPPLIED — selfHealMissingCampaigns created/reactivated ${healed} campaign(s).`);

  const after = await plan(db);
  console.log(`  remaining missing after backfill: ${after.create} (expected 0)`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
