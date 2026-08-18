/**
 * GET /api/admin/elections/log
 *
 * Returns a structured election event log for the admin panel.
 * Each entry represents one election and includes:
 *  - Primary results per party (scores, %, advance/eliminate events)
 *  - General election results (votes, %, seats if applicable)
 *  - Resolved office assignments
 *
 * Query params:
 *  ?q=         free-text search (state, candidate name)
 *  ?type=      senate | house | stateSenate | governor
 *  ?status=    upcoming | active | completed
 *  ?state=     two-letter state abbreviation
 *  ?page=      1-based page (default 1)
 *  ?limit=     results per page (default 50, max 200)
 */

import { NextResponse } from "next/server";
import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseBoundedIntParam } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getGameTime } from "@/lib/time/gameTime";
import { isPrimaryEnded } from "@/lib/elections/phases";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PrimarySnapshot,
} from "@/lib/db/types";

// ─── Response shape ───────────────────────────────────────────────────────────

import type {
  PrimaryPartyResult,
  GeneralCandidateResult,
  ElectionLogEntry,
} from "@/lib/elections/electionResponseTypes";
import {
  isContingentResolutionMode,
  resolvePresidentialWinnerCandidateId,
} from "@/lib/elections/presidentialResolutionDisplay";

// Re-export for any consumer that still imports types from the route file.
// New consumers should import from "@/lib/elections/electionResponseTypes".
export type {
  PrimaryPartyResult,
  GeneralCandidateResult,
  ElectionLogEntry,
} from "@/lib/elections/electionResponseTypes";

// ─── Route handler ────────────────────────────────────────────────────────────

// GET /api/admin/elections/log — Returns a paginated, filterable election event log with primary and general results.
// Auth: requireAdmin
// Errors: 403
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").toLowerCase().trim();
    const type = searchParams.get("type") ?? "";
    const status = searchParams.get("status") ?? "";
    const state = searchParams.get("state") ?? "";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = parseBoundedIntParam(searchParams, "limit", 50, 1, 200);

    const db = await getDb();

    // ── 1. Fetch matching elections ──────────────────────────────────────────────
    const query: Record<string, unknown> = {};
    if (type) query.electionType = type;
    if (status) query.status = status;
    if (state) query.state = state.toUpperCase();

    const allElections = await db
      .collection<Election>("elections")
      .find(query)
      .sort({ updatedAt: -1, state: 1 })
      .toArray();

    // ── 2. Fetch supporting data in bulk ─────────────────────────────────────────
    const electionIds = allElections.map((e) => e._id);

    const [allCandidates, allTallies, latestSnapshotRows, allParties, allStates] =
      await Promise.all([
        db
          .collection<ElectionCandidate>("electionCandidates")
          .find({ electionId: { $in: electionIds } })
          .toArray(),
        db
          .collection<ElectionVoteTally>("electionVoteTallies")
          .find({ electionId: { $in: electionIds } })
          .toArray(),
        // One document per election — avoid loading every snapshot row (was O(total snapshots))
        db
          .collection<PrimarySnapshot>("primarySnapshots")
          .aggregate<{ _id: ObjectId; doc: PrimarySnapshot }>([
            { $match: { electionId: { $in: electionIds } } },
            { $sort: { recordedAt: -1 } },
            { $group: { _id: "$electionId", doc: { $first: "$$ROOT" } } },
          ])
          .toArray(),
        db.collection("politicalParties").find({}).toArray(),
        db
          .collection("states")
          .find({}, { projection: { _id: 1, name: 1 } })
          .toArray(),
      ]);

    // Build lookup maps
    const partyMap = new Map(allParties.map((p) => [String(p._id), p]));
    const stateMap = new Map(allStates.map((s) => [String(s._id), String(s.name)]));

    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    for (const c of allCandidates) {
      const key = c.electionId.toString();
      if (!candidatesByElection.has(key)) candidatesByElection.set(key, []);
      candidatesByElection.get(key)!.push(c);
    }

    const tallyByElection = new Map<string, ElectionVoteTally>();
    for (const t of allTallies) tallyByElection.set(t.electionId.toString(), t);

    const snapshotByElection = new Map<string, PrimarySnapshot>(
      latestSnapshotRows.map((r) => [r._id.toString(), r.doc])
    );

    // ── 3. Build log entries ──────────────────────────────────────────────────────
    const entries: ElectionLogEntry[] = [];
    // Use game-clock effective-now so the admin log shows the "primary ended"
    // flag consistent with the turn-based resolution rather than wall-clock drift.
    const logGameTime = await getGameTime();

    for (const election of allElections) {
      const eid = election._id.toString();
      const candidates = candidatesByElection.get(eid) ?? [];
      const tally = tallyByElection.get(eid) ?? null;
      const snapshot = snapshotByElection.get(eid) ?? null;
      const stateName = stateMap.get(election.state) ?? election.state;

      const primaryEnded = isPrimaryEnded(election, logGameTime.currentTurn, logGameTime);

      // ── Primary results ───────────────────────────────────────────────────────
      const primaryResults: PrimaryPartyResult[] = [];

      // Group candidates by party
      const byParty = new Map<string, ElectionCandidate[]>();
      for (const c of candidates) {
        if (!byParty.has(c.party)) byParty.set(c.party, []);
        byParty.get(c.party)!.push(c);
      }

      for (const [partyId, partyCandidates] of byParty) {
        const party = partyMap.get(partyId);

        // Get latest snapshot data for this party if available
        const snapshotEntries = snapshot?.byParty?.[partyId] ?? [];

        // Build candidate rows — use snapshot scores when available
        const rows = partyCandidates
          .map((c) => {
            const snap = snapshotEntries.find((s) => s.candidateId === c._id.toString());
            return {
              candidateId: c._id.toString(),
              name: c.characterName,
              score: snap?.primaryScore ?? 0,
              sharePct: snap?.sharePct ?? 0,
              advanced: primaryEnded ? c.status === "active" : true,
            };
          })
          .sort((a, b) => b.score - a.score);

        const events: string[] = [];
        for (const r of rows) {
          if (rows.length === 1) {
            events.push(`${r.name} — uncontested`);
          } else if (r.advanced) {
            events.push(`${r.name} advanced to general (${r.sharePct.toFixed(1)}%)`);
          } else {
            events.push(`${r.name} eliminated (${r.sharePct.toFixed(1)}%)`);
          }
        }

        primaryResults.push({
          party: partyId,
          partyName: party?.name ?? partyId,
          partyColor: party?.color ?? "#888",
          countryId: (election.countryId ?? "US") as "US" | "UK" | "DE",
          candidates: rows,
          events,
        });
      }

      // ── General results ───────────────────────────────────────────────────────
      let generalResult: ElectionLogEntry["generalResult"] = null;

      if (tally) {
        const totalVotes = Object.values(tally.totalVotes).reduce((s, v) => s + v, 0);
        const grandTotal = Math.max(1, totalVotes);

        // Sort candidate IDs by votes desc
        const ranked = Object.entries(tally.totalVotes).sort(([, a], [, b]) => b - a);

        const presidentWinnerId =
          election.electionType === "president"
            ? resolvePresidentialWinnerCandidateId(
                tally.electoralVotesByCandidate,
                tally.resolutionMode,
                tally.contingentResult
              )
            : null;

        const generalCandidates: GeneralCandidateResult[] = ranked.map(([cid, votes], i) => {
          const partyId = tally.candidateParties[cid] ?? "";
          const party = partyMap.get(partyId);
          const seats = tally.seatsEstimate?.[cid] ?? null;
          const wonByPresidentBallot =
            election.electionType === "president" && presidentWinnerId != null
              ? cid === presidentWinnerId
              : i === 0;
          return {
            candidateId: cid,
            name: tally.candidateNames[cid] ?? cid,
            party: partyId,
            partyName: party?.name ?? partyId,
            partyColor: party?.color ?? "#888",
            countryId: (election.countryId ?? "US") as "US" | "UK" | "DE",
            votes,
            pct: (votes / grandTotal) * 100,
            seats,
            won: wonByPresidentBallot || (seats !== null && seats > 0),
          };
        });

        const isMultiSeat = election.totalSeats && election.totalSeats > 1;
        const events: string[] = [];

        if (
          tally.finalized &&
          election.electionType === "president" &&
          isContingentResolutionMode(tally.resolutionMode) &&
          tally.contingentResult &&
          presidentWinnerId
        ) {
          const winnerName = tally.candidateNames[presidentWinnerId] ?? presidentWinnerId;
          const houseVotes = tally.contingentResult.houseVoteTotals[presidentWinnerId] ?? 0;
          const winnerEv = tally.electoralVotesByCandidate?.[presidentWinnerId] ?? 0;
          events.push(
            `Contingent election — ${winnerName} seated by House ballot (${houseVotes} state delegation vote${houseVotes === 1 ? "" : "s"}, ${winnerEv} EV)`
          );
        }

        if (tally.finalized) {
          for (const c of generalCandidates) {
            if (isMultiSeat) {
              if ((c.seats ?? 0) > 0) {
                events.push(
                  `${c.name} wins — ${c.seats} seat${c.seats !== 1 ? "s" : ""} (${c.pct.toFixed(1)}%, ${c.votes.toLocaleString()} votes)`
                );
              } else {
                events.push(
                  `${c.name} — no seats won (${c.pct.toFixed(1)}%, ${c.votes.toLocaleString()} votes)`
                );
              }
            } else {
              if (c.won) {
                const officeLabel =
                  {
                    senate: `U.S. Senator (${election.state})`,
                    house: `U.S. Representative (${election.state})`,
                    stateSenate: `State Senator (${election.state})`,
                    governor: `Governor (${election.state})`,
                    president: "President of the United States",
                  }[election.electionType] ?? election.electionType;
                events.push(
                  `${c.name} wins → assigned ${officeLabel} (${c.pct.toFixed(1)}%, ${c.votes.toLocaleString()} votes)`
                );
              } else {
                events.push(
                  `${c.name} — defeated (${c.pct.toFixed(1)}%, ${c.votes.toLocaleString()} votes)`
                );
              }
            }
          }
        } else if (generalCandidates.length > 0) {
          const leader = generalCandidates[0];
          events.push(
            `${leader.name} leading — ${leader.pct.toFixed(1)}% (${leader.votes.toLocaleString()} votes, ${tally.turnSnapshots.length} turn${tally.turnSnapshots.length !== 1 ? "s" : ""} counted)`
          );
        }

        generalResult = {
          totalVotes,
          turnsCounted: tally.turnSnapshots.length,
          finalized: tally.finalized,
          candidates: generalCandidates,
          events,
          ...(election.electionType === "president" && tally.resolutionMode
            ? { resolutionMode: tally.resolutionMode }
            : {}),
          ...(election.electionType === "president" && tally.contingentResult
            ? { contingentResult: tally.contingentResult }
            : {}),
          ...(election.electionType === "president" && tally.electoralVotesByCandidate
            ? { electoralVotesByCandidate: tally.electoralVotesByCandidate }
            : {}),
        };
      }

      // ── Free-text search filter ───────────────────────────────────────────────
      if (q) {
        const blob = [
          election.state,
          stateName,
          election.electionType,
          ...candidates.map((c) => c.characterName),
        ]
          .join(" ")
          .toLowerCase();
        if (!blob.includes(q)) continue;
      }

      entries.push({
        id: eid,
        electionType: election.electionType,
        state: election.state,
        stateName,
        countryId: (election.countryId ?? "US") as "US" | "UK" | "DE",
        senateClass: election.senateClass ?? null,
        cycle: election.cycle,
        status: election.status,
        totalSeats: election.totalSeats ?? null,
        startTime: election.startTime?.toISOString() ?? null,
        endTime: election.endTime?.toISOString() ?? null,
        primaryEndTime: election.primaryEndTime?.toISOString() ?? null,
        primaryResults,
        generalResult,
      });
    }

    // ── 4. Paginate ───────────────────────────────────────────────────────────────
    const total = entries.length;
    const paged = entries.slice((page - 1) * limit, page * limit);

    return NextResponse.json({
      entries: paged,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
