// GET diagnoses / POST re-allocates seats for resolved House/StateSenate elections with incorrect winner counts.
// Auth: requireAdmin
// Errors: 403
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { allocateSeats } from "@/lib/turn/election/seatAllocation";
import { loadApportionment } from "@/lib/elections/apportionment";
import { getGameStateCollection } from "@/lib/db/collections";
import type {
  Election,
  ElectionVoteTally,
  ElectedOfficial,
  ElectionCandidate,
  Character,
  NPP,
} from "@/lib/db/types";

interface MisallocatedElection {
  electionId: string;
  electionType: string;
  state: string;
  totalSeats: number;
  currentWinners: number;
  expectedWinners: number;
  candidates: Array<{
    name: string;
    party: string;
    votes: number;
    currentSeats: number;
    expectedSeats: number;
  }>;
}

/**
 * GET /api/admin/heal/multi-seat-elections
 *
 * Diagnoses recently resolved House/State Senate elections where seat
 * allocation may have been incorrect (e.g., all seats going to one candidate
 * when multiple should have won).
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Find recently resolved House/State Senate elections
    const recentElections = await db
      .collection<Election>("elections")
      .find({
        electionType: { $in: ["house", "stateSenate"] },
        status: "resolved",
      })
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray();

    if (recentElections.length === 0) {
      return NextResponse.json({
        status: "no_elections",
        message: "No resolved House/State Senate elections found.",
        misallocated: [],
      });
    }

    // House seat counts are era- and census-dependent. Without the live
    // apportionment `allocateSeats` falls back to the modern 2020 map, so on a
    // 1953 world this heal "corrected" delegations to the wrong size and undid
    // the census sizing the turn loop maintains (#1190).
    const gs = await (await getGameStateCollection(db)).findOne({ _id: "current" });
    const { houseSeats } = await loadApportionment(db, gs?.preset, gs?.currentYear);

    const electionIds = recentElections.map((e) => e._id);

    // Get vote tallies for these elections
    const [tallies, allOfficials] = await Promise.all([
      db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .find({ electionId: { $in: electionIds } })
        .toArray(),
      db
        .collection<ElectedOfficial>("electedOfficials")
        .find({
          officeType: { $in: ["house", "stateSenate"] },
          state: { $in: recentElections.map((e) => e.state) },
        })
        .toArray(),
    ]);

    const tallyMap = new Map(tallies.map((t) => [t.electionId.toString(), t]));

    const misallocated: MisallocatedElection[] = [];

    for (const election of recentElections) {
      const tally = tallyMap.get(election._id.toString());
      if (!tally || !tally.totalVotes || Object.keys(tally.totalVotes).length === 0) {
        continue;
      }

      const totalSeats = election.totalSeats ?? 1;
      const totalVotesCast = Object.values(tally.totalVotes).reduce((s, v) => s + v, 0);

      if (totalVotesCast === 0) continue;

      // Build ranked candidates (party enables party-aggregate eligibility)
      const ranked = Object.entries(tally.totalVotes)
        .map(([id, votes]) => ({ id, votes, party: tally.candidateParties?.[id] }))
        .sort((a, b) => b.votes - a.votes);

      // Calculate expected allocation using updated algorithm
      const { seatsEstimate, winners } = allocateSeats(
        election.electionType,
        election.state,
        totalSeats,
        ranked,
        totalVotesCast,
        houseSeats
      );

      // Get current officials for this election
      const currentOfficials = allOfficials.filter(
        (o) => o.officeType === election.electionType && o.state === election.state
      );
      const currentWinners = currentOfficials.length;
      const expectedWinners = winners.length;

      // Check if allocation differs (compare winner counts)
      if (currentWinners !== expectedWinners) {
        // Build candidate info for display
        const candidateInfo = ranked.slice(0, Math.max(5, totalSeats)).map((r) => ({
          name: tally.candidateNames?.[r.id] ?? "Unknown",
          party: tally.candidateParties?.[r.id] ?? "Unknown",
          votes: r.votes,
          currentSeats: 0, // Would need more complex lookup
          expectedSeats: seatsEstimate[r.id] ?? 0,
        }));

        misallocated.push({
          electionId: election._id.toString(),
          electionType: election.electionType,
          state: election.state,
          totalSeats,
          currentWinners,
          expectedWinners,
          candidates: candidateInfo,
        });
      }
    }

    return NextResponse.json({
      status: misallocated.length > 0 ? "needs_fix" : "ok",
      message:
        misallocated.length > 0
          ? `Found ${misallocated.length} election(s) with potential misallocation.`
          : "All recent House/State Senate elections look correctly allocated.",
      totalChecked: recentElections.length,
      misallocated,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/multi-seat-elections
 *
 * Recalculates seat allocation for misallocated elections and updates
 * electedOfficials accordingly.
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    // Find resolved House/State Senate elections
    const recentElections = await db
      .collection<Election>("elections")
      .find({
        electionType: { $in: ["house", "stateSenate"] },
        status: "resolved",
      })
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray();

    if (recentElections.length === 0) {
      return NextResponse.json({
        healed: false,
        message: "No resolved House/State Senate elections found.",
      });
    }

    // House seat counts are era- and census-dependent. Without the live
    // apportionment `allocateSeats` falls back to the modern 2020 map, so on a
    // 1953 world this heal "corrected" delegations to the wrong size and undid
    // the census sizing the turn loop maintains (#1190).
    const gs = await (await getGameStateCollection(db)).findOne({ _id: "current" });
    const { houseSeats } = await loadApportionment(db, gs?.preset, gs?.currentYear);

    const electionIds = recentElections.map((e) => e._id);

    // Get vote tallies and candidates
    const [tallies, allCandidates] = await Promise.all([
      db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .find({ electionId: { $in: electionIds } })
        .toArray(),
      db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: { $in: electionIds } })
        .toArray(),
    ]);

    const tallyMap = new Map(tallies.map((t) => [t.electionId.toString(), t]));
    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    for (const c of allCandidates) {
      const key = c.electionId.toString();
      if (!candidatesByElection.has(key)) candidatesByElection.set(key, []);
      candidatesByElection.get(key)!.push(c);
    }

    let electionsHealed = 0;
    let officialsCreated = 0;
    let officialsRemoved = 0;

    for (const election of recentElections) {
      const tally = tallyMap.get(election._id.toString());
      if (!tally || !tally.totalVotes || Object.keys(tally.totalVotes).length === 0) {
        continue;
      }

      const totalSeats = election.totalSeats ?? 1;
      const totalVotesCast = Object.values(tally.totalVotes).reduce((s, v) => s + v, 0);

      if (totalVotesCast === 0) continue;

      // Build ranked candidates (party enables party-aggregate eligibility)
      const ranked = Object.entries(tally.totalVotes)
        .map(([id, votes]) => ({ id, votes, party: tally.candidateParties?.[id] }))
        .sort((a, b) => b.votes - a.votes);

      // Calculate correct allocation
      const { winners } = allocateSeats(
        election.electionType,
        election.state,
        totalSeats,
        ranked,
        totalVotesCast,
        houseSeats
      );

      // Get election's candidates
      const electionCandidates = candidatesByElection.get(election._id.toString()) ?? [];
      const candidateMap = new Map(electionCandidates.map((c) => [c._id.toString(), c]));

      // Remove current officials for this election
      const removeResult = await db.collection<ElectedOfficial>("electedOfficials").deleteMany({
        officeType: election.electionType,
        state: election.state,
      });
      officialsRemoved += removeResult.deletedCount;

      // Insert correct winners
      for (const [candidateId, seats] of winners) {
        const candidate = candidateMap.get(candidateId);
        if (!candidate || seats === 0) continue;

        const officialDoc: Partial<ElectedOfficial> = {
          officeType: election.electionType as ElectedOfficial["officeType"],
          state: election.state,
          isAppointment: false,
          seatsHeld: seats,
          characterId: candidate.isNPP ? null : candidate.characterId,
          characterName: candidate.characterName,
          party: candidate.party,
          isNPP: candidate.isNPP ?? false,
          nppId: candidate.nppId ?? undefined,
          electedAt: now,
          updatedAt: now,
        };

        await db.collection<ElectedOfficial>("electedOfficials").insertOne({
          _id: new ObjectId(),
          createdAt: now,
          ...officialDoc,
        } as ElectedOfficial);
        officialsCreated++;

        // Update character/NPP currentOffice
        const officeType =
          election.electionType === "house"
            ? { type: "house" as const, state: election.state, seatsHeld: seats }
            : { type: "stateSenate" as const, state: election.state, seatsHeld: seats };

        if (candidate.isNPP && candidate.nppId) {
          await db
            .collection<NPP>("npps")
            .updateOne(
              { _id: candidate.nppId },
              { $set: { currentOffice: officeType, updatedAt: now } }
            );
        } else if (candidate.characterId) {
          await db
            .collection<Character>("characters")
            .updateOne(
              { _id: candidate.characterId },
              { $set: { currentOffice: officeType, updatedAt: now } }
            );
        }
      }

      electionsHealed++;
    }

    return NextResponse.json({
      healed: true,
      electionsHealed,
      officialsRemoved,
      officialsCreated,
      message: `Healed ${electionsHealed} election(s). Removed ${officialsRemoved} old official(s), created ${officialsCreated} new official(s).`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
