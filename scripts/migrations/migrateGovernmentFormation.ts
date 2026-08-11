/**
 * Migration: Populate governmentFormations collection from legacy docs
 *
 * Reads existing data from:
 *   - parliamentaryGovernments (_id: "UK") — primary source for formation state
 *   - ukGovernment (_id: "current")        — fallback / supplementary PM info
 *
 * Creates (or upserts) a governmentFormations document with _id: "UK".
 *
 * Also cancels any active votes in the old vote collections:
 *   - confidenceVotes (countryId: "UK", status: "active")
 *   - pmNoConfidenceVotes (status: "active")
 *
 * Old collections (parliamentaryGovernments, ukGovernment, confidenceVotes,
 * pmNoConfidenceVotes, ukConfidenceVotes) are NOT dropped by this script.
 * Drop them manually once the new system is validated.
 *
 * Run with: npx tsx scripts/migrations/migrateGovernmentFormation.ts
 */

import { connectDb, closeDb } from "../utils/db";
import { ObjectId } from "mongodb";

// Local type mirrors — avoids importing src types from scripts
type GovernmentFormationStatus = "pending" | "formed" | "collapsed";
type GovernmentFormationType = "majority" | "coalition" | "minority";

interface GovernmentFormationDoc {
  _id: string;
  countryId: "UK";
  cycle: number;
  status: GovernmentFormationStatus;
  formationType: GovernmentFormationType | null;
  lostMajority: boolean;
  pmCharacterId: ObjectId | null;
  pmName: string | null;
  governingPartyId: string | null;
  coalitionId: number | null;
  coalitionPartyIds: string[] | null;
  totalSeatsSupporting: number;
  majorityThreshold: number;
  seatsByParty: Record<string, number>;
  totalSeats: number;
  activeVoteId: ObjectId | null;
  formedAt: Date | null;
  formedTurn: number | null;
  collapsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

async function main() {
  const db = await connectDb();
  const now = new Date();

  console.log("=== migrateGovernmentFormation ===");

  // ── 1. Read legacy documents ─────────────────────────────────────────────
  const parlGovDoc = await db
    .collection("parliamentaryGovernments")
    .findOne({ _id: "UK" as unknown as object });

  const ukGovDoc = await db
    .collection("ukGovernment")
    .findOne({ _id: "current" as unknown as object });

  console.log("parliamentaryGovernments (UK):", parlGovDoc ? "found" : "not found");
  console.log("ukGovernment (current):", ukGovDoc ? "found" : "not found");

  // ── 2. Determine PM ───────────────────────────────────────────────────────
  // Prefer parlGov PM; fall back to ukGov PM
  const pmCharacterId: ObjectId | null =
    (parlGovDoc?.pmCharacterId as ObjectId | null | undefined) ??
    (ukGovDoc?.pmCharacterId as ObjectId | null | undefined) ??
    null;

  const pmName: string | null = (parlGovDoc?.pmName as string | null | undefined) ?? null;

  // ── 3. Determine status ───────────────────────────────────────────────────
  let status: GovernmentFormationStatus;
  if (pmCharacterId) {
    status = "formed";
  } else {
    // Check parlGov status — collapsed trumps pending
    const parlStatus = parlGovDoc?.status as string | undefined;
    if (parlStatus === "collapsed") {
      status = "collapsed";
    } else {
      status = "pending";
    }
  }

  // ── 4. Determine formationType ────────────────────────────────────────────
  let formationType: GovernmentFormationType | null = null;
  if (status === "formed") {
    const parlFormType = parlGovDoc?.formationType as string | undefined;
    if (parlFormType === "majority") {
      formationType = "majority";
    } else if (parlFormType === "coalition" || parlFormType === "confidence_supply") {
      formationType = "coalition";
    } else if (parlFormType === "minority" || parlFormType === "minority_pending") {
      formationType = "minority";
    } else {
      // Infer from seat data: if governing party has >= majority threshold, majority
      const seatsRaw = parlGovDoc?.seatsByParty as Record<string, number> | undefined;
      const govParty = parlGovDoc?.governingPartyId as string | undefined;
      const threshold = (parlGovDoc?.majorityThreshold as number | undefined) ?? 326;
      if (seatsRaw && govParty) {
        formationType = (seatsRaw[govParty] ?? 0) >= threshold ? "majority" : "minority";
      } else {
        formationType = "majority";
      }
    }
  }

  // ── 5. Gather seat data ───────────────────────────────────────────────────
  const seatsByParty: Record<string, number> =
    (parlGovDoc?.seatsByParty as Record<string, number> | undefined) ?? {};
  const totalSeats: number = (parlGovDoc?.totalSeats as number | undefined) ?? 650;
  const totalSeatsSupporting: number =
    (parlGovDoc?.totalSeatsSupporting as number | undefined) ?? 0;
  const majorityThreshold: number = (parlGovDoc?.majorityThreshold as number | undefined) ?? 326;

  // ── 6. Coalition data ─────────────────────────────────────────────────────
  const governingPartyId: string | null =
    (parlGovDoc?.governingPartyId as string | null | undefined) ?? null;

  // coalitionId is a number in the new schema — derive from coalitionAgreement if present
  const coalitionId: number | null = null; // Legacy docs don't track this as a sequentialId

  const coalitionPartyIds: string[] | null =
    (parlGovDoc?.coalitionPartyIds as string[] | null | undefined) ?? null;

  // ── 7. Timeline ───────────────────────────────────────────────────────────
  const formedAt: Date | null =
    (parlGovDoc?.formedAt as Date | null | undefined) ??
    (ukGovDoc?.formedAt as Date | null | undefined) ??
    null;

  const formedTurn: number | null = (parlGovDoc?.formedTurn as number | null | undefined) ?? null;

  const collapsedAt: Date | null = (parlGovDoc?.collapsedAt as Date | null | undefined) ?? null;

  // ── 8. Active vote ────────────────────────────────────────────────────────
  // New system uses pmAppointmentVotes / noConfidenceVotes, not confidenceVotes.
  // Start with no active vote — old-system votes will be cancelled below.
  const activeVoteId: ObjectId | null = null;

  // cycle: use parlGov.cycle if available, else default 1
  const cycle: number = (parlGovDoc?.cycle as number | undefined) ?? 1;

  // ── 9. Build the new document ─────────────────────────────────────────────
  const govFormationDoc: GovernmentFormationDoc = {
    _id: "UK",
    countryId: "UK",
    cycle,
    status,
    formationType,
    lostMajority: (parlGovDoc?.lostMajority as boolean | undefined) ?? false,
    pmCharacterId,
    pmName,
    governingPartyId,
    coalitionId,
    coalitionPartyIds,
    totalSeatsSupporting,
    majorityThreshold,
    seatsByParty,
    totalSeats,
    activeVoteId,
    formedAt,
    formedTurn,
    collapsedAt,
    createdAt: (parlGovDoc?.createdAt as Date | undefined) ?? now,
    updatedAt: now,
  };

  // ── 10. Upsert into governmentFormations ──────────────────────────────────
  const existing = await db
    .collection("governmentFormations")
    .findOne({ _id: "UK" as unknown as object });

  if (existing) {
    console.log("governmentFormations (UK) already exists — updating with migrated data...");
    const { _id, createdAt, ...updateFields } = govFormationDoc;
    void _id;
    void createdAt;
    await db
      .collection("governmentFormations")
      .updateOne({ _id: "UK" as unknown as object }, { $set: { ...updateFields, updatedAt: now } });
    console.log("  Updated.");
  } else {
    console.log("governmentFormations (UK) does not exist — inserting...");
    await db
      .collection("governmentFormations")
      .insertOne(
        govFormationDoc as unknown as import("mongodb").OptionalId<import("mongodb").Document>
      );
    console.log("  Inserted.");
  }

  console.log("\nMigrated governmentFormations (UK):");
  console.log(`  status:          ${status}`);
  console.log(`  formationType:   ${formationType ?? "(none)"}`);
  console.log(`  pmCharacterId:   ${pmCharacterId?.toString() ?? "(none)"}`);
  console.log(`  pmName:          ${pmName ?? "(none)"}`);
  console.log(`  governingPartyId:${governingPartyId ?? "(none)"}`);
  console.log(`  formedAt:        ${formedAt?.toISOString() ?? "(none)"}`);

  // ── 11. Cancel active old-system votes ────────────────────────────────────
  console.log("\nCancelling active old-system votes...");

  // confidenceVotes (countryId: "UK")
  const cvResult = await db
    .collection("confidenceVotes")
    .updateMany(
      { countryId: "UK", status: "active" },
      { $set: { status: "cancelled", updatedAt: now } }
    );
  console.log(`  confidenceVotes cancelled:    ${cvResult.modifiedCount}`);

  // pmNoConfidenceVotes
  const ncResult = await db
    .collection("pmNoConfidenceVotes")
    .updateMany({ status: "active" }, { $set: { status: "cancelled", updatedAt: now } });
  console.log(`  pmNoConfidenceVotes cancelled: ${ncResult.modifiedCount}`);

  // ukConfidenceVotes
  const ukcvResult = await db
    .collection("ukConfidenceVotes")
    .updateMany({ status: "active" }, { $set: { status: "cancelled", updatedAt: now } });
  console.log(`  ukConfidenceVotes cancelled:   ${ukcvResult.modifiedCount}`);

  // ── 12. Summary ───────────────────────────────────────────────────────────
  console.log("\n=== Migration complete ===");
  console.log("Old collections preserved for reference (drop manually when ready):");
  console.log("  db.parliamentaryGovernments.drop()");
  console.log("  db.ukGovernment.drop()");
  console.log("  db.confidenceVotes.drop()");
  console.log("  db.pmNoConfidenceVotes.drop()");
  console.log("  db.ukConfidenceVotes.drop()");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => closeDb());
