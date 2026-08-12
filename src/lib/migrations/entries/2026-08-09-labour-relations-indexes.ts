import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    collection: "bargainingCampaigns",
    keys: { unionId: 1, employerCorporationId: 1 },
    options: {
      name: "unique_open_bargaining_campaign_per_union_employer",
      unique: true,
      // MongoDB partial indexes reject $exists: false (prod 8.0 refused the
      // original endedAtTurn spec). Open means status negotiating or dispute;
      // every closed status also stamps endedAtTurn, so the semantics match.
      partialFilterExpression: { status: { $in: ["negotiating", "dispute"] } },
      background: true,
    },
  },
  {
    collection: "bargainingCampaigns",
    keys: { unionId: 1, status: 1, updatedAt: -1 },
    options: { name: "bargaining_campaigns_union_status", background: true },
  },
  {
    collection: "bargainingCampaigns",
    keys: { employerCorporationId: 1, status: 1, updatedAt: -1 },
    options: { name: "bargaining_campaigns_employer_status", background: true },
  },
  {
    collection: "bargainingCampaigns",
    keys: { status: 1, escalationLevel: 1 },
    options: { name: "bargaining_campaigns_industrial_action", background: true },
  },
  {
    collection: "bargainingCampaigns",
    keys: { status: 1, "mediation.status": 1, "mediation.expiresAtTurn": 1 },
    options: { name: "bargaining_campaigns_mediation_expiry", background: true },
  },
  {
    collection: "bargainingCampaigns",
    keys: { status: 1, endedAtTurn: 1 },
    options: { name: "bargaining_campaigns_recent_outcomes", background: true },
  },
  {
    collection: "collectiveAgreements",
    keys: { campaignId: 1 },
    options: {
      name: "unique_collective_agreement_per_campaign",
      unique: true,
      background: true,
    },
  },
  {
    collection: "collectiveAgreements",
    keys: { unionId: 1, status: 1, expiresAtTurn: 1 },
    options: { name: "collective_agreements_union_active", background: true },
  },
  {
    collection: "collectiveAgreements",
    keys: { employerCorporationId: 1, status: 1, expiresAtTurn: 1 },
    options: { name: "collective_agreements_employer_active", background: true },
  },
  {
    collection: "collectiveAgreements",
    keys: { sectorIds: 1, status: 1, expiresAtTurn: 1 },
    options: { name: "collective_agreements_sector_active", background: true },
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
  id: "2026-08-09-labour-relations-indexes",
  description:
    "Uniqueness and active-read indexes for bargaining campaigns and collective agreements.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
