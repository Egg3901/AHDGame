/**
 * GET  /api/admin/country/[code]/state-party-elections
 *   List all party leadership elections (state, national, committee) - filterable.
 *
 * POST /api/admin/country/[code]/state-party-elections
 *   body: { action: "batch-resolve" | "batch-create" | "batch-restart", durationTurns?: number }
 *   batch-resolve: force-resolve all elections whose endTurn <= currentTurn.
 *   batch-create:  create missing elections for all party x position combos.
 *   batch-restart: cancel all voting elections, remove candidates, and recreate.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import {
  processCompletedElections,
  createMissingElections,
  POSITION_LABELS,
  ELECTION_DURATION_TURNS,
} from "@/lib/statePartyElections";
import {
  processCompletedNationalElections,
  createMissingNationalElections,
  NATIONAL_ELECTION_DURATION_TURNS,
} from "@/lib/nationalPartyElections";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import {
  processCompletedCommitteeElections,
  createMissingCommitteeElections,
  COMMITTEE_ELECTION_DURATION_TURNS,
} from "@/lib/nationalCommitteeElections";
import type {
  StatePartyElection,
  NationalPartyElection,
  NationalCommitteeElection,
  PoliticalParty,
} from "@/lib/db/types";
import {
  COUNTRY_CONFIGS,
  DEFAULT_LEGACY_COUNTRY_ID,
  type CountryId,
} from "@/lib/constants/countries";
import { getGameTime } from "@/lib/time/gameTime";

// Schema for POST requests
const batchSchema = z.object({
  action: z.enum(["batch-resolve", "batch-create", "batch-restart"]),
  durationTurns: z.number().positive().optional(),
  includeNational: z.boolean().optional(),
  includeCommittee: z.boolean().optional(),
});

function applyOptionalCountryScope(
  baseQuery: Record<string, unknown>,
  countryId?: CountryId
): Record<string, unknown> {
  // No countryId → "all countries": apply no country scope.
  if (!countryId) return baseQuery;
  const countryQuery: Record<string, unknown> =
    countryId === DEFAULT_LEGACY_COUNTRY_ID
      ? {
          $or: [{ countryId: DEFAULT_LEGACY_COUNTRY_ID }, { countryId: { $exists: false } }],
        }
      : { countryId };

  if (Object.keys(baseQuery).length === 0) {
    return countryQuery;
  }

  return { $and: [baseQuery, countryQuery] };
}

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    // "all" is a cross-country view: skip country validation and scoping.
    const allCountries = code.toLowerCase() === "all";
    const filterCountry = code.toUpperCase() as CountryId;
    if (!allCountries && !COUNTRY_CONFIGS[filterCountry]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const filterState = searchParams.get("state") ?? undefined;
    const filterParty = searchParams.get("party") ?? undefined;
    const filterPosition = searchParams.get("position") ?? undefined; // "chair" | "viceChair" | "treasurer" | "committee"
    const filterStatus = searchParams.get("status") ?? undefined;
    const electionType = searchParams.get("type") ?? "all"; // "state", "national", "committee", "all"

    const db = await getDb();
    const { currentTurn } = await getGameTime();

    // Fetch all parties for name lookup
    const parties = await db.collection<PoliticalParty>("politicalParties").find({}).toArray();
    const partyByCountryAndSeqId = new Map<string, PoliticalParty>();
    for (const p of parties) {
      partyByCountryAndSeqId.set(`${p.countryId}:${p.sequentialId}`, p);
    }
    const resolvePartyName = (partyId: string, countryId: CountryId): string => {
      if (partyId === "independent" || !partyId) return "Independent";
      const party = partyByCountryAndSeqId.get(`${countryId}:${partyId}`);
      return party?.name ?? `Party ${partyId}`;
    };

    // Collect all election results
    interface ElectionRow {
      id: string;
      electionType: "state" | "national" | "committee";
      countryId: CountryId;
      stateId: string | null;
      partyId: string;
      partyName: string;
      position: string;
      positionLabel: string;
      status: string;
      startTurn: number;
      endTurn: number;
      durationTurns: number;
      turnsRemaining: number;
      candidateCount: number;
      totalVotes: number;
    }
    const allRows: ElectionRow[] = [];

    // 1. State party elections
    if (electionType === "all" || electionType === "state") {
      const stateQuery: Record<string, unknown> = {};
      if (filterState) stateQuery.stateId = filterState.toUpperCase();
      if (filterParty) stateQuery.partyId = filterParty;
      if (filterPosition && filterPosition !== "committee") stateQuery.position = filterPosition;
      if (filterStatus) stateQuery.status = filterStatus;

      const stateElections = await db
        .collection<StatePartyElection>("statePartyElections")
        .find(stateQuery)
        .sort({ endTurn: 1, stateId: 1, partyId: 1 })
        .toArray();

      // Filter by country — elections with countryId use it; legacy elections without are assumed US.
      // For the "all" view, keep every country.
      const filteredStateElections = allCountries
        ? stateElections
        : stateElections.filter((e) => (e.countryId ?? "US") === filterCountry);

      // Filter by party name if needed
      const partyFilteredStateElections = filterParty
        ? filteredStateElections.filter((e) => {
            const countryId = (e.countryId ?? "US") as CountryId;
            const partyName = resolvePartyName(e.partyId, countryId).toLowerCase();
            return e.partyId === filterParty || partyName.includes(filterParty.toLowerCase());
          })
        : filteredStateElections;

      const stateIds = partyFilteredStateElections.map((e) => e._id);

      const [stateVotes, stateCands] = await Promise.all([
        stateIds.length > 0
          ? db
              .collection("statePartyVotes")
              .aggregate<{ _id: string; count: number }>([
                { $match: { electionId: { $in: stateIds } } },
                { $group: { _id: { $toString: "$electionId" }, count: { $sum: 1 } } },
              ])
              .toArray()
          : [],
        stateIds.length > 0
          ? db
              .collection("statePartyCandidates")
              .aggregate<{ _id: string; count: number }>([
                { $match: { electionId: { $in: stateIds }, status: "active" } },
                { $group: { _id: { $toString: "$electionId" }, count: { $sum: 1 } } },
              ])
              .toArray()
          : [],
      ]);
      const stateVoteMap = new Map(stateVotes.map((v) => [v._id, v.count]));
      const stateCandMap = new Map(stateCands.map((v) => [v._id, v.count]));

      for (const e of partyFilteredStateElections) {
        const eid = e._id.toString();
        const countryId = (e.countryId ?? "US") as CountryId;
        allRows.push({
          id: eid,
          electionType: "state",
          countryId,
          stateId: e.stateId,
          partyId: e.partyId,
          partyName: resolvePartyName(e.partyId, countryId),
          position: e.position,
          positionLabel: POSITION_LABELS[e.position],
          status: e.status,
          startTurn: e.startTurn,
          endTurn: e.endTurn,
          durationTurns: e.durationTurns,
          turnsRemaining: Math.max(0, e.endTurn - currentTurn),
          candidateCount: stateCandMap.get(eid) ?? 0,
          totalVotes: stateVoteMap.get(eid) ?? 0,
        });
      }
    }

    // 2. National party elections
    if (electionType === "all" || electionType === "national") {
      const nationalQuery: Record<string, unknown> = allCountries
        ? {}
        : { countryId: filterCountry };
      if (filterParty) nationalQuery.partyId = filterParty;
      if (filterPosition && filterPosition !== "committee") nationalQuery.position = filterPosition;
      if (filterStatus) nationalQuery.status = filterStatus;

      const nationalElections = await db
        .collection<NationalPartyElection>("nationalPartyElections")
        .find(nationalQuery)
        .sort({ endTurn: 1, partyId: 1 })
        .toArray();

      // Filter by party name if needed
      const partyFilteredNationalElections = filterParty
        ? nationalElections.filter((e) => {
            const countryId = e.countryId ?? "US";
            const partyName = resolvePartyName(e.partyId, countryId).toLowerCase();
            return e.partyId === filterParty || partyName.includes(filterParty.toLowerCase());
          })
        : nationalElections;

      const nationalIds = partyFilteredNationalElections.map((e) => e._id);

      const [nationalVotes, nationalCands] = await Promise.all([
        nationalIds.length > 0
          ? db
              .collection("nationalPartyVotes")
              .aggregate<{ _id: string; count: number }>([
                { $match: { electionId: { $in: nationalIds } } },
                { $group: { _id: { $toString: "$electionId" }, count: { $sum: 1 } } },
              ])
              .toArray()
          : [],
        nationalIds.length > 0
          ? db
              .collection("nationalPartyCandidates")
              .aggregate<{ _id: string; count: number }>([
                { $match: { electionId: { $in: nationalIds }, status: "active" } },
                { $group: { _id: { $toString: "$electionId" }, count: { $sum: 1 } } },
              ])
              .toArray()
          : [],
      ]);
      const nationalVoteMap = new Map(nationalVotes.map((v) => [v._id, v.count]));
      const nationalCandMap = new Map(nationalCands.map((v) => [v._id, v.count]));

      for (const e of partyFilteredNationalElections) {
        const eid = e._id.toString();
        const countryId = e.countryId ?? "US";
        allRows.push({
          id: eid,
          electionType: "national",
          countryId,
          stateId: null,
          partyId: e.partyId,
          partyName: resolvePartyName(e.partyId, countryId),
          position: e.position,
          positionLabel: getPartyRoleLabel(countryId, e.position),
          status: e.status,
          startTurn: e.startTurn,
          endTurn: e.endTurn,
          durationTurns: e.durationTurns,
          turnsRemaining: Math.max(0, e.endTurn - currentTurn),
          candidateCount: nationalCandMap.get(eid) ?? 0,
          totalVotes: nationalVoteMap.get(eid) ?? 0,
        });
      }
    }

    // 3. National committee elections
    if (electionType === "all" || electionType === "committee") {
      const committeeQuery: Record<string, unknown> = allCountries
        ? {}
        : { countryId: filterCountry };
      if (filterParty) committeeQuery.partyId = filterParty;
      if (filterStatus) committeeQuery.status = filterStatus;

      const committeeElections = await db
        .collection<NationalCommitteeElection>("nationalCommitteeElections")
        .find(committeeQuery)
        .sort({ endTurn: 1, partyId: 1 })
        .toArray();

      // Filter by party name if needed
      const partyFilteredCommitteeElections = filterParty
        ? committeeElections.filter((e) => {
            const countryId = e.countryId ?? "US";
            const partyName = resolvePartyName(e.partyId, countryId).toLowerCase();
            return e.partyId === filterParty || partyName.includes(filterParty.toLowerCase());
          })
        : committeeElections;

      const committeeIds = partyFilteredCommitteeElections.map((e) => e._id);

      const [committeeVotes, committeeCands] = await Promise.all([
        committeeIds.length > 0
          ? db
              .collection("nationalCommitteeVotes")
              .aggregate<{ _id: string; count: number }>([
                { $match: { electionId: { $in: committeeIds } } },
                { $group: { _id: { $toString: "$electionId" }, count: { $sum: 1 } } },
              ])
              .toArray()
          : [],
        committeeIds.length > 0
          ? db
              .collection("nationalCommitteeCandidates")
              .aggregate<{ _id: string; count: number }>([
                { $match: { electionId: { $in: committeeIds }, status: "active" } },
                { $group: { _id: { $toString: "$electionId" }, count: { $sum: 1 } } },
              ])
              .toArray()
          : [],
      ]);
      const committeeVoteMap = new Map(committeeVotes.map((v) => [v._id, v.count]));
      const committeeCandMap = new Map(committeeCands.map((v) => [v._id, v.count]));

      for (const e of partyFilteredCommitteeElections) {
        const eid = e._id.toString();
        const countryId = e.countryId ?? "US";
        allRows.push({
          id: eid,
          electionType: "committee",
          countryId,
          stateId: null,
          partyId: e.partyId,
          partyName: resolvePartyName(e.partyId, countryId),
          position: "committee",
          positionLabel: getPartyRoleLabel(countryId, "committee"),
          status: e.status,
          startTurn: e.startTurn,
          endTurn: e.endTurn,
          durationTurns: e.durationTurns,
          turnsRemaining: Math.max(0, e.endTurn - currentTurn),
          candidateCount: committeeCandMap.get(eid) ?? 0,
          totalVotes: committeeVoteMap.get(eid) ?? 0,
        });
      }
    }

    // Sort by endTurn, then country, then stateId, then partyId
    allRows.sort((a, b) => {
      if (a.endTurn !== b.endTurn) return a.endTurn - b.endTurn;
      if (a.countryId !== b.countryId) return a.countryId.localeCompare(b.countryId);
      if (a.stateId !== b.stateId) return (a.stateId ?? "").localeCompare(b.stateId ?? "");
      return a.partyId.localeCompare(b.partyId);
    });

    return NextResponse.json({ elections: allRows, total: allRows.length, currentTurn });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    // "all" runs the batch action across every country (resolver/create helpers
    // treat an undefined countryId as "all countries").
    const allCountries = code.toLowerCase() === "all";
    const filterCountry = code.toUpperCase() as CountryId;
    if (!allCountries && !COUNTRY_CONFIGS[filterCountry]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const scopeCountry = allCountries ? undefined : filterCountry;

    const parsed = await parseJsonBody(request, batchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action, durationTurns, includeNational = true, includeCommittee = true } = parsed.data;

    const db = await getDb();
    const { currentTurn, effectiveNow } = await getGameTime();

    if (action === "batch-resolve") {
      const stateResolved = await processCompletedElections(
        currentTurn,
        effectiveNow,
        scopeCountry
      );
      let nationalResolved = 0;
      let committeeResolved = 0;

      if (includeNational) {
        nationalResolved = await processCompletedNationalElections(
          currentTurn,
          effectiveNow,
          scopeCountry
        );
      }
      if (includeCommittee) {
        committeeResolved = await processCompletedCommitteeElections(
          currentTurn,
          effectiveNow,
          scopeCountry
        );
      }

      const total = stateResolved + nationalResolved + committeeResolved;
      return NextResponse.json({
        success: true,
        message: `Resolved ${stateResolved} state + ${nationalResolved} national + ${committeeResolved} committee election(s).`,
        resolved: total,
        stateResolved,
        nationalResolved,
        committeeResolved,
      });
    }

    if (action === "batch-create") {
      const stateDuration =
        typeof durationTurns === "number" && durationTurns > 0
          ? durationTurns
          : ELECTION_DURATION_TURNS;
      const nationalDuration =
        typeof durationTurns === "number" && durationTurns > 0
          ? durationTurns
          : NATIONAL_ELECTION_DURATION_TURNS;
      const committeeDuration =
        typeof durationTurns === "number" && durationTurns > 0
          ? durationTurns
          : COMMITTEE_ELECTION_DURATION_TURNS;

      const stateCreated = await createMissingElections(
        currentTurn,
        stateDuration,
        effectiveNow,
        scopeCountry
      );
      let nationalCreated = 0;
      let committeeCreated = 0;

      if (includeNational) {
        nationalCreated = await createMissingNationalElections(
          currentTurn,
          nationalDuration,
          effectiveNow,
          scopeCountry
        );
      }
      if (includeCommittee) {
        committeeCreated = await createMissingCommitteeElections(
          currentTurn,
          committeeDuration,
          effectiveNow,
          scopeCountry
        );
      }

      const total = stateCreated + nationalCreated + committeeCreated;
      return NextResponse.json({
        success: true,
        message: `Created ${stateCreated} state + ${nationalCreated} national + ${committeeCreated} committee election(s).`,
        created: total,
        stateCreated,
        nationalCreated,
        committeeCreated,
      });
    }

    if (action === "batch-restart") {
      const duration = typeof durationTurns === "number" && durationTurns > 0 ? durationTurns : 96;
      const now = new Date();
      const stateElectionFilter = applyOptionalCountryScope({ status: "voting" }, scopeCountry);
      const nationalElectionFilter = applyOptionalCountryScope({ status: "voting" }, scopeCountry);
      const committeeElectionFilter = applyOptionalCountryScope({ status: "voting" }, scopeCountry);

      const [stateVotingElections, nationalVotingElections, committeeVotingElections] =
        await Promise.all([
          db
            .collection<StatePartyElection>("statePartyElections")
            .find(stateElectionFilter)
            .toArray(),
          includeNational
            ? db
                .collection<NationalPartyElection>("nationalPartyElections")
                .find(nationalElectionFilter)
                .toArray()
            : Promise.resolve([] as NationalPartyElection[]),
          includeCommittee
            ? db
                .collection<NationalCommitteeElection>("nationalCommitteeElections")
                .find(committeeElectionFilter)
                .toArray()
            : Promise.resolve([] as NationalCommitteeElection[]),
        ]);
      const stateElectionIds = stateVotingElections.map((e) => e._id);
      const nationalElectionIds = nationalVotingElections.map((e) => e._id);
      const committeeElectionIds = committeeVotingElections.map((e) => e._id);

      // Cancel all voting state elections and their candidates
      const stateElectionsCancelled =
        stateElectionIds.length > 0
          ? await db
              .collection<StatePartyElection>("statePartyElections")
              .updateMany(
                { _id: { $in: stateElectionIds } },
                { $set: { status: "cancelled", updatedAt: now } }
              )
          : { modifiedCount: 0 };

      if (stateElectionIds.length > 0) {
        await db
          .collection("statePartyCandidates")
          .updateMany(
            { electionId: { $in: stateElectionIds }, status: "active" },
            { $set: { status: "withdrawn", withdrawnAt: now } }
          );
      }

      // Cancel all voting national elections and their candidates
      let nationalElectionsCancelled = { modifiedCount: 0 };
      if (includeNational && nationalElectionIds.length > 0) {
        nationalElectionsCancelled = await db
          .collection<NationalPartyElection>("nationalPartyElections")
          .updateMany(
            { _id: { $in: nationalElectionIds } },
            { $set: { status: "cancelled", updatedAt: now } }
          );

        await db
          .collection("nationalPartyCandidates")
          .updateMany(
            { electionId: { $in: nationalElectionIds }, status: "active" },
            { $set: { status: "withdrawn", withdrawnAt: now } }
          );
      }

      // Cancel all voting committee elections and their candidates
      let committeeElectionsCancelled = { modifiedCount: 0 };
      if (includeCommittee && committeeElectionIds.length > 0) {
        committeeElectionsCancelled = await db
          .collection<NationalCommitteeElection>("nationalCommitteeElections")
          .updateMany(
            { _id: { $in: committeeElectionIds } },
            { $set: { status: "cancelled", updatedAt: now } }
          );

        await db
          .collection("nationalCommitteeCandidates")
          .updateMany(
            { electionId: { $in: committeeElectionIds }, status: "active" },
            { $set: { status: "withdrawn", withdrawnAt: now } }
          );
      }

      // Create new elections
      const stateCreated = await createMissingElections(
        currentTurn,
        duration,
        effectiveNow,
        scopeCountry
      );
      let nationalCreated = 0;
      let committeeCreated = 0;

      if (includeNational) {
        nationalCreated = await createMissingNationalElections(
          currentTurn,
          duration,
          effectiveNow,
          scopeCountry
        );
      }
      if (includeCommittee) {
        committeeCreated = await createMissingCommitteeElections(
          currentTurn,
          duration,
          effectiveNow,
          scopeCountry
        );
      }

      const totalCancelled =
        stateElectionsCancelled.modifiedCount +
        nationalElectionsCancelled.modifiedCount +
        committeeElectionsCancelled.modifiedCount;
      const totalCreated = stateCreated + nationalCreated + committeeCreated;

      return NextResponse.json({
        success: true,
        message: `Cancelled ${totalCancelled} elections, created ${totalCreated} new elections (${duration} turns each).`,
        cancelled: totalCancelled,
        created: totalCreated,
        stateCancelled: stateElectionsCancelled.modifiedCount,
        nationalCancelled: nationalElectionsCancelled.modifiedCount,
        committeeCancelled: committeeElectionsCancelled.modifiedCount,
        stateCreated,
        nationalCreated,
        committeeCreated,
      });
    }

    return NextResponse.json(
      { error: "action must be batch-resolve, batch-create, or batch-restart" },
      { status: 400 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
