import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Election, ElectionCandidate, ElectionVoteTally } from "@/lib/db/types";

// GET /api/admin/elections/heal-withdrawn-tallies — Diagnoses active election tallies that still contain data for withdrawn candidates.
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Find all active elections
    const elections = await db
      .collection<Election>("elections")
      .find({ status: { $in: ["upcoming", "active"] } })
      .toArray();
    const electionIds = elections.map((e) => e._id);

    // Get all candidates for active elections
    const candidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: electionIds } })
      .toArray();

    // Get all tallies for active elections
    const tallies = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } })
      .toArray();

    // For each tally, check if it has entries for withdrawn candidates
    const affected: {
      electionId: string;
      electionType: string;
      state: string;
      withdrawnCandidates: string[];
      staleVotes: number;
    }[] = [];

    for (const tally of tallies) {
      const electionId = tally.electionId.toString();
      const election = elections.find((e) => e._id.toString() === electionId);
      if (!election) continue;

      const electionCandidates = candidates.filter((c) => c.electionId.toString() === electionId);
      const withdrawnIds = new Set(
        electionCandidates.filter((c) => c.status === "withdrawn").map((c) => c._id.toString())
      );

      const staleEntries: string[] = [];
      let staleVotes = 0;
      for (const [candidateId, votes] of Object.entries(tally.totalVotes)) {
        if (withdrawnIds.has(candidateId)) {
          const name = tally.candidateNames?.[candidateId] ?? candidateId;
          staleEntries.push(name);
          staleVotes += votes as number;
        }
      }

      if (staleEntries.length > 0) {
        affected.push({
          electionId,
          electionType: election.electionType as string,
          state: election.state,
          withdrawnCandidates: staleEntries,
          staleVotes,
        });
      }
    }

    return NextResponse.json({
      affectedTallies: affected.length,
      affected,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/elections/heal-withdrawn-tallies — Removes withdrawn candidates' data from all active election tallies and recalculates seat estimates.
// Auth: requireAdmin
// Errors: 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Find all active elections
    const elections = await db
      .collection<Election>("elections")
      .find({ status: { $in: ["upcoming", "active"] } })
      .toArray();
    const electionIds = elections.map((e) => e._id);

    // Get all candidates for active elections
    const candidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: electionIds } })
      .toArray();

    // Get all tallies for active elections
    const tallies = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } })
      .toArray();

    let healed = 0;
    let removedCandidates = 0;

    for (const tally of tallies) {
      const electionId = tally.electionId.toString();

      const electionCandidates = candidates.filter((c) => c.electionId.toString() === electionId);
      const activeIds = new Set(
        electionCandidates.filter((c) => c.status === "active").map((c) => c._id.toString())
      );

      // Find stale entries in tally
      const staleIds = Object.keys(tally.totalVotes).filter((id) => !activeIds.has(id));
      if (staleIds.length === 0) continue;

      // Build $unset to remove stale entries
      const unsetPaths: Record<string, ""> = {};
      for (const id of staleIds) {
        unsetPaths[`totalVotes.${id}`] = "";
        unsetPaths[`candidateNames.${id}`] = "";
        unsetPaths[`candidateParties.${id}`] = "";
        if (tally.seatsEstimate && id in tally.seatsEstimate) {
          unsetPaths[`seatsEstimate.${id}`] = "";
        }
      }

      // Recalculate seatsEstimate from active-only votes
      const election = elections.find((e) => e._id.toString() === electionId);
      const totalSeats = election?.totalSeats as number | undefined;
      let newSeatsEstimate: Record<string, number> | undefined;
      if (
        totalSeats &&
        ["house", "stateSenate", "commons", "snap_commons"].includes(
          election?.electionType as string
        )
      ) {
        const activeVotes: Record<string, number> = {};
        let totalActiveVotes = 0;
        for (const cid of activeIds) {
          const v = tally.totalVotes[cid] ?? 0;
          if (v > 0) {
            activeVotes[cid] = v;
            totalActiveVotes += v;
          }
        }
        if (totalActiveVotes > 0) {
          const allocs = Object.entries(activeVotes).map(([cid, v]) => {
            const exact = (v / totalActiveVotes) * totalSeats;
            return { cid, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
          });
          newSeatsEstimate = {};
          let allocated = 0;
          for (const a of allocs) {
            newSeatsEstimate[a.cid] = a.floor;
            allocated += a.floor;
          }
          const remaining = totalSeats - allocated;
          if (remaining > 0) {
            const sorted = [...allocs].sort((a, b) => b.remainder - a.remainder);
            for (let i = 0; i < remaining && i < sorted.length; i++) {
              newSeatsEstimate[sorted[i].cid]++;
            }
          }
        }
      }

      await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
        { electionId: tally.electionId },
        {
          $unset: unsetPaths,
          $set: {
            ...(newSeatsEstimate ? { seatsEstimate: newSeatsEstimate } : {}),
            updatedAt: new Date(),
          },
        }
      );

      healed++;
      removedCandidates += staleIds.length;
    }

    if (healed === 0) {
      return NextResponse.json({
        message: "No tallies needed healing — all clean.",
      });
    }

    return NextResponse.json({
      message: `Healed ${healed} tally record(s), removed ${removedCandidates} withdrawn candidate entries.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
