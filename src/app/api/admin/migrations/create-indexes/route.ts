// POST /api/admin/migrations/create-indexes â€” Create all missing database indexes.
// Auth: requireAdmin
// Errors: 400, 401, 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { CreateIndexesOptions, IndexSpecification } from "mongodb";

const MIGRATION_ID = "create-indexes-v3";

interface MigrationRecord {
  _id: string;
  completedAt: Date;
  result?: string;
}

/** All indexes to create. Each entry: [collection, keySpec, options?] */
export const INDEX_DEFINITIONS: [string, IndexSpecification, CreateIndexesOptions?][] = [
  // Tier 1 â€” Critical (every page load)
  ["elections", { status: 1, electionType: 1, countryId: 1 }],
  ["elections", { seatId: 1, cycle: 1 }],
  ["electionCandidates", { characterId: 1, status: 1 }],
  ["electionCandidates", { nppId: 1 }],
  ["cabinetMembers", { characterId: 1 }],
  ["bonds", { "holders.characterId": 1, matured: 1, defaulted: 1 }],
  ["bonds", { issuerType: 1, countryId: 1, matured: 1 }],
  ["corporations", { "shareholders.characterId": 1 }],
  ["politicalParties", { countryId: 1, sequentialId: 1 }, { unique: true }],

  // Tier 2 â€” Turn processing & frequent pages
  ["stateDemographics", { countryId: 1 }],
  ["statePolicies", { stateId: 1 }],
  ["portfolioHistory", { characterId: 1 }],
  ["bondHistory", { bondId: 1 }],
  ["corporationPortfolioHistory", { corporationId: 1 }],
  ["nppInfluenceAttempts", { characterId: 1, turn: 1 }],
  ["nationalPartyElections", { status: 1, partyId: 1 }],
  ["wealthListHistory", { exchange: 1, turn: 1 }],
  ["imperialCharacters", { userId: 1 }],
  [
    "electionCandidates",
    { characterId: 1 },
    {
      unique: true,
      partialFilterExpression: { status: "active" },
      name: "unique_active_election_candidate_per_character",
    },
  ],
  [
    "statePartyCandidates",
    { stateId: 1, partyId: 1, characterId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        status: "active",
        stateId: { $exists: true },
        partyId: { $exists: true },
      },
      name: "unique_active_state_party_candidate_per_member",
    },
  ],
  [
    "nationalPartyCandidates",
    { partyId: 1, characterId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        status: "active",
        partyId: { $exists: true },
      },
      name: "unique_active_national_party_candidate_per_member",
    },
  ],
  [
    "nationalCommitteeCandidates",
    { partyId: 1, characterId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        status: "active",
        partyId: { $exists: true },
      },
      name: "unique_active_national_committee_candidate_per_member",
    },
  ],
  [
    "playerEndorsements",
    { characterId: 1, electionId: 1 },
    {
      unique: true,
      partialFilterExpression: { isActive: true },
      name: "unique_active_player_endorsement_per_election",
    },
  ],
  [
    "nationalPartyVotes",
    { electionId: 1, voterId: 1 },
    {
      unique: true,
      name: "unique_national_party_vote_per_voter",
    },
  ],
  [
    "statePartyVotes",
    { electionId: 1, voterId: 1 },
    {
      unique: true,
      name: "unique_state_party_vote_per_voter",
    },
  ],
  [
    "nationalCommitteeVotes",
    { electionId: 1, voterId: 1 },
    {
      unique: true,
      name: "unique_national_committee_vote_per_voter",
    },
  ],
  [
    "shareOffers",
    { listingId: 1, buyerCharacterId: 1 },
    {
      unique: true,
      partialFilterExpression: { status: "pending" },
      name: "unique_pending_share_offer_per_buyer_listing",
    },
  ],
  [
    "cabinetNominations",
    { countryId: 1, positionId: 1 },
    {
      unique: true,
      partialFilterExpression: { status: "active" },
      name: "unique_active_cabinet_nomination_per_position",
    },
  ],
  [
    "speakerLeadershipBallots",
    { voterCharacterId: 1 },
    {
      unique: true,
      name: "unique_speaker_ballot_per_voter",
    },
  ],
  [
    "houseLeadershipBallots",
    { role: 1, voterCharacterId: 1 },
    {
      unique: true,
      name: "unique_house_leadership_ballot_per_voter",
    },
  ],
  [
    "senateLeadershipBallots",
    { role: 1, voterCharacterId: 1 },
    {
      unique: true,
      name: "unique_senate_leadership_ballot_per_voter",
    },
  ],
  // At most one ACTIVE nomination per (role, nominee) — backstops the idempotent
  // incumbent auto-nomination against the non-transactional multi-call-site race
  // that produced duplicate nominations (ticket #959). Partial so the many
  // historical failed/confirmed duplicates don't block the build.
  [
    "houseLeadershipNominations",
    { role: 1, nomineeId: 1 },
    {
      unique: true,
      partialFilterExpression: { status: { $in: ["open", "voting"] } },
      name: "unique_active_house_leadership_nomination_per_nominee",
    },
  ],
  [
    "senateLeadershipNominations",
    { role: 1, nomineeId: 1 },
    {
      unique: true,
      partialFilterExpression: { status: { $in: ["open", "voting"] } },
      name: "unique_active_senate_leadership_nomination_per_nominee",
    },
  ],
  [
    "corporationCeoVotes",
    { corporationId: 1, voterCharacterId: 1 },
    {
      unique: true,
      name: "unique_corporation_ceo_vote_per_shareholder",
    },
  ],
  [
    "organizationLeadershipElections",
    { organizationId: 1 },
    {
      unique: true,
      partialFilterExpression: { status: "pending" },
      name: "unique_pending_org_leadership_election_per_org",
    },
  ],
  [
    "organizationMembershipProposals",
    { organizationId: 1, proposingCountryId: 1 },
    {
      unique: true,
      partialFilterExpression: { status: "pending" },
      name: "unique_pending_org_membership_proposal_per_country",
    },
  ],

  // Tier 3 â€” Admin & infrastructure
  ["electionCandidates", { characterId: 1, electionId: 1 }],
  ["retiredCharacters", { userId: 1 }],
  ["retiredCharacters", { characterId: 1 }],
];

/**
 * Build a deterministic index name from the key spec.
 * e.g. { status: 1, electionType: 1 } -> "status_1_electionType_1"
 */
export function indexName(key: IndexSpecification): string {
  return Object.entries(key as Record<string, number>)
    .map(([k, v]) => `${k}_${v}`)
    .join("_");
}

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Idempotent guard
    const existing = await db
      .collection<MigrationRecord>("migrations")
      .findOne({ _id: MIGRATION_ID });

    if (existing) {
      return NextResponse.json(
        { error: "Migration already completed", completedAt: existing.completedAt.toISOString() },
        { status: 400 }
      );
    }

    // Pre-flight: check for duplicate (countryId, sequentialId) pairs in politicalParties
    // before attempting the unique index, which would hard-fail on duplicates.
    const dupes = await db
      .collection("politicalParties")
      .aggregate([
        {
          $group: {
            _id: { countryId: "$countryId", sequentialId: "$sequentialId" },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();

    if (dupes.length > 0) {
      const dupeDetails = dupes.map(
        (d) => `${d._id.countryId}:${d._id.sequentialId} (${d.count}x)`
      );
      return NextResponse.json(
        {
          error:
            "Cannot create unique index on politicalParties â€” duplicate (countryId, sequentialId) pairs found",
          duplicates: dupeDetails,
        },
        { status: 400 }
      );
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const [collection, key, options] of INDEX_DEFINITIONS) {
      try {
        await db.collection(collection).createIndex(key, options ?? {});
        created++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: number }).code;
        // Code 86 = IndexOptionsConflict (same key, different options like unique vs non-unique).
        // This is a real failure â€” the desired index was NOT created. Don't swallow it.
        if (msg.includes("already exists") && code !== 86) {
          skipped++;
        } else {
          failed++;
          errors.push(`${collection} ${indexName(key)}: ${msg}`);
        }
      }
    }

    const result = `Created ${created}, skipped ${skipped} (already exist), failed ${failed} of ${INDEX_DEFINITIONS.length} indexes.${errors.length ? " Errors: " + errors.join("; ") : ""}`;

    // Only record migration as complete when all indexes succeeded or were skipped.
    // Partial failures leave the migration re-runnable.
    if (failed > 0) {
      return NextResponse.json({
        success: false,
        created,
        skipped,
        failed,
        errors,
        message: result + " Migration NOT recorded â€” fix errors and re-run.",
      });
    }

    await db.collection<MigrationRecord>("migrations").insertOne({
      _id: MIGRATION_ID,
      completedAt: new Date(),
      result,
    });

    return NextResponse.json({ success: true, created, skipped, failed, errors, message: result });
  } catch (error) {
    return handleRouteError(error);
  }
}
