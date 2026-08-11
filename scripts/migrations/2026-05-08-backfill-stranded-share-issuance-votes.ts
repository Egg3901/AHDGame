/**
 * Backfill: apply share issuance effects for votes that passed before the
 * applyPassedVoteEffects status-guard fix in commit 9e9c7feaf (merged to
 * master 2026-05-08T04:06:18Z).
 *
 * Background: the original `applyPassedVoteEffects` had an
 * `if (vote.status !== "passed") return;` guard that read the local in-memory
 * vote object — which still held `status: "open"` because the route never
 * re-loaded it after `resolveCorporationVoteIfReady` flipped the DB row.
 * Result: vote DB row marked passed, "vote passed" notification sent, but
 * the share issuance effects (totalShares, publicFloat, liquidCapital) never
 * applied. 24 share_issuance votes were left stranded.
 *
 * What this does: groups stranded votes by (corporationId, newShareCount,
 * issuancePrice). When the bug was live, CEOs spam-clicked the proposal
 * button after nothing visibly happened — Nestlé alone has 11 identical
 * votes. We apply effects for ONLY the most recent vote in each group,
 * since a CEO who clicked Propose Issuance 7 times in a row clearly
 * intended one issuance, not seven. The duplicates are stamped
 * `effectsApplied: true` with `effectsAppliedNote: "deduped to <id>"`
 * so re-running this script is a no-op.
 *
 * Idempotent: votes already marked `effectsApplied: true` are skipped, so
 * re-running matches 0 documents.
 *
 * Skips: votes whose corp has been dissolved/deleted (corp doc gone).
 *
 * Usage:
 *   # Dry run (default):
 *   npx tsx scripts/migrations/2026-05-08-backfill-stranded-share-issuance-votes.ts
 *
 *   # Apply for real:
 *   npx tsx scripts/migrations/2026-05-08-backfill-stranded-share-issuance-votes.ts --apply
 *
 *   # Custom DB:
 *   npx tsx scripts/migrations/2026-05-08-backfill-stranded-share-issuance-votes.ts --db=local
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

function loadEnvLocal(): string | null {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "../.env.local"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const envFile = loadEnvLocal();
if (envFile) dotenv.config({ path: envFile });

const apply = process.argv.includes("--apply");
const dbArg = process.argv.find((a) => a.startsWith("--db="));
const dbName = dbArg ? dbArg.slice("--db=".length) : "a-house-divided";

// Cutoff: any share_issuance vote resolved at or before this UTC instant ran
// against the buggy applyPassedVoteEffects and was not effected. The fix
// commit timestamp is 2026-05-08T03:16:55Z; the master merge that deployed
// it landed at 2026-05-08T04:06:18Z. We use the merge time so a vote that
// resolved during the deploy gap still gets repaired.
const FIX_DEPLOY_CUTOFF = new Date("2026-05-08T04:06:18Z");

interface VoteDoc {
  _id: ObjectId;
  corporationId: ObjectId;
  type: string;
  status: string;
  payload: { newShareCount?: number; issuancePrice?: number };
  resolvedAt?: Date;
  effectsApplied?: boolean;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Missing MONGODB_URI in env");
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const stranded = (await db
      .collection("corporationVotes")
      .find({
        type: "share_issuance",
        status: "passed",
        resolvedAt: { $lte: FIX_DEPLOY_CUTOFF },
        effectsApplied: { $ne: true },
      })
      .sort({ resolvedAt: 1 })
      .toArray()) as unknown as VoteDoc[];

    console.log(`Stranded share_issuance votes (raw): ${stranded.length}`);

    // Dedupe per (corporationId, newShareCount, issuancePrice). The most
    // recent vote in each group is the "winner" — its effects will be
    // applied. Earlier votes in the group get marked as effectsApplied
    // with a "deduped" note (no $inc).
    const groups = new Map<string, VoteDoc[]>();
    for (const v of stranded) {
      const ns = v.payload?.newShareCount ?? 0;
      const ip = v.payload?.issuancePrice ?? 0;
      const key = `${v.corporationId.toString()}|${ns}|${ip}`;
      const arr = groups.get(key) ?? [];
      arr.push(v);
      groups.set(key, arr);
    }

    const winners: VoteDoc[] = [];
    const dupes: { vote: VoteDoc; winnerId: ObjectId }[] = [];
    for (const arr of groups.values()) {
      // Already sorted oldest→newest because the original query sorted by resolvedAt asc.
      const winner = arr[arr.length - 1];
      winners.push(winner);
      for (let i = 0; i < arr.length - 1; i++) {
        dupes.push({ vote: arr[i], winnerId: winner._id });
      }
    }

    console.log(`After dedupe: ${winners.length} winners, ${dupes.length} duplicates to void.`);

    let totalSharesPlanned = 0;
    let totalProceedsPlanned = 0;
    const corpHits = new Map<
      string,
      { name: string; votes: number; shares: number; cash: number }
    >();

    for (const v of winners) {
      const ns = v.payload?.newShareCount ?? 0;
      const ip = v.payload?.issuancePrice ?? 0;
      if (!ns || !ip) {
        console.log(
          `  SKIP winner ${v._id}: payload incomplete (newShareCount=${ns}, issuancePrice=${ip})`
        );
        continue;
      }
      const corp = (await db
        .collection("corporations")
        .findOne(
          { _id: v.corporationId },
          { projection: { name: 1, totalShares: 1, publicFloat: 1, liquidCapital: 1 } }
        )) as {
        name: string;
        totalShares?: number;
        publicFloat?: number;
        liquidCapital?: number;
      } | null;
      if (!corp) {
        console.log(`  SKIP winner ${v._id}: corporation ${v.corporationId} no longer exists`);
        continue;
      }
      const proceeds = ns * ip;
      totalSharesPlanned += ns;
      totalProceedsPlanned += proceeds;
      const key = v.corporationId.toString();
      const hit = corpHits.get(key) ?? { name: corp.name, votes: 0, shares: 0, cash: 0 };
      hit.votes += 1;
      hit.shares += ns;
      hit.cash += proceeds;
      corpHits.set(key, hit);
    }

    console.log("\nPer-corp summary (after dedupe):");
    for (const [, h] of corpHits) {
      console.log(
        `  ${h.name}: +${h.shares.toLocaleString()} shares, +${h.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })} (${h.votes} votes)`
      );
    }
    console.log(
      `\nTotal to apply: +${totalSharesPlanned.toLocaleString()} shares, +${totalProceedsPlanned.toLocaleString(undefined, { maximumFractionDigits: 2 })} treasury cash`
    );
    console.log(`Total to void as duplicates: ${dupes.length} votes`);

    if (!apply) {
      console.log("\nDry run — pass --apply to write.");
      return;
    }

    const now = new Date();
    let applied = 0;
    let voided = 0;
    let skipped = 0;

    // Apply winners
    for (const v of winners) {
      const ns = v.payload?.newShareCount ?? 0;
      const ip = v.payload?.issuancePrice ?? 0;
      if (!ns || !ip) {
        skipped += 1;
        continue;
      }
      const corpExists = await db
        .collection("corporations")
        .findOne({ _id: v.corporationId }, { projection: { _id: 1 } });
      if (!corpExists) {
        skipped += 1;
        continue;
      }
      const proceeds = ns * ip;

      // Atomic claim: only one runner can flip effectsApplied false→true.
      // Protects against parallel runs and races with future code paths.
      const claim = await db.collection("corporationVotes").updateOne(
        { _id: v._id, effectsApplied: { $ne: true } },
        {
          $set: {
            effectsApplied: true,
            effectsAppliedAt: now,
            effectsAppliedBy: "backfill-2026-05-08",
          },
        }
      );
      if (claim.matchedCount === 0) {
        skipped += 1;
        continue;
      }

      await db.collection("corporations").updateOne(
        { _id: v.corporationId },
        {
          $inc: { totalShares: ns, publicFloat: ns, liquidCapital: proceeds },
          $set: { updatedAt: now },
        }
      );
      applied += 1;
      console.log(
        `  applied vote ${v._id}: +${ns.toLocaleString()} shares, +${proceeds.toLocaleString(undefined, { maximumFractionDigits: 2 })} cash`
      );
    }

    // Void duplicates (mark effectsApplied without $inc)
    for (const { vote: v, winnerId } of dupes) {
      const claim = await db.collection("corporationVotes").updateOne(
        { _id: v._id, effectsApplied: { $ne: true } },
        {
          $set: {
            effectsApplied: true,
            effectsAppliedAt: now,
            effectsAppliedBy: "backfill-2026-05-08",
            effectsAppliedNote: `voided as duplicate of ${winnerId.toString()}`,
          },
        }
      );
      if (claim.matchedCount > 0) voided += 1;
    }

    console.log(
      `\nDone. Applied ${applied} winners, voided ${voided} duplicates, skipped ${skipped}.`
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
