/**
 * One-time reconciliation of corporations whose
 *   sum(shareholders.shares) + publicFloat + open reservations
 * exceeds `totalShares` — i.e., carry residual "phantom shares" from the
 * GET-self-heal bug (fixed 2026-04-19) and the pre-fix corp sell-order bug
 * (fixed 2026-04-14 in eb7240c6).
 *
 * Policy: trust BUYERS (they paid). Scale the CEO's shareholder entry down
 * by the phantom amount. When the CEO doesn't hold enough, log + skip so an
 * admin can resolve manually.
 *
 * Target DB: set MONGODB_URI_LIVE in .env.local.
 *
 * Usage:
 *   npx tsx scripts/migrations/reconcilePhantomShares.ts             # dry-run (default)
 *   npx tsx scripts/migrations/reconcilePhantomShares.ts --apply     # writes changes
 */

import { MongoClient, Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { computeAccountedShares } from "../../src/lib/corporations/shareInvariant";
import type { Corporation, ShareListing, ShareOrder } from "../../src/lib/db/types";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const apply = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE missing — set it in .env.local");
  process.exit(1);
}

interface ActionLog {
  corp: string;
  phantom: number;
  action: string;
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db: Db = client.db("a-house-divided");
  console.log(`Connected. Mode = ${apply ? "APPLY (writes)" : "DRY-RUN"}`);

  const corps = await db.collection<Corporation>("corporations").find({}).toArray();
  const allListings = await db
    .collection<ShareListing>("shareListings")
    .find({ status: "open" })
    .toArray();
  const allOrders = await db
    .collection<ShareOrder>("shareOrders")
    .find({ type: "sell", status: "open" })
    .toArray();

  const actions: ActionLog[] = [];

  for (const corp of corps) {
    const accounted = computeAccountedShares(corp, allListings, allOrders);
    const phantom = accounted - (corp.totalShares ?? 0);
    if (phantom <= 0) continue;

    const ceoEntry = corp.shareholders?.find(
      (sh) => sh.characterId?.toString() === corp.ceoId?.toString()
    );

    if (!ceoEntry) {
      actions.push({
        corp: `${corp.name} (#${corp.sequentialId ?? corp._id.toString().slice(-8)})`,
        phantom,
        action: `SKIP: CEO has no shareholder entry (requires manual admin review)`,
      });
      continue;
    }

    if ((ceoEntry.shares ?? 0) < phantom) {
      actions.push({
        corp: `${corp.name} (#${corp.sequentialId ?? corp._id.toString().slice(-8)})`,
        phantom,
        action: `SKIP: CEO holds ${ceoEntry.shares}, phantom=${phantom} (requires manual admin review)`,
      });
      continue;
    }

    actions.push({
      corp: `${corp.name} (#${corp.sequentialId ?? corp._id.toString().slice(-8)})`,
      phantom,
      action: `reduce CEO (${corp.ceoId?.toString().slice(-8)}) shares by ${phantom}`,
    });

    if (apply) {
      await db.collection<Corporation>("corporations").updateOne(
        { _id: corp._id, "shareholders.characterId": corp.ceoId },
        {
          $inc: { "shareholders.$.shares": -phantom },
          $set: { updatedAt: new Date() },
        }
      );
    }
  }

  console.log(`\n==== ${actions.length} corps flagged ====`);
  for (const a of actions) {
    console.log(`  ${a.corp}  phantom=${a.phantom}  ${a.action}`);
  }

  if (!apply && actions.length > 0) {
    console.log(`\nRe-run with --apply to write these changes.`);
  }

  await client.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
