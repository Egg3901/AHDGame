import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { conditionalJson } from "@/lib/api/conditionalJson";
import { withApiMetrics } from "@/lib/observability/apiMetrics";
import { loadApportionment } from "@/lib/elections/apportionment";
import { computeSeatEstimates } from "@/lib/elections/buildPollingData";
import { resolvedSeatsEstimate } from "@/lib/elections/resolvedSeatsEstimate";
import { getMajoritarianBonus } from "@/lib/turn/election/seatAllocation";
import { isLiveElectionResultsEnabled } from "@/lib/elections/liveResults/featureFlag";
import {
  computeBaselineReportingPct,
  computeElectoralTotals,
  computeFinalHour,
  computeUnitResult,
} from "@/lib/elections/liveResults/computeResults";
import {
  buildNationalElectionNight,
  type ElectionNightPartyInfo,
} from "@/lib/elections/liveResults/electionNight";
import type {
  ElectionResultsResponse,
  ResultsCandidate,
  ResultsUnit,
} from "@/lib/elections/liveResults/types";
import type { Election, ElectionCandidate, ElectionVoteTally, GameState } from "@/lib/db/types";
import { MS_PER_TURN } from "@/lib/constants/turnTime";

const ENDED_STATUSES = new Set(["completed", "resolved", "cancelled"]);
const INDEPENDENT_COLOR = "#9CA3AF";

async function loadPartyMap(
  db: Db,
  countryId: string
): Promise<Map<string, ElectionNightPartyInfo>> {
  const docs = await db
    .collection("politicalParties")
    .find({ countryId })
    .project<{ sequentialId: number; name: string; abbreviation?: string; color?: string }>({
      sequentialId: 1,
      name: 1,
      abbreviation: 1,
      color: 1,
    })
    .toArray();
  const map = new Map<string, ElectionNightPartyInfo>();
  for (const p of docs) {
    map.set(String(p.sequentialId), {
      name: p.name,
      abbreviation: p.abbreviation ?? p.name,
      color: p.color ?? INDEPENDENT_COLOR,
    });
  }
  map.set("independent", { name: "Independent", abbreviation: "IND", color: INDEPENDENT_COLOR });
  return map;
}

function partyInfo(
  map: Map<string, ElectionNightPartyInfo>,
  partyId: string
): ElectionNightPartyInfo {
  return map.get(partyId) ?? { name: "Independent", abbreviation: "IND", color: INDEPENDENT_COLOR };
}

async function loadRegionNames(db: Db, regionIds: string[]): Promise<Map<string, string>> {
  if (regionIds.length === 0) return new Map();
  const docs = await db
    .collection<{ _id: string; name?: string }>("states")
    .find({ _id: { $in: regionIds } })
    .project<{ _id: string; name?: string }>({ name: 1 })
    .toArray();
  return new Map(docs.map((d) => [d._id, d.name ?? d._id]));
}

/** "ME_CD1" → parent "ME" + label suffix "CD-1"; plain stateIds pass through. */
function unitDisplayName(unitId: string, stateNames: Map<string, string>): string {
  const cdMatch = unitId.match(/^([A-Z]{2})_CD(\d)$/);
  if (cdMatch) {
    const parent = stateNames.get(cdMatch[1]) ?? cdMatch[1];
    return `${parent} CD-${cdMatch[2]}`;
  }
  return stateNames.get(unitId) ?? unitId;
}

// GET /api/elections/[id]/results - Read-only, polling-optimized live results for one election.
// Auth: public (optional getAuthUser); 403 while the liveElectionResults gate is off for non-admins.
// Errors: 400, 403, 404
async function handleGet(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid election id" }, { status: 400 });
    }

    const db = await getDb();
    const [election, gameState, user] = await Promise.all([
      db.collection<Election>("elections").findOne({ _id: new ObjectId(id) }),
      db.collection<GameState>("gameState").findOne(
        { _id: "current" },
        {
          projection: {
            currentTurn: 1,
            currentYear: 1,
            nextScheduledTurn: 1,
            pausedAt: 1,
            fastMode: 1,
            preset: 1,
            liveElectionResultsEnabled: 1,
          },
        }
      ),
      getAuthUser(),
    ]);

    const isAdmin = user?.isAdmin === true;
    if (!isLiveElectionResultsEnabled(gameState) && !isAdmin) {
      return NextResponse.json({ error: "Live election results are not enabled" }, { status: 403 });
    }
    if (!election) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    const [candidates, tally, partyMap] = await Promise.all([
      db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: election._id })
        .toArray(),
      db.collection<ElectionVoteTally>("electionVoteTallies").findOne({ electionId: election._id }),
      loadPartyMap(db, election.countryId),
    ]);

    const now = new Date();
    const currentTurn = gameState?.currentTurn ?? 0;
    const isEnded = ENDED_STATUSES.has(election.status);
    const windowMs = gameState?.fastMode ? MS_PER_TURN / 2 : MS_PER_TURN;
    const finalHour = computeFinalHour(
      {
        status: election.status,
        currentTurn,
        endTurn: election.endTurn,
        nextScheduledTurn: gameState?.nextScheduledTurn ?? null,
        pausedAt: gameState?.pausedAt ?? null,
        now,
      },
      windowMs
    );
    const baselineReportingPct = computeBaselineReportingPct({
      currentTurn,
      startTurn: election.startTurn,
      endTurn: election.endTurn,
      primaryEndTurn: election.primaryEndTurn,
    });

    const electionId = election._id.toString();
    const totalVotesMap = tally?.totalVotes ?? {};
    const isPresident = election.electionType === "president";

    // ── Per-unit results ──────────────────────────────────────────────────
    let units: ResultsUnit[] = [];
    let evNeeded: number | undefined;
    let totalEv: number | undefined;
    let calledEv: Record<string, number> = {};
    let leadingEv: Record<string, number> = {};

    if (isPresident && tally?.totalVotesByUnit) {
      const unitVotes = tally.totalVotesByUnit;
      const hasVotes = (unitId: string) =>
        Object.values(unitVotes[unitId] ?? {}).some((v) => v > 0);

      let unitIds: string[];
      const evByUnit = new Map<string, number>();
      if (election.countryId === "US") {
        const apportionment = await loadApportionment(
          db,
          gameState?.preset,
          gameState?.currentYear
        );
        for (const u of apportionment.electoralVoteUnits) evByUnit.set(u.unitId, u.ev);
        unitIds = [
          ...new Set([
            ...apportionment.electoralVoteUnits.map((u) => u.unitId),
            ...Object.keys(unitVotes).filter(hasVotes),
          ]),
        ];
        totalEv = apportionment.electoralVoteUnits.reduce((s, u) => s + u.ev, 0);
        evNeeded = Math.floor(totalEv / 2) + 1;
      } else {
        // Non-US presidents: popular vote per region. The tally may carry
        // vestigial all-zero US unit keys from init — scope to the country's
        // own regions plus any tally key that actually holds votes.
        const regionDocs = await db
          .collection<{ _id: string; name?: string }>("states")
          .find({ countryId: election.countryId })
          .project<{ _id: string; name?: string }>({ name: 1 })
          .toArray();
        unitIds = [
          ...new Set([...regionDocs.map((d) => d._id), ...Object.keys(unitVotes).filter(hasVotes)]),
        ];
      }

      const stateNames = await loadRegionNames(db, [
        ...new Set(unitIds.map((u) => u.replace(/_CD\d$/, ""))),
      ]);
      units = unitIds.map((unitId) =>
        computeUnitResult({
          electionId,
          unitId,
          name: unitDisplayName(unitId, stateNames),
          weight: evByUnit.get(unitId) ?? 0,
          votes: unitVotes[unitId] ?? {},
          isEnded,
          baselineReportingPct,
          finalHourProgress: finalHour?.progress ?? null,
        })
      );
      units.sort((a, b) => a.name.localeCompare(b.name));

      if (tally.finalized && tally.electoralVotesByCandidate) {
        calledEv = tally.electoralVotesByCandidate;
        leadingEv = {};
      } else if (totalEv) {
        ({ calledEv, leadingEv } = computeElectoralTotals(units));
      }
    } else if (tally) {
      // Every other type: the election's own region is the single unit.
      const regionNames = await loadRegionNames(db, [election.state]);
      units = [
        computeUnitResult({
          electionId,
          unitId: election.state,
          name: regionNames.get(election.state) ?? election.state,
          weight: election.totalSeats ?? 1,
          votes: totalVotesMap,
          isEnded,
          baselineReportingPct,
          finalHourProgress: finalHour?.progress ?? null,
        }),
      ];
    }

    // ── Candidate roster ──────────────────────────────────────────────────
    // Resolution marks every candidate doc withdrawn, so an ended election's
    // roster comes from tally participation: any candidate with votes stays,
    // plus tally-only entries (docs pruned) named via tally.candidateNames.
    const rosterDocs = candidates.filter(
      (c) => c.status === "active" || (totalVotesMap[c._id.toString()] ?? 0) > 0
    );
    const rosterDocIds = new Set(rosterDocs.map((c) => c._id.toString()));
    const tallyOnlyIds = Object.keys(totalVotesMap).filter(
      (cid) => !rosterDocIds.has(cid) && (totalVotesMap[cid] ?? 0) > 0
    );
    const rosterIds = new Set([...rosterDocIds, ...tallyOnlyIds]);

    // ── Seat projections (multi-seat races) ───────────────────────────────
    // #1277: same rule as `enrichElection` — a finalized tally's allocation is
    // authoritative, anything earlier is a projection. This used to read
    // `tally.seatsEstimate ?? compute(...)`, but `accumulateVoteTurn` rewrites
    // that field every turn, so the fallback was near-dead and a LIVE race was
    // served last turn's estimate instead of one built from the current roster.
    // `resolvedSeatsEstimate(tally, null)` first so a finalized race
    // short-circuits before the org-ranking round-trip, exactly as the old
    // `??` did.
    const seatsEstimate =
      !isPresident && tally
        ? (resolvedSeatsEstimate(tally, null) ??
          computeSeatEstimates(
            election.electionType,
            election.totalSeats,
            tally,
            rosterIds,
            getMajoritarianBonus(election.electionType, gameState?.currentYear)
          ))
        : null;

    // ── Candidate totals ──────────────────────────────────────────────────
    const totalCastVotes = Object.values(totalVotesMap).reduce((s, v) => s + v, 0);
    const buildCandidate = (
      cid: string,
      name: string,
      party: string,
      isNPP: boolean
    ): ResultsCandidate => {
      const votes = totalVotesMap[cid] ?? 0;
      const info = partyInfo(partyMap, party);
      const candidate: ResultsCandidate = {
        id: cid,
        name,
        party,
        partyName: info.name,
        partyColor: info.color,
        isNPP,
        totalVotes: votes,
        voteSharePct: totalCastVotes > 0 ? (votes / totalCastVotes) * 100 : 0,
      };
      if (isPresident) {
        candidate.electoralVotes = calledEv[cid] ?? 0;
        candidate.leadingElectoralVotes = leadingEv[cid] ?? 0;
      }
      if (seatsEstimate) candidate.seatsProjected = seatsEstimate[cid] ?? 0;
      return candidate;
    };
    const resultsCandidates: ResultsCandidate[] = [
      ...rosterDocs.map((c) =>
        buildCandidate(c._id.toString(), c.characterName, c.party, c.isNPP ?? false)
      ),
      ...tallyOnlyIds.map((cid) =>
        buildCandidate(
          cid,
          tally?.candidateNames?.[cid] ?? "Unknown candidate",
          tally?.candidateParties?.[cid] ?? "independent",
          false
        )
      ),
    ].sort((a, b) => b.totalVotes - a.totalVotes);

    // ── National Westminster-style aggregation ────────────────────────────
    const nationalBonus = getMajoritarianBonus(election.electionType, gameState?.currentYear);
    const national = await buildNationalElectionNight(
      db,
      election,
      partyMap,
      finalHour?.progress ?? null,
      isEnded,
      nationalBonus
    );

    // ── Summary ───────────────────────────────────────────────────────────
    const unitsCalled = units.filter((u) => u.called).length;
    let projectedWinner: string | null = null;
    if (isPresident && evNeeded) {
      const decisive = resultsCandidates.find((c) => (c.electoralVotes ?? 0) >= evNeeded);
      projectedWinner = decisive?.id ?? null;
    }
    // Ended winner-take-one races (incl. popular-vote presidents): top of the poll.
    const singleWinnerRace = isPresident || (election.totalSeats ?? 1) <= 1;
    if (!projectedWinner && isEnded && singleWinnerRace && totalCastVotes > 0) {
      projectedWinner = resultsCandidates[0]?.id ?? null;
    }

    const body: ElectionResultsResponse = {
      election: {
        id: electionId,
        countryId: election.countryId,
        electionType: election.electionType,
        state: election.state,
        status: election.status,
        cycle: election.cycle,
        electionYear: election.electionYear ?? null,
        currentTurn,
        startTurn: election.startTurn ?? null,
        endTurn: election.endTurn ?? null,
        totalSeats: election.totalSeats ?? 0,
        evNeeded,
        totalEv,
        finalHour: finalHour
          ? {
              progress: Math.round(finalHour.progress * 1000) / 1000,
              endsAt: finalHour.endsAt.toISOString(),
            }
          : null,
      },
      candidates: resultsCandidates,
      units,
      national,
      summary: {
        totalVotes: totalCastVotes,
        unitsReporting: units.filter((u) => u.totalVotes > 0).length,
        totalUnits: units.length,
        unitsCalled,
        projectedWinner,
      },
      isAdmin,
      // During the final-hour drip the payload legitimately changes every poll;
      // otherwise anchor to the tally's turn stamp so the ETag holds and polls
      // 304 between turns.
      lastUpdated: finalHour
        ? now.toISOString()
        : (tally?.updatedAt ?? election.updatedAt ?? now).toISOString(),
    };

    return conditionalJson(request, body);
  } catch (error) {
    return handleRouteError(error);
  }
}

export const GET = withApiMetrics("elections.results.GET", handleGet);
