import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    collection: "nationalPartyElections",
    keys: { countryId: 1, partyId: 1, position: 1 },
    options: {
      name: "unique_voting_national_party_election_per_seat",
      unique: true,
      partialFilterExpression: { status: "voting" },
      background: true,
    },
  },
  {
    collection: "nationalCommitteeElections",
    keys: { countryId: 1, partyId: 1 },
    options: {
      name: "unique_voting_national_committee_election_per_party",
      unique: true,
      partialFilterExpression: { status: "voting" },
      background: true,
    },
  },
  {
    collection: "statePartyElections",
    keys: { countryId: 1, stateId: 1, partyId: 1, position: 1 },
    options: {
      name: "unique_voting_state_party_election_per_seat",
      unique: true,
      partialFilterExpression: { status: "voting" },
      background: true,
    },
  },
];

async function createPlannedIndexes(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  for (const plan of INDEXES) {
    const label = `${plan.collection}.${plan.options.name}`;
    const exists = (
      await db
        .collection(plan.collection)
        .indexes()
        .catch(() => [])
    ).some((index) => index.name === plan.options.name);
    if (exists) {
      notes.push(`${label} already present`);
      continue;
    }
    if (dryRun) {
      notes.push(`would create ${label}`);
      continue;
    }
    await db.collection(plan.collection).createIndex(plan.keys, plan.options);
    notes.push(`created ${label}`);
  }
  return {
    documentsScanned: INDEXES.length,
    documentsUpdated: dryRun ? 0 : notes.filter((note) => note.startsWith("created ")).length,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-09-09-unique-voting-party-elections",
  description:
    "Partial unique indexes so a party cannot have two voting leadership (or committee) races for the same seat. Ticket #1295: an empty duplicate hid the real SED field.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
