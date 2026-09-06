import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { handleRouteError } from "@/lib/api/errors";
import { getSubdivisionMode } from "@/lib/maps/subdivisionConfig";
import { loadSubdivisionFile } from "@/lib/maps/subdivisionData";
import {
  distributeSubdivisionVotes,
  assignSeatConsistentWinners,
  assignByLeanOrdering,
  type CandidateDistributionInfo,
} from "@/lib/utils/subdivisionResults";
import { allocateSeats, getMajoritarianBonus } from "@/lib/turn/election/seatAllocation";
import type { ElectionVoteTally, PoliticalParty } from "@/lib/db/types";
import { getPartyHex } from "@/lib/utils/politics";

// GET /api/elections/[id]/state/[stateId]/subdivision-results — sub-region
// vote distribution + seat-consistent winners for a region in an election.
// Auth: public
// Errors: 400, 404
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stateId: string }> }
) {
  try {
    const { id, stateId } = await params;
    const regionId = stateId.toUpperCase();
    // regionId feeds a filesystem path — reject anything but region-code shapes.
    if (!/^[A-Z]{2,3}$/.test(regionId)) {
      return NextResponse.json({ error: "Invalid region ID" }, { status: 400 });
    }

    const db = await getDb();
    const resolved = await resolveElectionRouteParam(db, id);
    if (!resolved.ok) {
      if (resolved.reason === "invalid_id") {
        return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
      }
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }
    const election = resolved.election;

    const modeEntry = getSubdivisionMode(election.countryId, String(election.electionType));
    if (!modeEntry) {
      return NextResponse.json(
        { error: "Subdivision map data is not available for this election" },
        { status: 404 }
      );
    }

    const data = await loadSubdivisionFile(modeEntry.config.dataDir, regionId);
    if (!data) {
      return NextResponse.json(
        { error: "Subdivision data not available for this region" },
        { status: 404 }
      );
    }

    const tally = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: election._id });
    if (!tally) return NextResponse.json({ error: "No tally found" }, { status: 404 });
    // Presidential tallies span all regions (aggregated below); everything else
    // must be the requested region's own tally — legacy county-results behavior.
    const isPresident = String(election.electionType) === "president";
    if (!isPresident && tally.state !== regionId) {
      return NextResponse.json({ error: "Tally state mismatch" }, { status: 400 });
    }

    const regionVotes = isPresident
      ? (tally.totalVotesByUnit?.[regionId] ?? tally.totalVotes)
      : tally.totalVotes;

    // Party docs: colors, economic positions, and abbreviations for baselines.
    const uniquePartySeqIds = [...new Set(Object.values(tally.candidateParties ?? {}))]
      .map(Number)
      .filter(Boolean);
    const partyDocs = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ sequentialId: { $in: uniquePartySeqIds }, countryId: election.countryId })
      .toArray();
    const partyBySeqId = new Map(partyDocs.map((p) => [String(p.sequentialId), p]));

    const partyColors: Record<string, string> = {};
    const partyEconPositions: Record<string, number> = {};
    for (const party of partyDocs) {
      const partyId = String(party.sequentialId);
      partyColors[partyId] = getPartyHex(partyId, party.color);
      partyEconPositions[partyId] = party.economicPosition;
    }

    // seatOrdered (US house): no vote distribution — seats assigned to
    // subdivisions by lean ordering, exactly the legacy cd-results behavior.
    if (modeEntry.mode === "seatOrdered") {
      const seatResults = assignByLeanOrdering(
        data.subdivisions,
        tally.seatsEstimate ?? {},
        tally.candidateParties ?? {},
        partyEconPositions
      );
      const cdById = new Map(data.subdivisions.map((s) => [s.id, s]));
      return NextResponse.json({
        viewBox: data.viewBox,
        mode: modeEntry.mode,
        unitLabel: modeEntry.config.unitLabel ?? "Subdivision",
        unitLabelPlural: modeEntry.config.unitLabelPlural ?? "Subdivisions",
        subdivisions: seatResults.map((r) => {
          const src = cdById.get(r.id);
          return {
            ...r,
            name: src?.name ?? r.id,
            path: src?.path ?? "",
            leanScalar: src?.leanScalar,
          };
        }),
        candidateNames: tally.candidateNames,
        candidateParties: tally.candidateParties,
        partyColors,
      });
    }

    // Which abbreviations actually have baselines in this region's data?
    const baselineKeys = new Set<string>();
    for (const sub of data.subdivisions) {
      for (const key of Object.keys(sub.partyShares ?? {})) baselineKeys.add(key);
    }

    const candidates: Record<string, CandidateDistributionInfo> = {};
    for (const cid of Object.keys(regionVotes)) {
      const party = partyBySeqId.get(tally.candidateParties?.[cid] ?? "");
      const abbr = party?.abbreviation;
      candidates[cid] = {
        baselineKey: abbr && baselineKeys.has(abbr) ? abbr : undefined,
        econPosition: party?.economicPosition ?? 0,
      };
    }

    const distributed = distributeSubdivisionVotes(data.subdivisions, regionVotes, candidates);

    // Seat-consistent modes force winners to match the actual seat allocation:
    // stored allocation first (what resolution actually seated), else recompute
    // with the exact rules the resolver uses. Distributed mode (US statewide
    // races) has no seats — winners are pure vote leaders.
    let seatsByCandidate: Record<string, number> | undefined;
    let results = distributed;
    if (modeEntry.mode === "seatConsistent") {
      seatsByCandidate = tally.seatsEstimate;
      if (!seatsByCandidate || Object.keys(seatsByCandidate).length === 0) {
        const ranked = Object.entries(regionVotes)
          .map(([cid, votes]) => ({ id: cid, votes, party: tally.candidateParties?.[cid] }))
          .sort((a, b) => b.votes - a.votes);
        const totalVotesCast = ranked.reduce((s, r) => s + r.votes, 0);
        // FPTP winner's bonus (#3244): recompute with the resolver's exact
        // rules — cube-law while the current in-game year is pre-1999, else
        // proportional.
        const gsForYear = await db
          .collection<{ _id: string; currentYear?: number }>("gameState")
          .findOne({ _id: "current" }, { projection: { currentYear: 1 } });
        seatsByCandidate = allocateSeats(
          String(election.electionType),
          regionId,
          election.totalSeats ?? data.subdivisions.length,
          ranked,
          totalVotesCast,
          undefined,
          getMajoritarianBonus(String(election.electionType), gsForYear?.currentYear)
        ).seatsEstimate;
      }
      results = assignSeatConsistentWinners(distributed, seatsByCandidate);
    }

    const subById = new Map(data.subdivisions.map((s) => [s.id, s]));
    return NextResponse.json({
      viewBox: data.viewBox,
      mode: modeEntry.mode,
      unitLabel: modeEntry.config.unitLabel ?? "Subdivision",
      unitLabelPlural: modeEntry.config.unitLabelPlural ?? "Subdivisions",
      subdivisions: results.map((r) => {
        const src = subById.get(r.id);
        return {
          ...r,
          path: src?.path ?? "",
          leanScalar: src?.leanScalar,
          electorate: src?.electorate,
        };
      }),
      candidateNames: tally.candidateNames,
      candidateParties: tally.candidateParties,
      partyColors,
      ...(seatsByCandidate ? { seatsByCandidate } : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
