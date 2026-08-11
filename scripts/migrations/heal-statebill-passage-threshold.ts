/**
 * Heal script — state-bill passage threshold bug.
 *
 * The state-bill resolver used to require an ABSOLUTE majority of the whole
 * chamber (`votesFor >= floor(totalSeats/2)+1`) instead of the game-wide simple
 * majority (For > Against, `didPass`). Bills that won their floor vote but fell
 * short of an absolute chamber majority were wrongly marked `failed`.
 *
 * Scope (per review 2026-07-13): only the two bills that failed TODAY —
 *   1. UK/NIR "Services Act"  (6a539ded12fed84615446f7c)  won 43–28
 *   2. US/NC  "Help out"      (6a53f2518f01443949d73963)  won 20–0
 * The 14 older wrongly-failed bills are intentionally left as-is (retroactively
 * resurrecting weeks-old bills was declined).
 *
 * Heal = reproduce the FIXED resolver's passage branch. Both regions have a
 * seated governor, so each bill routes to `passed` → awaiting the governor's
 * signature (24h window; the normal auto-sign timer enacts it if the governor
 * does not act). This is NOT a force-enactment — it puts the bill exactly where
 * the corrected code would have put it and lets the standard flow proceed.
 *
 * Per bill this sets:  status=passed, passedAt, sentToGovernorAt,
 * governorActionDeadline (+24h), updatedAt;  unsets failedAt;  and notifies the
 * seated governor ("Bill Awaiting Your Action"), mirroring resolveStateBillVoting.
 *
 * Usage:
 *   npx tsx scripts/migrations/heal-statebill-passage-threshold.ts          # dry-run
 *   npx tsx scripts/migrations/heal-statebill-passage-threshold.ts --apply  # execute
 *
 * Idempotent: only acts on a bill whose status is still `failed` with
 * votesFor > votesAgainst. A second run (or a run after the heal) is a no-op.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { getRegionalExecutiveOfficeKey, type CountryId } from "../../src/lib/constants/countries";

const __d = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__d, "../../.env.local") });

const APPLY = process.argv.includes("--apply");
const GOVERNOR_ACTION_HOURS = 24;

const TARGETS = [
  new ObjectId("6a539ded12fed84615446f7c"), // UK/NIR "Services Act"
  new ObjectId("6a53f2518f01443949d73963"), // US/NC  "Help out"
];

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) throw new Error("MONGODB_URI_LIVE is not set");
const client = new MongoClient(uri, { directConnection: true });

type Any = any;

function log(section: string) {
  console.log(`\n── ${section} ${"─".repeat(Math.max(0, 60 - section.length))}`);
}

async function main() {
  await client.connect();
  const db = client.db() as unknown as Db;
  const now = new Date();

  console.log(`MODE: ${APPLY ? "APPLY" : "DRY-RUN"}  now=${now.toISOString()}`);

  for (const billId of TARGETS) {
    log(`BILL ${billId.toHexString()}`);
    const bill = (await db.collection("stateBills").findOne({ _id: billId })) as Any;
    if (!bill) {
      console.log("  NOT FOUND — skipping.");
      continue;
    }
    console.log(
      `  ${bill.countryId}/${bill.stateId} "${bill.title}"  status=${bill.status}  ` +
        `For=${bill.votesFor} Against=${bill.votesAgainst}`
    );

    // Guard: only heal a still-failed bill that actually won its vote (idempotent).
    if (bill.status !== "failed") {
      console.log(`  SKIP — status is "${bill.status}", not "failed" (already healed or changed).`);
      continue;
    }
    if (!((bill.votesFor ?? 0) > (bill.votesAgainst ?? 0))) {
      console.log(`  SKIP — For is not greater than Against; not a wrongly-failed bill.`);
      continue;
    }

    // Route exactly like the fixed resolver: seated regional executive → "passed".
    const execKey = getRegionalExecutiveOfficeKey(bill.countryId as CountryId);
    const governor = (await db.collection("electedOfficials").findOne({
      officeType: execKey,
      state: bill.stateId,
      characterId: { $ne: null },
    })) as Any;

    if (!governor?.characterId) {
      console.log(
        `  WARNING — no seated ${execKey} for ${bill.stateId}. The resolver would AUTO-ENACT ` +
          `this bill; that path is out of scope for this heal. SKIPPING to stay conservative.`
      );
      continue;
    }

    const governorActionDeadline = new Date(now.getTime() + GOVERNOR_ACTION_HOURS * 3_600_000);
    const govChar = (await db
      .collection("characters")
      .findOne(
        { _id: governor.characterId },
        { projection: { _id: 1, userId: 1, name: 1 } }
      )) as Any;

    console.log(
      `  → PASS → awaiting signature by ${execKey} ${govChar?.name ?? governor.characterId} ` +
        `(deadline ${governorActionDeadline.toISOString()})`
    );

    if (!APPLY) {
      console.log("  (dry-run: no write)");
      continue;
    }

    await db.collection("stateBills").updateOne(
      { _id: bill._id, status: "failed" },
      {
        $set: {
          status: "passed",
          passedAt: now,
          sentToGovernorAt: now,
          governorActionDeadline,
          updatedAt: now,
        },
        $unset: { failedAt: "" },
      }
    );

    if (govChar) {
      await db.collection("notifications").insertOne({
        userId: govChar.userId,
        type: "system",
        title: "Bill Awaiting Your Action",
        message: `"${bill.title}" has passed the State Senate and awaits your signature.`,
        read: false,
        createdAt: now,
        metadata: {
          billId: bill._id.toString(),
          stateId: bill.stateId,
          countryId: bill.countryId,
          recipientCharacterId: govChar._id.toString(),
        },
      });
    }
    console.log("  APPLIED.");
  }

  log("DONE");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.close());
