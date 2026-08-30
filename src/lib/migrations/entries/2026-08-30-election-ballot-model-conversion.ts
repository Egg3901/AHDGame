import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import type {
  DemographicCategory,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PrimarySnapshot,
  State,
  StateDemographics,
  StateDemographicTurnout,
  StatePartyOrg,
  StateRegistrationPool,
} from "@/lib/db/types";
import type { VoteTurnSnapshot } from "@/lib/db/types/voteTally";
import type { Migration, MigrationResult } from "../types";
import { COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS } from "@/lib/constants/countries";
import {
  ELECTORAL_VOTE_UNITS,
  ELECTORAL_VOTE_UNITS_1953,
  ELECTORAL_VOTE_UNITS_1991,
} from "@/lib/constants/states";
import { resolveTurnout, scalePoolToRegistered } from "@/lib/electionEngine/resolvedTurnout";
import { eraYearContextFromGameState } from "@/lib/era/context";
import { parseSeatId } from "@/lib/seats/seatId";
import { partyPrimaryPools, primaryBallotWindow } from "@/lib/turn/primaryBallots";
import {
  BALLOT_MODEL_VERSION,
  carryTotals,
  generalSliceFactor,
  replayPrimaryBallots,
  rescaleSnapshotIncrements,
  selectWindowSnapshots,
} from "../ballotModelConversion";

/**
 * Convert every in-flight race to the registered-voter ballot model
 * (changelog 1.4.25), so the deploy does not leave a half-old, half-new count
 * on the board.
 *
 * GENERALS in progress: the turns already banked were sized by the old
 * engine — `generalLength` slices with the final turn re-released, every
 * slice spanning the unregistered too, and the presidency pooled on total
 * population. Each stored turn's increments are rescaled by the new engine's
 * slice for that turn (`generalSliceFactor`), the region's registered share,
 * and for the presidency the voting-eligible basis; the series is re-summed
 * and the tally's totals carried across. Per-turn shares are untouched (one
 * factor per turn, uniform across candidates), so no lead changes hands and
 * no seat projection moves beyond rounding. Repeated turns from a stalled
 * turn's re-runs (live turn 460 ran three times) are collapsed to their first
 * record, which also heals the 74 duplicate snapshots that left behind.
 *
 * PRIMARIES whose ballot window is already open: the engine only starts
 * banking from the deploy turn, so the elapsed window turns are replayed from
 * the stored standings snapshots over the engine's own accrual, and those
 * snapshots are stamped with their turn so the per-turn idempotency guard
 * sees them. Primaries whose window has not opened get only the stamp on
 * their latest snapshot.
 *
 * Idempotent: a converted tally carries `ballotModelVersion`, and a snapshot
 * already carrying `turn` is never replayed.
 */

const GAME_STATE_ID = "current";

type GameStateDoc = {
  _id: string;
  currentTurn?: number;
  preset?: string;
  currentYear?: number;
  startingYear?: number;
  eraSystemEnabled?: boolean;
};

function unitStateMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (const list of [ELECTORAL_VOTE_UNITS, ELECTORAL_VOTE_UNITS_1953, ELECTORAL_VOTE_UNITS_1991]) {
    for (const unit of list) out.set(unit.unitId, unit.stateId);
  }
  return out;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function sum(record: Record<string, number> | undefined): number {
  return Object.values(record ?? {}).reduce((s, v) => s + v, 0);
}

async function convertBallotModel(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  const gs = await db.collection<GameStateDoc>("gameState").findOne({ _id: GAME_STATE_ID });
  const currentTurn = gs?.currentTurn;
  if (typeof currentTurn !== "number") {
    notes.push("skipped: gameState has no currentTurn");
    return { documentsScanned: 0, notes };
  }
  const now = new Date();
  const eraYear = eraYearContextFromGameState(gs);

  const elections = await db.collection<Election>("elections").find({ status: "active" }).toArray();
  const electionIds = elections.map((e) => e._id);
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find({ electionId: { $in: electionIds } })
    .toArray();
  const tallyByElection = new Map(tallies.map((t) => [t.electionId.toString(), t]));

  const regionKeys = new Set<string>();
  const regionIds = new Set<string>();
  for (const e of elections) {
    if (e.state) {
      regionKeys.add(`${e.countryId ?? "US"}:${e.state}`);
      regionIds.add(e.state);
    }
  }
  const unitToState = unitStateMap();
  for (const stateId of unitToState.values()) regionIds.add(stateId);

  const [states, registrationPools, statePartyOrgs, demographics, turnoutDocs, categories] =
    await Promise.all([
      db
        .collection<State>("states")
        .find({ _id: { $in: [...regionIds] } })
        .toArray(),
      db
        .collection<StateRegistrationPool>("stateRegistrationPool")
        .find({ stateId: { $in: [...regionIds] } })
        .toArray(),
      db
        .collection<StatePartyOrg>("statePartyOrg")
        .find({ stateId: { $in: [...regionIds] }, registration: { $exists: true } })
        .toArray(),
      db
        .collection<StateDemographics>("stateDemographics")
        .find({ _id: { $in: [...regionIds] } })
        .toArray(),
      db
        .collection<StateDemographicTurnout>("stateDemographicTurnout")
        .find({ _id: { $in: [...regionIds] } })
        .toArray(),
      db.collection<DemographicCategory>("demographicCategories").find({}).toArray(),
    ]);
  const stateByKey = new Map(states.map((s) => [`${s.countryId ?? "US"}:${s._id}`, s]));
  const stateById = new Map(states.map((s) => [s._id as string, s]));
  const poolByState = new Map(registrationPools.map((p) => [p.stateId, p]));
  const demographicsById = new Map(demographics.map((d) => [d._id as string, d]));
  const turnoutById = new Map(turnoutDocs.map((t) => [t._id as string, t]));
  const registrationByRegion = new Map<string, Map<string, number>>();
  for (const po of statePartyOrgs) {
    if (typeof po.registration !== "number") continue;
    const perParty = registrationByRegion.get(po.stateId) ?? new Map<string, number>();
    perParty.set(po.partyId, po.registration);
    registrationByRegion.set(po.stateId, perParty);
  }

  const registeredShare = (stateId: string): number =>
    scalePoolToRegistered(1, poolByState.get(stateId)?.unregistered);
  const electorateOf = (state: State | undefined): number =>
    state?.votingEligiblePopulation ?? state?.population ?? 0;

  const tallyOps: AnyBulkWriteOperation<ElectionVoteTally>[] = [];
  const snapshotOps: AnyBulkWriteOperation<PrimarySnapshot>[] = [];
  let generalsConverted = 0;
  let presidentialsConverted = 0;
  let duplicateTurnsDropped = 0;
  let primariesReplayed = 0;
  let primariesStamped = 0;
  let skippedNoWindow = 0;
  const generalSamples: string[] = [];
  const primarySamples: string[] = [];

  // ── Generals in progress ──────────────────────────────────────────────────
  for (const election of elections) {
    const tally = tallyByElection.get(election._id.toString());
    if (!tally || tally.finalized || tally.ballotModelVersion === BALLOT_MODEL_VERSION) continue;
    if (typeof election.primaryEndTurn !== "number" || typeof election.endTurn !== "number")
      continue;
    if (election.primaryEndTurn > currentTurn) continue; // still in the primary
    const isPresident = election.electionType === "president";
    if (
      isPresident &&
      election.countryId != null &&
      COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS.has(election.countryId)
    ) {
      continue; // NG president keeps no per-turn snapshots; nothing to rescale
    }
    const generalLength = election.endTurn - election.primaryEndTurn;
    const primaryEndTurn = election.primaryEndTurn;

    if (!isPresident) {
      if (!election.state || tally.turnSnapshots.length === 0) continue;
      const stateDoc = stateByKey.get(`${election.countryId ?? "US"}:${election.state}`);
      const reg = registeredShare(election.state);
      const ceiling = electorateOf(stateDoc) * reg;
      const { snapshots, totals, dropped } = rescaleSnapshotIncrements(
        tally.turnSnapshots,
        (turn) => generalSliceFactor(generalLength, turn - primaryEndTurn) * reg,
        ceiling > 0 ? ceiling : undefined
      );
      duplicateTurnsDropped += dropped;
      const totalVotes = carryTotals(
        tally.totalVotes,
        tally.turnSnapshots.at(-1)?.cumulativeVotes,
        totals
      );
      if (generalSamples.length < 6) {
        generalSamples.push(
          `${election.countryId}/${election.electionType}/${election.state}: ${fmt(sum(tally.totalVotes))} -> ${fmt(sum(totalVotes))} votes over ${snapshots.length} turn(s)${dropped ? `, ${dropped} duplicate turn(s) dropped` : ""}`
        );
      }
      generalsConverted++;
      tallyOps.push({
        updateOne: {
          filter: { _id: tally._id },
          update: {
            $set: {
              turnSnapshots: snapshots,
              totalVotes,
              ballotModelVersion: BALLOT_MODEL_VERSION,
              updatedAt: now,
            },
          },
        },
      });
      continue;
    }

    // Presidential: per electoral unit, then the national series as the sum.
    const unitSnapshots = tally.unitTurnSnapshots ?? {};
    if (Object.keys(unitSnapshots).length === 0 || tally.turnSnapshots.length === 0) continue;
    const rebuiltUnits: Record<string, VoteTurnSnapshot[]> = {};
    const totalVotesByUnit: Record<string, Record<string, number>> = {};
    for (const [unitId, series] of Object.entries(unitSnapshots)) {
      const stateId = unitToState.get(unitId) ?? unitId.split("-")[0];
      const stateDoc = stateById.get(stateId);
      const reg = registeredShare(stateId);
      // Voting-eligible basis: the old engine pooled on total population.
      const basis =
        stateDoc?.votingEligiblePopulation && stateDoc.population
          ? stateDoc.votingEligiblePopulation / stateDoc.population
          : 1;
      const { snapshots, totals, dropped } = rescaleSnapshotIncrements(
        series,
        (turn) => generalSliceFactor(generalLength, turn - primaryEndTurn) * reg * basis,
        electorateOf(stateDoc) * reg || undefined
      );
      duplicateTurnsDropped += dropped;
      rebuiltUnits[unitId] = snapshots;
      totalVotesByUnit[unitId] = carryTotals(
        tally.totalVotesByUnit?.[unitId] ?? {},
        series.at(-1)?.cumulativeVotes,
        totals
      );
    }
    // National series: each recorded turn is the sum of every unit's rebuilt
    // cumulative at that turn (a unit without that exact turn contributes its
    // latest earlier reading).
    const nationalSeen = new Set<number>();
    const nationalKept = tally.turnSnapshots.filter((s) => {
      if (nationalSeen.has(s.turn)) return false;
      nationalSeen.add(s.turn);
      return true;
    });
    const nationalSnapshots: VoteTurnSnapshot[] = nationalKept.map((snapshot) => {
      const cumulative: Record<string, number> = {};
      for (const series of Object.values(rebuiltUnits)) {
        let reading: VoteTurnSnapshot | undefined;
        for (const s of series) {
          if (s.turn <= snapshot.turn) reading = s;
        }
        if (!reading) continue;
        for (const [id, v] of Object.entries(reading.cumulativeVotes)) {
          cumulative[id] = (cumulative[id] ?? 0) + v;
        }
      }
      const total = sum(cumulative);
      const sharesPct: Record<string, number> = {};
      for (const [id, v] of Object.entries(cumulative)) {
        sharesPct[id] = total > 0 ? Math.round((v / total) * 1000) / 10 : 0;
      }
      return { ...snapshot, cumulativeVotes: cumulative, sharesPct };
    });
    const totalVotes: Record<string, number> = {};
    for (const unitTotals of Object.values(totalVotesByUnit)) {
      for (const [id, v] of Object.entries(unitTotals)) totalVotes[id] = (totalVotes[id] ?? 0) + v;
    }
    if (generalSamples.length < 6) {
      generalSamples.push(
        `${election.countryId}/president: ${fmt(sum(tally.totalVotes))} -> ${fmt(sum(totalVotes))} votes across ${Object.keys(rebuiltUnits).length} unit(s)`
      );
    }
    presidentialsConverted++;
    tallyOps.push({
      updateOne: {
        filter: { _id: tally._id },
        update: {
          $set: {
            unitTurnSnapshots: rebuiltUnits,
            totalVotesByUnit,
            turnSnapshots: nationalSnapshots,
            totalVotes,
            ballotModelVersion: BALLOT_MODEL_VERSION,
            updatedAt: now,
          },
        },
      },
    });
  }

  // ── Primaries in progress ─────────────────────────────────────────────────
  const primaryElections = elections.filter(
    (e) =>
      e.electionType !== "president" &&
      typeof e.primaryEndTurn === "number" &&
      e.primaryEndTurn > currentTurn
  );
  if (primaryElections.length > 0) {
    const primaryIds = primaryElections.map((e) => e._id);
    const [snapshots, candidates] = await Promise.all([
      db
        .collection<PrimarySnapshot>("primarySnapshots")
        .find({ electionId: { $in: primaryIds }, turn: { $exists: false } })
        .sort({ recordedAt: 1 })
        .toArray(),
      db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: { $in: primaryIds }, status: "active" })
        .toArray(),
    ]);
    const snapshotsByElection = new Map<string, PrimarySnapshot[]>();
    for (const s of snapshots) {
      const list = snapshotsByElection.get(s.electionId.toString()) ?? [];
      list.push(s);
      snapshotsByElection.set(s.electionId.toString(), list);
    }
    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    for (const c of candidates) {
      const list = candidatesByElection.get(c.electionId.toString()) ?? [];
      list.push(c);
      candidatesByElection.set(c.electionId.toString(), list);
    }
    const turnoutPoolByKey = new Map<string, number>();
    const turnoutPoolFor = (countryId: string, regionId: string): number | undefined => {
      const key = `${countryId}:${regionId}`;
      if (turnoutPoolByKey.has(key)) return turnoutPoolByKey.get(key);
      const stateDoc = stateByKey.get(key);
      const demo = demographicsById.get(regionId);
      const electorate = electorateOf(stateDoc);
      if (!stateDoc || !demo || categories.length === 0 || !(electorate > 0)) return undefined;
      const { totalPool } = resolveTurnout(
        electorate,
        demo,
        categories,
        turnoutById.get(regionId),
        {
          preset: gs?.preset,
          year: eraYear.year,
          startingYear: eraYear.startingYear,
        }
      );
      turnoutPoolByKey.set(key, totalPool);
      return totalPool;
    };

    for (const election of primaryElections) {
      const eid = election._id.toString();
      const untagged = snapshotsByElection.get(eid) ?? [];
      if (untagged.length === 0) continue;
      const tally = tallyByElection.get(eid);
      const window = primaryBallotWindow(election, currentTurn, now);
      const regionId = election.seatId ? parseSeatId(election.seatId).localRegionId : null;
      const countryId = election.countryId ?? "US";
      const totalPool = regionId ? turnoutPoolFor(countryId, regionId) : undefined;
      const registration = regionId ? registrationByRegion.get(regionId) : undefined;
      const canReplay =
        window?.open === true &&
        typeof window.startTurn === "number" &&
        typeof window.endTurn === "number" &&
        !!totalPool &&
        !!registration &&
        tally?.ballotModelVersion !== BALLOT_MODEL_VERSION;

      if (!canReplay) {
        // Only the idempotency stamp: the newest record is this turn's.
        const latest = untagged[untagged.length - 1];
        snapshotOps.push({
          updateOne: { filter: { _id: latest._id }, update: { $set: { turn: currentTurn } } },
        });
        primariesStamped++;
        if (window && !window.open) skippedNoWindow++;
        continue;
      }

      const windowStart = window.startTurn as number;
      const totalTurns = Math.max(4, (window.endTurn as number) - windowStart);
      const elapsed = Math.min(totalTurns, currentTurn - windowStart + 1);
      const picked = selectWindowSnapshots(untagged, elapsed, windowStart);
      const partyIds = new Set<string>();
      for (const p of picked)
        for (const party of Object.keys(p.snapshot.byParty)) partyIds.add(party);
      const pools = partyPrimaryPools(
        totalPool as number,
        [...partyIds],
        registration as Map<string, number>
      );
      if (pools.size === 0) {
        const latest = untagged[untagged.length - 1];
        snapshotOps.push({
          updateOne: { filter: { _id: latest._id }, update: { $set: { turn: currentTurn } } },
        });
        primariesStamped++;
        continue;
      }
      const cumulative = replayPrimaryBallots({
        cumulative: tally?.primaryVotes ?? {},
        turns: picked.map((p) => ({
          turnIndex: p.turn - windowStart,
          entriesByParty: new Map(
            Object.entries(p.snapshot.byParty).map(([party, entries]) => [
              party,
              entries.map((e) => ({ candidateId: e.candidateId, sharePct: e.sharePct })),
            ])
          ),
        })),
        poolsByParty: pools,
        totalTurns,
      });
      for (const p of picked) {
        snapshotOps.push({
          updateOne: { filter: { _id: p.snapshot._id }, update: { $set: { turn: p.turn } } },
        });
      }
      const candidateNames: Record<string, string> = {};
      const candidateParties: Record<string, string> = {};
      for (const c of candidatesByElection.get(eid) ?? []) {
        candidateNames[c._id.toString()] = c.characterName;
        candidateParties[c._id.toString()] = c.party;
      }
      const electionObjectId = election._id as ObjectId;
      tallyOps.push({
        updateOne: {
          filter: { electionId: electionObjectId },
          update: {
            $set: {
              primaryVotes: cumulative,
              candidateNames,
              candidateParties,
              ballotModelVersion: BALLOT_MODEL_VERSION,
              updatedAt: now,
            },
            $setOnInsert: {
              _id: electionObjectId,
              electionId: electionObjectId,
              state: (election.state ?? regionId) as string,
              totalVotes: {},
              turnSnapshots: [],
              finalized: false,
              createdAt: now,
            },
          },
          upsert: true,
        },
      });
      primariesReplayed++;
      if (primarySamples.length < 6) {
        const byParty = new Map<string, number>();
        for (const [cid, v] of Object.entries(cumulative)) {
          const party = candidateParties[cid] ?? "?";
          byParty.set(party, (byParty.get(party) ?? 0) + v);
        }
        primarySamples.push(
          `${countryId}/${election.electionType}/${election.state}: ${picked.length} of ${totalTurns} window turn(s) replayed, ${[...byParty.entries()].map(([p, v]) => `${p}=${fmt(v)}`).join(" ")}`
        );
      }
    }
  }

  notes.push(
    `turn ${currentTurn}: ${elections.length} active race(s); generals converted ${generalsConverted}, presidential ${presidentialsConverted}, duplicate turn record(s) dropped ${duplicateTurnsDropped}`
  );
  notes.push(
    `primaries replayed ${primariesReplayed}, stamped only ${primariesStamped} (window not open yet: ${skippedNoWindow})`
  );
  for (const line of generalSamples) notes.push(`general: ${line}`);
  for (const line of primarySamples) notes.push(`primary: ${line}`);

  if (dryRun) {
    notes.push(
      `dry run: would write ${tallyOps.length} tally update(s) and ${snapshotOps.length} snapshot stamp(s)`
    );
    return { documentsScanned: elections.length, notes };
  }

  let documentsUpdated = 0;
  if (tallyOps.length > 0) {
    const r = await db.collection<ElectionVoteTally>("electionVoteTallies").bulkWrite(tallyOps);
    documentsUpdated += r.modifiedCount + r.upsertedCount;
  }
  if (snapshotOps.length > 0) {
    const r = await db.collection<PrimarySnapshot>("primarySnapshots").bulkWrite(snapshotOps);
    documentsUpdated += r.modifiedCount;
  }
  return { documentsScanned: elections.length, documentsUpdated, notes };
}

export const migration: Migration = {
  id: "2026-08-30-election-ballot-model-conversion",
  description:
    "Rescale in-flight general counts to the registered-voter model (inclusive window, VEP basis, duplicate stalled-turn records collapsed) and replay elapsed primary ballot windows from stored standings",
  idempotent: true,
  execute: (db, ctx) => convertBallotModel(db, ctx.dryRun),
};
