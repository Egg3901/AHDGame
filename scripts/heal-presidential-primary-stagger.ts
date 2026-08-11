/**
 * Heal missed presidential primary stagger waves on the live server.
 *
 * Incident:
 * The presidential stagger phase historically depended on an electionVoteTally
 * document that was normally created only after the primary ended. If the tally
 * was missing when the primary entered the T-5..T-0 window, Iowa and later
 * waves silently skipped because the turn phase had nowhere to persist wave
 * history, per-state votes, or delegates.
 *
 * Remediation strategy:
 *  - Dry run by default: audit the live presidential election and report which
 *    due waves are missing.
 *  - In commit mode, initialize the missing tally if needed.
 *  - Preserve any fully-resolved waves/states already present in the tally by
 *    synthesizing missing wave-history entries before replay.
 *  - Re-run the stagger processor at the current live game time so every due
 *    but unresolved wave is caught up in-order.
 *
 * Safety:
 *  - Uses MONGODB_URI_LIVE only, including tally bootstrap writes.
 *  - Refuses to commit if a due wave is partially repaired (some parties in a
 *    state have delegate rows and others do not), because replay would risk
 *    double-awarding delegates for the already-repaired parties.
 *  - Idempotent for fully-resolved waves: reruns skip waves already represented
 *    in wave-history or fully backed by delegate rows.
 *
 * Usage:
 *   npx tsx scripts/heal-presidential-primary-stagger.ts
 *   npx tsx scripts/heal-presidential-primary-stagger.ts --commit
 *   npx tsx scripts/heal-presidential-primary-stagger.ts --commit --election-id <id>
 */

import { MongoClient, ObjectId } from "mongodb";
import type { Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  GameState,
} from "../src/lib/db/types";
import { PRIMARY_WAVES } from "../src/lib/constants/primaryCalendar";
import { initPresidentVoteTally } from "../src/lib/presidentialElectionEngine";
import {
  getDuePrimaryWaveCount,
  processPrimaryStaggerWaves,
} from "../src/lib/turn/primaryStaggerPhase";

const envCandidates = [
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), "..", "..", ".env.local"),
];
for (const envPath of envCandidates) {
  dotenv.config({ path: envPath });
}

const COMMIT = process.argv.includes("--commit");
const electionIdArg = readFlag("--election-id");

interface WaveAudit {
  waveIndex: number;
  label: string;
  states: string[];
  fullyResolvedStates: string[];
  missingStates: string[];
  partialStates: Array<{
    stateId: string;
    resolvedParties: string[];
    missingParties: string[];
  }>;
  hasHistoryEntry: boolean;
}

function readFlag(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function toObjectId(value: string | null): ObjectId | null {
  if (!value) return null;
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function getPartyIdsInRace(candidates: ElectionCandidate[]): string[] {
  return [...new Set(candidates.map((candidate) => candidate.party))];
}

function isStateResolvedForParty(
  tally: ElectionVoteTally | null,
  partyId: string,
  stateId: string
): boolean {
  return Boolean(tally?.primaryDelegatesByState?.[partyId]?.[stateId]);
}

function buildWaveAudit(
  dueWaveCount: number,
  tally: ElectionVoteTally | null,
  candidates: ElectionCandidate[]
): WaveAudit[] {
  const partyIds = getPartyIdsInRace(candidates);
  const historyWaveSet = new Set((tally?.primaryWaveHistory ?? []).map((entry) => entry.wave));
  const audits: WaveAudit[] = [];

  for (let waveIndex = 0; waveIndex < dueWaveCount; waveIndex++) {
    const wave = PRIMARY_WAVES[waveIndex];
    const fullyResolvedStates: string[] = [];
    const missingStates: string[] = [];
    const partialStates: WaveAudit["partialStates"] = [];

    for (const stateId of wave.states) {
      const resolvedParties = partyIds.filter((partyId) =>
        isStateResolvedForParty(tally, partyId, stateId)
      );
      if (resolvedParties.length === 0) {
        missingStates.push(stateId);
      } else if (resolvedParties.length === partyIds.length) {
        fullyResolvedStates.push(stateId);
      } else {
        partialStates.push({
          stateId,
          resolvedParties,
          missingParties: partyIds.filter((partyId) => !resolvedParties.includes(partyId)),
        });
      }
    }

    audits.push({
      waveIndex,
      label: wave.label,
      states: wave.states,
      fullyResolvedStates,
      missingStates,
      partialStates,
      hasHistoryEntry: historyWaveSet.has(waveIndex),
    });
  }

  return audits;
}

function buildHistoryRepair(
  tally: ElectionVoteTally | null,
  audits: WaveAudit[],
  recordedAt: Date
): Array<{ wave: number; turnsRemaining: number; statesVoted: string[]; recordedAt: Date }> {
  const history = [...(tally?.primaryWaveHistory ?? [])].map((entry) => ({
    wave: entry.wave,
    turnsRemaining: entry.turnsRemaining,
    statesVoted: [...entry.statesVoted],
    recordedAt: new Date(entry.recordedAt),
  }));
  const historyByWave = new Map(history.map((entry) => [entry.wave, entry]));

  for (const audit of audits) {
    if (audit.hasHistoryEntry) continue;
    if (audit.fullyResolvedStates.length !== audit.states.length) continue;
    historyByWave.set(audit.waveIndex, {
      wave: audit.waveIndex,
      turnsRemaining: PRIMARY_WAVES[audit.waveIndex].turnsRemaining,
      statesVoted: [...audit.states],
      recordedAt,
    });
  }

  return [...historyByWave.values()].sort((a, b) => a.wave - b.wave);
}

function summarizeWaveAudit(audits: WaveAudit[]): string[] {
  return audits.map((audit) => {
    const parts = [
      `Wave ${audit.waveIndex + 1} ${audit.label}: history=${audit.hasHistoryEntry ? "yes" : "no"}`,
      `resolved=${audit.fullyResolvedStates.length}/${audit.states.length}`,
      `missing=${audit.missingStates.length}`,
      `partial=${audit.partialStates.length}`,
    ];
    return parts.join(" | ");
  });
}

async function loadElection(db: Db, electionId: ObjectId | null): Promise<Election | null> {
  if (electionId) {
    return (await db.collection("elections").findOne({ _id: electionId })) as Election | null;
  }
  const [activeElection] = (await db
    .collection("elections")
    .find({
      electionType: "president",
      status: "active",
    })
    .sort({ primaryEndTime: 1, createdAt: -1 })
    .limit(1)
    .toArray()) as Election[];
  if (activeElection) return activeElection;

  const [upcomingElection] = (await db
    .collection("elections")
    .find({
      electionType: "president",
      status: "upcoming",
    })
    .sort({ startTime: 1, createdAt: -1 })
    .limit(1)
    .toArray()) as Election[];
  return upcomingElection ?? null;
}

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set in .env.local");

  const client = new MongoClient(uri);
  await client.connect();
  console.log(COMMIT ? "=== COMMIT MODE ===" : "=== DRY RUN ===");

  try {
    const db = client.db("a-house-divided");
    const electionObjectId = toObjectId(electionIdArg);
    if (electionIdArg && !electionObjectId) {
      throw new Error(`Invalid --election-id: ${electionIdArg}`);
    }

    const [gameState, election] = await Promise.all([
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
      loadElection(db, electionObjectId),
    ]);

    if (!gameState?.lastTurnProcessed) {
      throw new Error("gameState.lastTurnProcessed missing");
    }
    if (!election) {
      throw new Error("No live presidential election found");
    }
    if (election.electionType !== "president") {
      throw new Error(
        `Election ${election._id.toString()} is ${election.electionType}, not president`
      );
    }

    const now = new Date(gameState.lastTurnProcessed);
    const hoursToEnd = election.primaryEndTime
      ? (new Date(election.primaryEndTime).getTime() - now.getTime()) / 3_600_000
      : Number.NaN;
    const dueWaveCount = Number.isFinite(hoursToEnd) ? getDuePrimaryWaveCount(hoursToEnd) : 0;

    const [candidates, tally] = await Promise.all([
      db
        .collection("electionCandidates")
        .find({ electionId: election._id, status: "active" })
        .toArray() as Promise<ElectionCandidate[]>,
      db
        .collection("electionVoteTallies")
        .findOne({ electionId: election._id }) as Promise<ElectionVoteTally | null>,
    ]);

    const audits = buildWaveAudit(dueWaveCount, tally, candidates);
    const repairedHistory = buildHistoryRepair(tally, audits, now);
    const existingHistoryCount = tally?.primaryWaveHistory?.length ?? 0;
    const synthesizedHistoryEntries = repairedHistory.length - existingHistoryCount;

    console.log(
      `Election: ${election._id.toString()} (cycle ${election.cycle}, status ${election.status})`
    );
    console.log(`Current turn: ${gameState.currentTurn ?? "?"}`);
    console.log(`Primary end: ${election.primaryEndTime?.toISOString() ?? "n/a"}`);
    console.log(`Hours to primary end from lastTurnProcessed: ${hoursToEnd}`);
    console.log(`Due waves: ${dueWaveCount}`);
    console.log(`Active candidates: ${candidates.length}`);
    console.log(`Existing tally: ${tally ? "yes" : "no"}`);
    for (const line of summarizeWaveAudit(audits)) {
      console.log(`  ${line}`);
    }

    const partialStates = audits.flatMap((audit) =>
      audit.partialStates.map((partial) => ({
        waveIndex: audit.waveIndex,
        label: audit.label,
        ...partial,
      }))
    );
    if (partialStates.length > 0) {
      console.log("\nPartial-wave anomalies detected:");
      for (const partial of partialStates) {
        console.log(
          `  Wave ${partial.waveIndex + 1} ${partial.label} / ${partial.stateId}: resolved parties = ${partial.resolvedParties.join(", ")} | missing parties = ${partial.missingParties.join(", ")}`
        );
      }
    }

    const missingDueStates = audits.flatMap((audit) => audit.missingStates);
    console.log(
      `Missing due states: ${missingDueStates.length > 0 ? missingDueStates.join(", ") : "none"}`
    );
    console.log(
      `Synthesizable history entries from already-resolved waves: ${Math.max(0, synthesizedHistoryEntries)}`
    );

    if (!COMMIT) {
      console.log("\n[DRY RUN] No changes made.");
      return;
    }

    if (partialStates.length > 0) {
      throw new Error(
        "Refusing commit: found partially repaired due waves. Resolve those states manually or extend the script for partial per-state replay."
      );
    }

    if (dueWaveCount === 0) {
      console.log("No due presidential primary waves to heal.");
      return;
    }

    if (!tally) {
      await initPresidentVoteTally(election._id, candidates, undefined, db);
      console.log("Initialized missing presidential tally.");
    }

    const historyNeedsRepair =
      repairedHistory.length !== existingHistoryCount ||
      repairedHistory.some((entry, index) => {
        const existing = tally?.primaryWaveHistory?.[index];
        return (
          !existing ||
          existing.wave !== entry.wave ||
          existing.statesVoted.join("|") !== entry.statesVoted.join("|")
        );
      });

    if (historyNeedsRepair) {
      await db.collection("electionVoteTallies").updateOne(
        { electionId: election._id },
        {
          $set: {
            primaryWaveHistory: repairedHistory,
            updatedAt: now,
          },
        }
      );
      console.log(`Repaired wave history with ${repairedHistory.length} total entries.`);
    }

    await processPrimaryStaggerWaves(db, now, gameState.currentTurn ?? 0);

    const finalTally = (await db
      .collection("electionVoteTallies")
      .findOne({ electionId: election._id })) as ElectionVoteTally | null;
    const finalAudits = buildWaveAudit(dueWaveCount, finalTally, candidates);
    const finalMissingStates = finalAudits.flatMap((audit) => audit.missingStates);

    console.log("\nPost-heal summary:");
    console.log(`  Wave history entries: ${finalTally?.primaryWaveHistory?.length ?? 0}`);
    console.log(
      `  Remaining missing due states: ${finalMissingStates.length > 0 ? finalMissingStates.join(", ") : "none"}`
    );
    if (finalMissingStates.length > 0) {
      throw new Error("Heal completed with remaining missing due states");
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
