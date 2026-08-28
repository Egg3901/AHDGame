import type { Db, Document, Filter } from "mongodb";
import type { Migration, MigrationResult } from "../types";

const COUNTRY_IDS = ["FR", "IT", "ES", "SE", "TR", "AT", "FI", "GR", "BR", "NG"];
const VOTE_TURNS = 24;
const EXECUTIVE_TURNS = 10;
const REPAIR_MARKER = 996;
const HOUR_MS = 60 * 60 * 1000;

interface RepairStage {
  status: string;
  deadlineTurnField: string;
  deadlineDateField: string;
  set: (now: Date, currentTurn: number) => Record<string, unknown>;
}

const REPAIR_STAGES: RepairStage[] = [
  {
    status: "active",
    deadlineTurnField: "votingEndsOnTurn",
    deadlineDateField: "votingEndsAt",
    set: (now, currentTurn) => ({
      votingStartedAt: now,
      votingEndsAt: new Date(now.getTime() + VOTE_TURNS * HOUR_MS),
      votingEndsOnTurn: currentTurn + VOTE_TURNS,
    }),
  },
  {
    status: "active_other",
    deadlineTurnField: "otherChamberVotingEndsOnTurn",
    deadlineDateField: "otherChamberVotingEndsAt",
    set: (now, currentTurn) => ({
      otherChamberVotingStartedAt: now,
      otherChamberVotingEndsAt: new Date(now.getTime() + VOTE_TURNS * HOUR_MS),
      otherChamberVotingEndsOnTurn: currentTurn + VOTE_TURNS,
    }),
  },
  {
    status: "active_both",
    deadlineTurnField: "votingEndsOnTurn",
    deadlineDateField: "votingEndsAt",
    set: (now, currentTurn) => ({
      votingStartedAt: now,
      votingEndsAt: new Date(now.getTime() + VOTE_TURNS * HOUR_MS),
      votingEndsOnTurn: currentTurn + VOTE_TURNS,
      otherChamberVotingStartedAt: now,
      otherChamberVotingEndsAt: new Date(now.getTime() + VOTE_TURNS * HOUR_MS),
      otherChamberVotingEndsOnTurn: currentTurn + VOTE_TURNS,
    }),
  },
  {
    status: "enrolled",
    deadlineTurnField: "presidentActionDeadlineOnTurn",
    deadlineDateField: "presidentActionDeadline",
    set: (now, currentTurn) => ({
      presidentActionDeadline: new Date(now.getTime() + EXECUTIVE_TURNS * HOUR_MS),
      presidentActionDeadlineOnTurn: currentTurn + EXECUTIVE_TURNS,
    }),
  },
  {
    status: "cabinet_review",
    deadlineTurnField: "votingEndsOnTurn",
    deadlineDateField: "votingEndsAt",
    set: (now, currentTurn) => ({
      votingStartedAt: now,
      votingEndsAt: new Date(now.getTime() + VOTE_TURNS * HOUR_MS),
      votingEndsOnTurn: currentTurn + VOTE_TURNS,
    }),
  },
  {
    status: "override_shugiin",
    deadlineTurnField: "votingEndsOnTurn",
    deadlineDateField: "votingEndsAt",
    set: (now, currentTurn) => ({
      votingStartedAt: now,
      votingEndsAt: new Date(now.getTime() + VOTE_TURNS * HOUR_MS),
      votingEndsOnTurn: currentTurn + VOTE_TURNS,
    }),
  },
  {
    status: "veto_override",
    deadlineTurnField: "overrideVotingEndsOnTurn",
    deadlineDateField: "overrideVotingEndsAt",
    set: (now, currentTurn) => ({
      overrideVotingStartedAt: now,
      overrideVotingEndsAt: new Date(now.getTime() + VOTE_TURNS * HOUR_MS),
      overrideVotingEndsOnTurn: currentTurn + VOTE_TURNS,
    }),
  },
];

function expiredFilter(stage: RepairStage, currentTurn: number, now: Date): Filter<Document> {
  return {
    countryId: { $in: COUNTRY_IDS },
    status: stage.status,
    lifecycleRepairIssue: { $ne: REPAIR_MARKER },
    $or: [
      { [stage.deadlineTurnField]: { $lte: currentTurn } },
      {
        [stage.deadlineTurnField]: { $exists: false },
        [stage.deadlineDateField]: { $lte: now },
      },
    ],
  };
}

async function rescheduleStrandedBills(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const gameState = await db
    .collection<{ _id: string; currentTurn: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  const currentTurn = gameState?.currentTurn ?? 1;
  const now = new Date();
  let scanned = 0;
  let updated = 0;
  const notes: string[] = [];

  for (const stage of REPAIR_STAGES) {
    const filter = expiredFilter(stage, currentTurn, now);
    const matches = await db.collection<Document>("bills").countDocuments(filter);
    scanned += matches;
    if (matches === 0) continue;
    notes.push(`${stage.status}: ${matches} bill(s) ${dryRun ? "would be" : "were"} rescheduled`);
    if (dryRun) continue;
    const result = await db.collection<Document>("bills").updateMany(filter, {
      $set: {
        ...stage.set(now, currentTurn),
        lifecycleRepairIssue: REPAIR_MARKER,
        lifecycleRepairedAt: now,
        updatedAt: now,
      },
    });
    updated += result.modifiedCount;
  }

  return {
    documentsScanned: scanned,
    documentsUpdated: updated,
    notes: [
      ...notes,
      "Existing votes are retained and receive a fresh window so legislators can revise them before closure.",
    ],
  };
}

export const migration: Migration = {
  id: "2026-08-27-reschedule-econ-country-bills",
  description:
    "Issue #996: reopen expired nonterminal bills in econ-only countries after registering their national lifecycle engines.",
  idempotent: true,
  execute: (db, ctx) => rescheduleStrandedBills(db, ctx.dryRun),
};
