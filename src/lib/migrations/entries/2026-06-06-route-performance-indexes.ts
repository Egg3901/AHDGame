import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    collection: "politicalParties",
    keys: { countryId: 1, isDefunct: 1, isDefault: -1, name: 1 },
    options: { name: "politicalParties_country_active_sort", background: true },
  },
  {
    collection: "characters",
    keys: { countryId: 1, party: 1, userId: 1 },
    options: { name: "characters_country_party_user", background: true },
  },
  {
    collection: "users",
    keys: { isBanned: 1 },
    options: { name: "users_isBanned", background: true },
  },
  {
    collection: "npps",
    keys: { countryId: 1, party: 1, retiredAt: 1 },
    options: { name: "npps_country_party_retired", background: true },
  },
  {
    collection: "statePartyOrg",
    keys: { countryId: 1, partyId: 1, organization: 1 },
    options: { name: "statePartyOrg_country_party_org", background: true },
  },
  {
    collection: "partyHistory",
    keys: { countryId: 1, turn: 1, partyId: 1 },
    options: { name: "partyHistory_country_turn_party", background: true },
  },
  {
    collection: "states",
    keys: { countryId: 1 },
    options: { name: "states_countryId", background: true },
  },
  {
    collection: "marketCapHistory",
    keys: { turn: -1 },
    options: { name: "marketCapHistory_turn_desc", background: true },
  },
  {
    collection: "wealthListHistory",
    keys: { exchange: 1, turn: -1 },
    options: { name: "wealthListHistory_exchange_turn_desc", background: true },
  },
  {
    collection: "newsPosts",
    keys: { parentId: 1, createdAt: -1 },
    options: { name: "newsPosts_parent_created_desc", background: true },
  },
  {
    collection: "newsPosts",
    keys: { authorId: 1, parentId: 1, createdAt: -1 },
    options: { name: "newsPosts_author_parent_created_desc", background: true },
  },
  {
    collection: "newsPosts",
    keys: { isSystem: 1, createdAt: -1 },
    options: { name: "newsPosts_system_created_desc", background: true },
  },
  {
    collection: "newsReactions",
    keys: { userId: 1, postId: 1 },
    options: { name: "newsReactions_user_post", background: true },
  },
  {
    collection: "wireEvents",
    keys: { timestamp: -1 },
    options: { name: "wireEvents_timestamp_desc", background: true },
  },
  {
    collection: "corporateSectors",
    keys: { stateId: 1, sectorType: 1 },
    options: { name: "corporateSectors_state_sectorType", background: true },
  },
  {
    collection: "corporateSectors",
    keys: { corporationId: 1, stateId: 1 },
    options: { name: "corporateSectors_corporation_state", background: true },
  },
  {
    collection: "unownedSectors",
    keys: { stateId: 1, sectorType: 1 },
    options: { name: "unownedSectors_state_sectorType", background: true },
  },
];

async function createPlannedIndexes(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];

  for (const plan of INDEXES) {
    const label = `${plan.collection}.${plan.options.name}`;
    if (dryRun) {
      notes.push(`would create ${label}`);
      continue;
    }

    await db.collection(plan.collection).createIndex(plan.keys, plan.options);
    notes.push(`created/verified ${label}`);
  }

  return {
    documentsScanned: INDEXES.length,
    documentsUpdated: dryRun ? 0 : INDEXES.length,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-06-06-route-performance-indexes",
  description: "Create indexes for slow parties, news, stock-market, metrics, and sector routes.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
