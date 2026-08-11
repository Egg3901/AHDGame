/**
 * Migration: Add MongoDB indexes for the party-npp-rework collections.
 *
 * The Phase 1-9 work introduced several new collections and query paths. This
 * migration adds indexes for the hot reads identified during the branch audit.
 *
 * Idempotent: re-running is safe. If an older index with the same name exists
 * but has the wrong definition, it is replaced in place.
 */

import type { ObjectId } from "mongodb";
import { closeDb, connectDb } from "../../utils/db";

type IndexOptions = {
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: Record<string, unknown>;
};

const SLATE_STATUS_PRIORITY: Record<string, number> = {
  filed: 6,
  accepted: 5,
  considering: 4,
  invited: 3,
  declined: 2,
  withdrawn: 1,
};

type DedupeCandidateRow = {
  _id: ObjectId;
  slateId: ObjectId;
  candidateId: ObjectId;
  status?: string;
  updatedAt?: Date;
  createdAt?: Date;
};

type ActiveCaucusElectionRow = {
  _id: ObjectId;
  caucusId: ObjectId;
  updatedAt?: Date;
  createdAt?: Date;
};

async function migrate() {
  const isDryRun = process.argv.includes("--dry-run");

  console.log(`Adding party-npp-rework indexes${isDryRun ? " (dry run)" : ""}...`);
  const db = await connectDb();

  const results: string[] = [];

  async function getIndexesSafe(collection: string) {
    try {
      return await db.collection(collection).indexes();
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "codeName" in err &&
        err.codeName === "NamespaceNotFound"
      ) {
        return [];
      }
      throw err;
    }
  }

  async function dropLegacyIndex(collection: string, name: string) {
    const col = db.collection(collection);
    const existing = (await getIndexesSafe(collection)).find((index) => index.name === name);
    if (!existing) return;

    if (isDryRun) {
      results.push(`~ ${collection}.${name} (would remove legacy index)`);
      return;
    }

    await col.dropIndex(name);
    results.push(`~ ${collection}.${name} (removed legacy index)`);
  }

  async function dedupeActiveCaucusChairElections() {
    const col = db.collection<ActiveCaucusElectionRow>("caucusChairElections");
    const rows = await col.find({ status: "voting" }).toArray();
    if (rows.length === 0) return;

    const byCaucus = new Map<string, ActiveCaucusElectionRow[]>();
    for (const row of rows) {
      const key = String(row.caucusId);
      const current = byCaucus.get(key) ?? [];
      current.push(row);
      byCaucus.set(key, current);
    }

    const duplicateIds: ObjectId[] = [];
    for (const group of byCaucus.values()) {
      if (group.length <= 1) continue;
      group.sort((a, b) => {
        const updatedDiff = (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0);
        if (updatedDiff !== 0) return updatedDiff;
        const createdDiff = (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
        if (createdDiff !== 0) return createdDiff;
        return String(b._id).localeCompare(String(a._id));
      });
      duplicateIds.push(...group.slice(1).map((row) => row._id));
    }

    if (duplicateIds.length === 0) return;

    if (isDryRun) {
      results.push(
        `~ caucusChairElections active duplicates would be cancelled: ${duplicateIds.length}`
      );
      return;
    }

    await col.updateMany(
      { _id: { $in: duplicateIds } },
      { $set: { status: "cancelled", updatedAt: new Date() } }
    );
    results.push(`~ caucusChairElections active duplicates cancelled: ${duplicateIds.length}`);
  }

  async function dedupeSlateCandidatesPerSlateCandidate() {
    const col = db.collection<DedupeCandidateRow>("slateCandidates");
    const rows = await col.find({}).toArray();
    if (rows.length === 0) return;

    const bySlateCandidate = new Map<string, DedupeCandidateRow[]>();
    for (const row of rows) {
      const key = `${String(row.slateId)}:${String(row.candidateId)}`;
      const current = bySlateCandidate.get(key) ?? [];
      current.push(row);
      bySlateCandidate.set(key, current);
    }

    const duplicateIds: ObjectId[] = [];
    for (const group of bySlateCandidate.values()) {
      if (group.length <= 1) continue;
      group.sort((a, b) => {
        const rankDiff =
          (SLATE_STATUS_PRIORITY[b.status ?? "withdrawn"] ?? 0) -
          (SLATE_STATUS_PRIORITY[a.status ?? "withdrawn"] ?? 0);
        if (rankDiff !== 0) return rankDiff;
        const updatedDiff = (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0);
        if (updatedDiff !== 0) return updatedDiff;
        const createdDiff = (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
        if (createdDiff !== 0) return createdDiff;
        return String(b._id).localeCompare(String(a._id));
      });
      duplicateIds.push(...group.slice(1).map((row) => row._id));
    }

    if (duplicateIds.length === 0) return;

    if (isDryRun) {
      results.push(
        `~ slateCandidates duplicate slate/candidate rows would be removed: ${duplicateIds.length}`
      );
      return;
    }

    await col.deleteMany({ _id: { $in: duplicateIds } });
    results.push(
      `~ slateCandidates duplicate slate/candidate rows removed: ${duplicateIds.length}`
    );
  }

  async function ensure(
    collection: string,
    key: Record<string, 1 | -1>,
    name: string,
    opts: IndexOptions = {}
  ) {
    const col = db.collection(collection);

    try {
      const existing = (await getIndexesSafe(collection)).find((index) => index.name === name);
      if (existing) {
        const sameKey = JSON.stringify(existing.key) === JSON.stringify(key);
        const sameUnique = Boolean(existing.unique) === Boolean(opts.unique);
        const sameSparse = Boolean(existing.sparse) === Boolean(opts.sparse);
        const samePartial =
          JSON.stringify(existing.partialFilterExpression ?? null) ===
          JSON.stringify(opts.partialFilterExpression ?? null);

        if (sameKey && sameUnique && sameSparse && samePartial) {
          results.push(`= ${collection}.${name} (already exists)`);
          return;
        }

        if (isDryRun) {
          results.push(`~ ${collection}.${name} (would replace legacy definition)`);
          return;
        }

        await col.dropIndex(name);
        results.push(`~ ${collection}.${name} (replaced legacy definition)`);
      }

      if (isDryRun) {
        results.push(`+ ${collection}.${name} (would create)`);
        return;
      }

      await col.createIndex(key, { name, ...opts });
      results.push(`+ ${collection}.${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        results.push(`= ${collection}.${name} (already exists)`);
      } else {
        results.push(`x ${collection}.${name}: ${msg}`);
      }
    }
  }

  // Phase 1-2 - Caucuses
  await ensure("caucuses", { countryId: 1, partyId: 1, slug: 1 }, "caucuses_country_party_slug");
  await ensure(
    "caucuses",
    { countryId: 1, partyId: 1, disbandedAt: 1 },
    "caucuses_country_party_disbandedAt"
  );
  await ensure(
    "caucuses",
    { countryId: 1, partyId: 1, previousSlugs: 1 },
    "caucuses_country_party_previousSlugs"
  );
  await ensure(
    "caucuses",
    { countryId: 1, partyId: 1, chairId: 1 },
    "caucuses_country_party_chairId"
  );

  await ensure(
    "caucusMemberships",
    { caucusId: 1, status: 1, memberType: 1 },
    "caucusMemberships_caucus_status_memberType"
  );
  await ensure("caucusMemberships", { memberId: 1, status: 1 }, "caucusMemberships_member_status");

  await ensure(
    "caucusPolicyPositions",
    { caucusId: 1, sortOrder: 1 },
    "caucusPolicyPositions_caucus_sortOrder"
  );
  await ensure(
    "caucusChairElections",
    { caucusId: 1, status: 1 },
    "caucusChairElections_caucus_status"
  );
  await dedupeActiveCaucusChairElections();
  await ensure(
    "caucusChairElections",
    { caucusId: 1 },
    "caucusChairElections_one_active_per_caucus",
    {
      unique: true,
      partialFilterExpression: { status: "voting" },
    }
  );
  await ensure(
    "caucusChairElections",
    { status: 1, endTurn: 1 },
    "caucusChairElections_status_endTurn"
  );
  await ensure(
    "caucusChairCandidates",
    { electionId: 1, characterId: 1 },
    "caucusChairCandidates_election_character",
    { unique: true }
  );
  await ensure(
    "caucusChairCandidates",
    { electionId: 1, status: 1 },
    "caucusChairCandidates_election_status"
  );
  await ensure(
    "caucusChairVotes",
    { electionId: 1, voterId: 1 },
    "caucusChairVotes_election_voter",
    { unique: true }
  );
  await ensure(
    "caucusChairVotes",
    { electionId: 1, candidateId: 1 },
    "caucusChairVotes_election_candidate"
  );

  // Phase 4 - Cross-pressure predictions
  // Federal and local bill predictions share the same collection, so they need
  // separate partial unique indexes. This avoids local stateBillId rows
  // colliding under the federal { nppId, billId } uniqueness rule.
  await ensure("nppVotePredictions", { nppId: 1, billId: 1 }, "nppVotePredictions_npp_bill", {
    unique: true,
    partialFilterExpression: { billId: { $exists: true } },
  });
  await ensure(
    "nppVotePredictions",
    { nppId: 1, stateBillId: 1 },
    "nppVotePredictions_npp_stateBill",
    {
      unique: true,
      partialFilterExpression: { stateBillId: { $exists: true } },
    }
  );
  await ensure("nppVotePredictions", { billId: 1 }, "nppVotePredictions_bill");
  await ensure("nppVotePredictions", { stateBillId: 1 }, "nppVotePredictions_stateBill");
  await ensure(
    "nppVotePredictions",
    { nppId: 1, computedAtTurn: -1, updatedAt: -1 },
    "nppVotePredictions_npp_turn"
  );
  await ensure("nppVotePredictions", { computedAtTurn: -1 }, "nppVotePredictions_computedAtTurn");
  await ensure(
    "nppEndorsements",
    { isActive: 1, electionId: 1, createdAt: -1 },
    "nppEndorsements_active_election_createdAt"
  );
  await ensure(
    "nppEndorsements",
    { nppId: 1, isActive: 1, createdAt: -1 },
    "nppEndorsements_npp_active_createdAt"
  );
  await ensure(
    "nppEndorsements",
    { electionId: 1, candidateId: 1, isActive: 1 },
    "nppEndorsements_election_candidate_active"
  );

  // Phase 7 - Political Capital
  await ensure(
    "politicalCapitalBalances",
    { characterId: 1 },
    "politicalCapitalBalances_characterId",
    { unique: true }
  );
  await ensure(
    "capitalActionLogs",
    { characterId: 1, turn: -1 },
    "capitalActionLogs_character_turn"
  );
  await ensure("capitalActionLogs", { nppId: 1, turn: -1 }, "capitalActionLogs_npp_turn");
  await ensure("nppVoteCommitments", { nppId: 1, billId: 1 }, "nppVoteCommitments_npp_bill");
  await ensure("nppVoteCommitments", { characterId: 1 }, "nppVoteCommitments_characterId");

  // Phase 6 - Recruitment slates
  // Earlier branch revisions used a globally unique electionId index, which is
  // incompatible with one slate per (countryId, partyId, electionId). Drop it
  // first so rerunning this migration repairs staging/live safely.
  await dropLegacyIndex("recruitmentSlates", "recruitmentSlates_electionId");
  await ensure(
    "recruitmentSlates",
    { countryId: 1, partyId: 1, archivedAt: 1 },
    "recruitmentSlates_country_party_archivedAt"
  );
  await ensure(
    "recruitmentSlates",
    { countryId: 1, partyId: 1, electionId: 1 },
    "recruitmentSlates_party_election",
    {
      unique: true,
    }
  );
  await ensure(
    "recruitmentSlates",
    { countryId: 1, partyId: 1, state: 1 },
    "recruitmentSlates_country_party_state"
  );
  await ensure(
    "recruitmentSlates",
    { countryId: 1, partyId: 1, state: 1, electionType: 1, updatedAt: -1 },
    "recruitmentSlates_template_lookup"
  );
  await dedupeSlateCandidatesPerSlateCandidate();
  await ensure("slateCandidates", { slateId: 1 }, "slateCandidates_slateId");
  await ensure(
    "slateCandidates",
    { slateId: 1, candidateId: 1 },
    "slateCandidates_slate_candidate",
    { unique: true }
  );
  await ensure("slateCandidates", { electionId: 1, status: 1 }, "slateCandidates_election_status");
  await ensure("slateCandidates", { candidateId: 1 }, "slateCandidates_candidateId");
  await ensure(
    "slateCandidates",
    { countryId: 1, partyId: 1, updatedAt: -1 },
    "slateCandidates_country_party_updatedAt"
  );
  await ensure("slateCandidates", { status: 1, candidateType: 1 }, "slateCandidates_status_type");

  // Phase 8 - Treasury transactions
  await ensure(
    "treasuryTransactions",
    { countryId: 1, partyId: 1, createdAt: -1 },
    "treasuryTransactions_country_party_createdAt"
  );
  await ensure(
    "treasuryTransactions",
    { holderType: 1, holderId: 1, createdAt: -1 },
    "treasuryTransactions_holder_createdAt"
  );

  console.log(results.join("\n"));
  console.log("\nDone.");
  await closeDb();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
