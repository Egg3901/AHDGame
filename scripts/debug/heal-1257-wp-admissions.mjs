/**
 * Ticket #1257 heal DRAFT: the Warsaw Pact applications refused by a threshold
 * nobody could see.
 *
 * China and North Korea applied on turn 538 and were rejected on turn 562. The
 * resolver demanded unanimity from a 7-country roll (players plus five members
 * run by the game) while the panel showed the 2-country player roll. On the
 * corrected roll both applications are 2/2 yes: Russia and East Germany each
 * voted to admit both, and nobody voted against either.
 *
 * So this is not a judgement call about what the bloc wanted. Both applications
 * PASSED on the roll the fixed code uses, and were refused only by the bug. This
 * replays the admission the resolver would have performed on turn 562, using the
 * same writes `admitMember` makes:
 *   - upsert the organizationMemberships row (status "active", joinedTurn)
 *   - delete any organizationWithdrawals tombstone
 *   - flip the proposal to "approved" with its resolution stamps
 *   - record the countryHistory event the resolver records
 *
 * Iran's application is untouched: it is still pending and closes on turn 587,
 * by which time the fixed resolver judges it on the corrected roll by itself.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 */
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient, ObjectId } from "mongodb";

const __d = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__d, "../../.env.local") });

const APPLY = process.argv.includes("--apply");
const ORG = "WARSAW_PACT";
const APPLICANTS = ["CN", "KP"];
const NAMES = { CN: "China", KP: "North Korea" };

const raw = process.env.MONGODB_URI_LIVE;
if (!raw) throw new Error("MONGODB_URI_LIVE is not set");
const uri = raw.includes("directConnection")
  ? raw
  : raw + (raw.includes("?") ? "&" : "?") + "directConnection=true";

const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db();
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  const turn = gs?.currentTurn;
  if (typeof turn !== "number") throw new Error("could not read currentTurn");
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} | live turn ${turn}\n`);

  const members = await db.collection("organizationMemberships").find({ organizationId: ORG }).toArray();
  const seated = new Set(members.map((m) => m.countryId));
  const states = await db
    .collection("countryGameStates")
    .find({ _id: { $in: members.map((m) => m.countryId) } })
    .toArray();
  const enabled = new Set(states.filter((s) => s.enabledForPlayers === true).map((s) => s._id));
  console.log(`Corrected Warsaw Pact ballot: ${[...enabled].sort().join(", ")}`);
  console.log(
    `Members off it (run by the game, or not modelled): ` +
      `${members.map((m) => m.countryId).filter((c) => !enabled.has(c)).sort().join(", ")}\n`
  );

  const col = db.collection("organizationMembershipProposals");
  const now = new Date();

  for (const applicant of APPLICANTS) {
    const p = await col.findOne({ organizationId: ORG, proposingCountryId: applicant });
    if (!p) {
      console.log(`${applicant}: no proposal row, skipping\n`);
      continue;
    }
    const voters = [...enabled].filter((c) => c !== applicant);
    const yes = new Set((p.votes ?? []).filter((v) => v.vote === "yes").map((v) => v.countryId));
    const no = (p.votes ?? []).filter((v) => v.vote === "no").map((v) => v.countryId);
    const counted = voters.filter((c) => yes.has(c));
    const unanimous = voters.length > 0 && counted.length === voters.length;

    console.log(`${applicant} (${NAMES[applicant]}): status=${p.status}, resolved t${p.resolvedOnTurn ?? "-"}`);
    console.log(`  votes on file: ${(p.votes ?? []).map((v) => `${v.countryId}=${v.vote}`).join(" ")}`);
    console.log(`  on the corrected ballot: ${counted.length}/${voters.length} yes, ${no.length} no`);

    if (p.status !== "rejected") {
      console.log(`  NOT rejected, leaving alone\n`);
      continue;
    }
    if (!unanimous) {
      console.log(`  NOT unanimous on the corrected ballot either, leaving rejected\n`);
      continue;
    }
    if (seated.has(applicant)) {
      console.log(`  already seated in ${ORG}, nothing to admit\n`);
      continue;
    }

    const tombstone = await db
      .collection("organizationWithdrawals")
      .findOne({ organizationId: ORG, countryId: applicant });

    console.log(`  WOULD ADMIT. Writes:`);
    console.log(`    organizationMemberships upsert {organizationId:${ORG}, countryId:${applicant}, status:"active", joinedTurn:${turn}}`);
    console.log(`    organizationWithdrawals delete ${tombstone ? "1 tombstone" : "(none present)"}`);
    console.log(`    proposal ${p._id} -> status:"approved", resolvedOnTurn:${turn}`);
    console.log(`    countryHistory insert "${NAMES[applicant]} admitted to ${ORG}."`);

    if (APPLY) {
      const m = await db.collection("organizationMemberships").updateOne(
        { organizationId: ORG, countryId: applicant },
        {
          $setOnInsert: {
            _id: new ObjectId(),
            organizationId: ORG,
            countryId: applicant,
            status: "active",
            joinedAt: now,
            joinedTurn: turn,
          },
        },
        { upsert: true }
      );
      const w = await db
        .collection("organizationWithdrawals")
        .deleteOne({ organizationId: ORG, countryId: applicant });
      const r = await col.updateOne(
        { _id: p._id },
        { $set: { status: "approved", resolvedAt: now, resolvedOnTurn: turn } }
      );
      await db.collection("countryHistory").insertOne({
        _id: new ObjectId(),
        countryId: applicant,
        turn,
        timestamp: now,
        eventType: "international_relations",
        title: `${NAMES[applicant]} admitted to ${ORG}.`,
        details: { organizationId: ORG, healedTicket: 1257 },
      });
      console.log(
        `    applied: membership upserted=${m.upsertedCount} matched=${m.matchedCount}, ` +
          `tombstones removed=${w.deletedCount}, proposal modified=${r.modifiedCount}`
      );
    }
    console.log();
  }

  // Everything still open. These are NOT healed: the fixed resolver judges them
  // correctly by itself, PROVIDED IT IS DEPLOYED BEFORE THEY CLOSE. Anything
  // closing sooner than the deploy is decided on the broken roll.
  const pending = await col
    .find({ organizationId: ORG, status: "pending" })
    .sort({ closesOnTurn: 1 })
    .toArray();
  if (pending.length > 0) console.log("Still open (left alone):");
  for (const q of pending) {
    const voters = [...enabled].filter((c) => c !== q.proposingCountryId);
    const yes = new Set((q.votes ?? []).filter((v) => v.vote === "yes").map((v) => v.countryId));
    const short = voters.filter((c) => !yes.has(c));
    console.log(
      `  ${q.proposingCountryId}: closes t${q.closesOnTurn} (${q.closesOnTurn - turn} turns), ` +
        `${voters.length - short.length}/${voters.length} on the corrected ballot` +
        (short.length ? `, waiting on ${short.join(", ")}` : ", would pass as it stands")
    );
  }
  if (!APPLY) console.log("\nDry run only. Re-run with --apply to write.");
} finally {
  await client.close();
}
