/** Standing election reports preserve stored outcomes and expose missing resolver or person history. */
import type { Db, ObjectId } from "mongodb";
import { summarizeElectionTurnover } from "./rules/electionTurnover";
import {
  storedTurnoverCycle,
  type ElectionRecord,
  type CandidateRecord,
  type TallyRecord,
  type SnapshotRecord,
} from "./rules/electionTurnoverRecords";
type ElectionRow = Omit<ElectionRecord, "_id"> & { _id: ObjectId; status: string };
type CandidateRow = Omit<CandidateRecord, "_id" | "electionId" | "characterId" | "nppId"> & {
  _id: ObjectId;
  electionId: ObjectId;
  characterId?: ObjectId;
  nppId?: ObjectId;
};
type TallyRow = Omit<TallyRecord, "electionId"> & { electionId: ObjectId };
type SnapshotRow = Omit<SnapshotRecord, "electionId"> & { electionId: ObjectId };
export async function collectElectionTurnoverReport(db: Db) {
  const elections = await db
    .collection<ElectionRow>("elections")
    .find(
      { status: "resolved", electionType: { $nin: ["president", "vicePresident"] } },
      {
        projection: {
          _id: 1,
          countryId: 1,
          electionType: 1,
          state: 1,
          seatId: 1,
          senateClass: 1,
          chamberClass: 1,
          cycle: 1,
          totalSeats: 1,
          endTurn: 1,
        },
      }
    )
    .toArray();
  const ids = elections.map((election) => election._id);
  const [tallies, candidates, snapshots, history, gameState, config, runs, seedDiagnostics] =
    await Promise.all([
      db
        .collection<TallyRow>("electionVoteTallies")
        .find(
          { electionId: { $in: ids } },
          {
            projection: {
              electionId: 1,
              finalized: 1,
              seatsEstimate: 1,
              totalVotes: 1,
              candidateParties: 1,
              resolutionPath: 1,
              resolvedAtTurn: 1,
              resolvedSeatHolders: 1,
              resolvedTotalSeats: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<CandidateRow>("electionCandidates")
        .find(
          { electionId: { $in: ids } },
          { projection: { electionId: 1, party: 1, isNPP: 1, characterId: 1, nppId: 1 } }
        )
        .toArray(),
      db
        .collection<SnapshotRow>("electionResultSnapshots")
        .find(
          { electionId: { $in: ids } },
          {
            projection: {
              electionId: 1,
              "summary.projectedWinner": 1,
              "candidates.id": 1,
              "candidates.party": 1,
              "candidates.isNPP": 1,
            },
          }
        )
        .toArray(),
      db
        .collection("parliamentSeatsHistory")
        .aggregate([
          { $match: { officeType: { $nin: ["president", "vicePresident"] } } },
          {
            $group: {
              _id: { countryId: "$countryId", officeType: "$officeType" },
              partyRows: { $sum: 1 },
              firstTurn: { $min: "$turn" },
              lastTurn: { $max: "$turn" },
              holderRows: {
                $sum: { $cond: [{ $ne: [{ $ifNull: ["$executiveHolder", null] }, null] }, 1, 0] },
              },
            },
          },
          { $sort: { "_id.countryId": 1, "_id.officeType": 1 } },
        ])
        .toArray(),
      db.collection("gameState").findOne(
        { _id: "current" as never },
        {
          projection: {
            preset: 1,
            currentTurn: 1,
            currentYear: 1,
            redistrictingEnabled: 1,
            nppAutonomyLevel: 1,
            nppAutonomyEnabled: 1,
          },
        }
      ),
      db
        .collection("gameConfig")
        .findOne(
          { _id: "default" as never },
          { projection: { preset: 1, redistrictingEnabled: 1 } }
        ),
      db
        .collection("simRuns")
        .find(
          {},
          {
            projection: {
              _id: 0,
              runId: 1,
              preset: 1,
              seed: 1,
              "source.requestedCommit": 1,
              "source.executedCommit": 1,
              actorMode: 1,
              featureManifest: 1,
            },
          }
        )
        .sort({ startedAt: -1 })
        .limit(1)
        .toArray(),
      db
        .collection("seedDiagnostics")
        .find(
          { mode: "conformance", trigger: "worldsim-post-bootstrap" },
          { projection: { _id: 0, featureManifest: 1 } }
        )
        .sort({ ranAt: -1 })
        .limit(1)
        .toArray(),
    ]);
  const byTally = new Map(tallies.map((row) => [String(row.electionId), row]));
  const bySnapshot = new Map(snapshots.map((row) => [String(row.electionId), row]));
  const byCandidate = new Map<string, CandidateRow[]>();
  for (const row of candidates) {
    const id = String(row.electionId);
    byCandidate.set(id, [...(byCandidate.get(id) ?? []), row]);
  }
  const cycles = elections.map((election) => {
    const id = String(election._id),
      tally = byTally.get(id),
      snapshot = bySnapshot.get(id);
    return storedTurnoverCycle(
      { ...election, _id: id },
      tally ? { ...tally, electionId: id } : undefined,
      (byCandidate.get(id) ?? []).map((row) => ({
        ...row,
        _id: String(row._id),
        electionId: id,
        characterId: row.characterId ? String(row.characterId) : undefined,
        nppId: row.nppId ? String(row.nppId) : undefined,
      })),
      snapshot ? { ...snapshot, electionId: id } : undefined
    );
  });
  return {
    basis:
      "All retained resolved elections at query time, independent of chart checkpoint cutoff. Actual resolved holder receipts, finalized stored seat allocations or frozen single-winner results; archived candidate rows identify people. Current offices never reconstruct history. Each character or NPP holding aggregate seatsHeld voting weight counts once in representative identity comparisons.",
    denominators:
      "Each rate carries its own comparableCycles. Seat/person metrics compare consecutive races with unchanged capacity in the same scope. Win and resolver shares count resolved outcome cycles. Player/NPP win-cycle rates can overlap in mixed multi-seat races.",
    legacyLimit:
      "Missing historical person identity, actor kind and executed resolver remain unknown. Present-day flags are context only.",
    provenance: {
      run: runs[0] ?? null,
      bootstrapFeatureManifest: seedDiagnostics[0]?.featureManifest ?? null,
    },
    currentContext: { gameState, config },
    resolvedCycles: elections.length,
    families: summarizeElectionTurnover(cycles),
    officeHistoryCoverage: history.map((row) => ({
      countryId: row._id.countryId,
      officeType: row._id.officeType,
      partyRows: row.partyRows,
      firstTurn: row.firstTurn,
      lastTurn: row.lastTurn,
      holderRows: row.holderRows,
    })),
  };
}
