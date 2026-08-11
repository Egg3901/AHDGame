import { NextResponse } from "next/server";
import type { NPP, Election, ElectionCandidate } from "@/lib/db/types";
import type { Db } from "@/lib/mongodb";

export async function handleRemoveNPPs(
  db: Db,
  stateFilter: string[] | undefined
): Promise<NextResponse> {
  const electionQuery: Record<string, unknown> = {
    status: { $in: ["upcoming", "active"] },
  };

  if (stateFilter && stateFilter.length > 0) {
    electionQuery.state = { $in: stateFilter };
  }

  const elections = await db.collection<Election>("elections").find(electionQuery).toArray();

  const electionIds = elections.map((e) => e._id);

  const nppCandidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      electionId: { $in: electionIds },
      isNPP: true,
    })
    .toArray();

  const removeResult = await db.collection<ElectionCandidate>("electionCandidates").deleteMany({
    electionId: { $in: electionIds },
    isNPP: true,
  });

  const nppIds = nppCandidates.filter((c) => c.nppId).map((c) => c.nppId!);

  if (nppIds.length > 0) {
    await db
      .collection<NPP>("npps")
      .updateMany(
        { _id: { $in: nppIds } },
        { $set: { retiredAt: new Date(), currentOffice: null, updatedAt: new Date() } }
      );
  }

  const stateDesc =
    stateFilter && stateFilter.length > 0 ? `in ${stateFilter.join(", ")}` : "in all states";

  return NextResponse.json({
    message: `Removed ${removeResult.deletedCount} NPP candidate(s) ${stateDesc}`,
    removed: removeResult.deletedCount,
  });
}
