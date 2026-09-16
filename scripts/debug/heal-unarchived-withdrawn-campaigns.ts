/**
 * Archive the campaigns of candidates who are already withdrawn but whose
 * campaign document was never flipped to `status: "archived"`.
 *
 * WHY THIS EXISTS. "Out of the race" is represented twice: `electionCandidates
 * .status = "withdrawn"` (the truth) and `campaigns.status = "archived"` (the
 * bookkeeping the Campaign Operations list reads). Keeping the two in step was
 * left to every individual withdrawal path, and several never did it —
 * `withdrawFromMismatchedPrimaries` and `sweepPartyMismatchedCandidates` (party
 * switch), `withdrawAllActiveCandidacies` (relocation),
 * `withdrawInactiveCandidates` (96-turn inactivity),
 * `cleanupStaleElectionCandidates`, and `cascadeCharacterDeletion`. A candidate
 * withdrawn by any of those kept a live campaign rendering on the race page
 * next to the candidates still running.
 *
 * The live signature on the US presidential race (election
 * 6aa54d0344457528bafa6976), which is what surfaced this:
 *
 *     Richard Nixon      withdrawn 09-14  campaign archived    ← manual /withdraw
 *     Charles Leclerc    withdrawn 09-12  campaign archived    ← manual /withdraw
 *     Vladimir Iskra     withdrawn 09-12  campaign ACTIVE      ← party switch 4 → 1
 *     Keiko Fujimori     withdrawn 09-15  campaign ACTIVE      ← party switch 2 → independent
 *
 * THE CODE FIX SHIPS ALONGSIDE THIS. Every withdrawal path now calls
 * `archiveCampaignsForCandidates`, and the Campaign Operations route no longer
 * trusts the flag at all — it lists only campaigns whose candidate holds an
 * active candidacy, so the display is correct even if the flag drifts again.
 * That fixes new withdrawals; it cannot retroactively archive the rows that
 * were already missed, which is what this script is for.
 *
 * WHAT IT WRITES. Only `campaigns` rows that are BOTH non-archived AND belong
 * to a candidate with no active candidacy in that same election. It sets
 * `status`, `archivedAt`, `archivedReason: "withdrawn"` and `updatedAt`, and
 * touches nothing else — funds, levels, activity history and donation logs are
 * preserved exactly, so a re-entry reactivates the campaign intact via
 * `ensureCampaignForCandidate`.
 *
 * A candidate who withdrew under one party and re-entered the SAME election
 * under another is deliberately skipped: they still hold an active candidacy
 * there, so their campaign must stay live.
 *
 * DRY RUN BY DEFAULT. Pass `--apply` to write, `--live` to target
 * MONGODB_URI_LIVE.
 *
 *   npx tsx scripts/debug/heal-unarchived-withdrawn-campaigns.ts --live
 *   npx tsx scripts/debug/heal-unarchived-withdrawn-campaigns.ts --live --apply
 *
 * STATUS: NOT RUN.
 */
import { MongoClient, type Db, type ObjectId } from "mongodb";
import fs from "node:fs";
import type { Campaign, ElectionCandidate, Election } from "@/lib/db/types";

const APPLY = process.argv.includes("--apply");
const LIVE = process.argv.includes("--live");

function uri(): string {
  const env = fs.readFileSync(".env.local", "utf8");
  const key = LIVE ? "MONGODB_URI_LIVE" : "MONGODB_URI";
  const raw = (env.match(new RegExp(`^${key}=(.*)$`, "m")) ?? [])[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (!raw) throw new Error(`${key} not found in .env.local`);
  // Railway's Mongo needs a direct connection; replica-set discovery hangs.
  return LIVE ? raw + (raw.includes("?") ? "&" : "?") + "directConnection=true" : raw;
}

async function main(): Promise<void> {
  const client = new MongoClient(uri());
  await client.connect();
  const db = client.db() as unknown as Db;

  try {
    console.log(`${APPLY ? "APPLY" : "DRY RUN"} against ${LIVE ? "LIVE" : "testing"} database\n`);

    const liveCampaigns = await db
      .collection<Campaign>("campaigns")
      .find({ status: { $ne: "archived" } })
      .toArray();
    if (liveCampaigns.length === 0) {
      console.log("No non-archived campaigns found — nothing to do.");
      return;
    }

    // One pass over the candidacy rows for the elections those campaigns sit in,
    // rather than a query per campaign.
    const electionIds = [...new Set(liveCampaigns.map((c) => c.electionId.toString()))].map(
      (id) => liveCampaigns.find((c) => c.electionId.toString() === id)!.electionId
    );
    const candidacies = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: electionIds }, status: "active" })
      .project<{ electionId: ObjectId; characterId: ObjectId | null; nppId: ObjectId | null }>({
        electionId: 1,
        characterId: 1,
        nppId: 1,
      })
      .toArray();

    // Campaigns key `candidateId` by character id for players and by NPP id for
    // NPPs, so both identities go into the key set.
    const standing = new Set<string>();
    for (const c of candidacies) {
      const e = c.electionId.toString();
      if (c.characterId) standing.add(`${e}|${c.characterId.toString()}`);
      if (c.nppId) standing.add(`${e}|${c.nppId.toString()}`);
    }

    const elections = await db
      .collection<Election>("elections")
      .find({ _id: { $in: electionIds } })
      .project<{ _id: ObjectId; electionType: string; state: string; status: string }>({
        _id: 1,
        electionType: 1,
        state: 1,
        status: 1,
      })
      .toArray();
    const electionById = new Map(elections.map((e) => [e._id.toString(), e]));

    const orphaned = liveCampaigns.filter(
      (c) =>
        c.candidateId && !standing.has(`${c.electionId.toString()}|${c.candidateId.toString()}`)
    );

    if (orphaned.length === 0) {
      console.log("No orphaned campaigns — every live campaign has an active candidacy.");
      return;
    }

    console.log(`Found ${orphaned.length} campaign(s) with no active candidacy:\n`);
    for (const c of orphaned) {
      const e = electionById.get(c.electionId.toString());
      console.log(
        `  campaign ${c._id.toString()}` +
          `  election ${c.electionId.toString()} (${e?.electionType ?? "?"} ${e?.state ?? "?"}, ${e?.status ?? "?"})` +
          `  candidate ${c.candidateId.toString()}` +
          `  funds ${Math.round(c.funds ?? 0)}`
      );
    }

    if (!APPLY) {
      console.log(`\nDRY RUN — pass --apply to archive these ${orphaned.length} campaign(s).`);
      return;
    }

    const now = new Date();
    const result = await db.collection<Campaign>("campaigns").updateMany(
      { _id: { $in: orphaned.map((c) => c._id) }, status: { $ne: "archived" } },
      {
        $set: {
          status: "archived",
          archivedAt: now,
          archivedReason: "withdrawn",
          updatedAt: now,
        },
      }
    );
    console.log(`\nArchived ${result.modifiedCount} campaign(s).`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
