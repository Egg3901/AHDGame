import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { adminNppsSchema } from "@/lib/api/schemas/admin";
import { handleRouteError } from "@/lib/api/errors";
import { removeWithdrawnCandidateFromTally } from "@/lib/electionEngine/tallyCleaner";
import type {
  NPP,
  Election,
  ElectionCandidate,
  ElectedOfficial,
  PoliticalParty,
} from "@/lib/db/types";
import { handleBackfillImages } from "./lib/imageBackfill";
import { handleGenerateNPPs } from "./lib/generate";
import { handleRemoveNPPs } from "./lib/remove";
import { handleSpawnNPPs } from "./lib/spawn";

// GET /api/admin/npps — Returns NPP statistics including totals, counts by state and party, and recent NPPs
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const totalNPPs = await db.collection<NPP>("npps").countDocuments({ retiredAt: null });
    const nppsByState = await db
      .collection<NPP>("npps")
      .aggregate([
        { $match: { retiredAt: null } },
        { $group: { _id: "$homeState", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    // Get party info for name lookup - key by countryId:sequentialId since
    // different countries can have the same sequentialId for different parties
    const allParties = await db.collection<PoliticalParty>("politicalParties").find({}).toArray();
    const partyMap = new Map<string, { name: string; color: string }>();
    for (const p of allParties) {
      partyMap.set(`${p.countryId}:${p.sequentialId}`, {
        name: p.name,
        color: p.color,
      });
    }

    // Group NPPs by country and party
    const nppsByCountryAndParty = await db
      .collection<NPP>("npps")
      .aggregate([
        { $match: { retiredAt: null } },
        { $group: { _id: { countryId: "$countryId", party: "$party" }, count: { $sum: 1 } } },
        { $sort: { "_id.countryId": 1, count: -1 } },
      ])
      .toArray();

    // Transform into country-grouped structure with party names
    const nppsByPartyGrouped: Record<
      string,
      { partyId: string; partyName: string; color: string; count: number }[]
    > = {};
    for (const item of nppsByCountryAndParty) {
      const countryId = item._id.countryId || "Unknown";
      const partyId = item._id.party;
      // Look up party by countryId:partyId to get the correct party for this country
      const partyInfo = partyMap.get(`${countryId}:${partyId}`);

      if (!nppsByPartyGrouped[countryId]) {
        nppsByPartyGrouped[countryId] = [];
      }

      nppsByPartyGrouped[countryId].push({
        partyId,
        partyName:
          partyInfo?.name || (partyId === "independent" ? "Independent" : `Party ${partyId}`),
        color: partyInfo?.color || "#888888",
        count: item.count,
      });
    }

    // Legacy format for backwards compatibility
    const nppsByParty = nppsByCountryAndParty.map((p) => ({
      party: p._id.party,
      count: p.count,
    }));

    const nppCandidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .countDocuments({
        isNPP: true,
        status: "active",
      });

    const recentNPPs = await db
      .collection<NPP>("npps")
      .find({ retiredAt: null })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({
      totalNPPs,
      nppCandidates,
      nppsByState: nppsByState.map((s) => ({ state: s._id, count: s.count })),
      nppsByParty,
      nppsByPartyGrouped,
      recentNPPs,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/npps — Generates, spawns, removes, or backfills images for NPPs based on the requested action
// Auth: requireAdmin
// Errors: 400, 403
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, adminNppsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;
    const { action, states, parties, partyData } = body;

    const db = await getDb();

    if (action === "generate") {
      return await handleGenerateNPPs(db, states, parties, partyData);
    }
    if (action === "spawn") {
      return await handleSpawnNPPs(db, body);
    }
    if (action === "backfill_images") {
      return await handleBackfillImages(db);
    }
    return await handleRemoveNPPs(db, states);
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/admin/npps — Retires NPPs and removes their candidacies or vacates their elected seats
// Auth: requireAdmin
// Errors: 403
export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const statesParam = searchParams.get("states");
    const candidatesOnly = searchParams.get("candidates_only") === "true";
    const vacateSeatsOnly = searchParams.get("vacate_seats_only") === "true";
    const independentsOnly = searchParams.get("independents_only") === "true";

    const states = statesParam
      ? statesParam.split(",").map((s) => s.trim().toUpperCase())
      : undefined;

    const db = await getDb();
    const now = new Date();

    // Handle vacate_seats_only mode: only remove retired NPPs from elected positions
    if (vacateSeatsOnly) {
      const retiredNppQuery: Record<string, unknown> = { retiredAt: { $ne: null } };
      if (states && states.length > 0) {
        retiredNppQuery.homeState = { $in: states };
      }

      // Get all retired NPPs
      const retiredNpps = await db.collection<NPP>("npps").find(retiredNppQuery).toArray();
      const retiredNppIds = retiredNpps.map((n) => n._id);

      let seatsVacated = 0;
      if (retiredNppIds.length > 0) {
        // Find and vacate all seats held by retired NPPs
        const seatsResult = await db.collection<ElectedOfficial>("electedOfficials").updateMany(
          { nppId: { $in: retiredNppIds } },
          {
            $set: { characterId: null, isNPP: false, updatedAt: now },
            $unset: { nppId: "", characterName: "", party: "" },
          }
        );
        seatsVacated = seatsResult.modifiedCount;

        // Clear currentOffice on those NPPs
        await db
          .collection<NPP>("npps")
          .updateMany(
            { _id: { $in: retiredNppIds }, currentOffice: { $ne: null } },
            { $set: { currentOffice: null, updatedAt: now } }
          );
      }

      const stateDesc = states && states.length > 0 ? `in ${states.join(", ")}` : "in all states";
      return NextResponse.json({
        message: `Vacated ${seatsVacated} seat(s) held by retired NPPs ${stateDesc}`,
        seatsVacated,
        nppsRetired: 0,
        candidatesRemoved: 0,
      });
    }

    // Handle independents_only mode: retire Independent NPPs, remove from elections, recalculate
    if (independentsOnly) {
      // Find Independent NPPs (party is null, undefined, or "independent")
      const independentNppQuery: Record<string, unknown> = {
        retiredAt: null,
        $or: [{ party: null }, { party: { $exists: false } }, { party: "independent" }],
      };
      if (states && states.length > 0) {
        independentNppQuery.homeState = { $in: states };
      }

      const independentNpps = await db.collection<NPP>("npps").find(independentNppQuery).toArray();
      const independentNppIds = independentNpps.map((n) => n._id);

      if (independentNppIds.length === 0) {
        const stateDesc = states && states.length > 0 ? `in ${states.join(", ")}` : "";
        return NextResponse.json({
          message: `No Independent NPPs found ${stateDesc}`.trim(),
          nppsRetired: 0,
          candidatesRemoved: 0,
          electionsUpdated: 0,
        });
      }

      // Find all election candidates for these Independent NPPs
      const independentCandidates = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({
          isNPP: true,
          nppId: { $in: independentNppIds },
          status: "active",
        })
        .toArray();

      // Group candidates by electionId for tally cleanup
      const candidatesByElection = new Map<string, string[]>();
      for (const c of independentCandidates) {
        const eid = c.electionId.toString();
        if (!candidatesByElection.has(eid)) {
          candidatesByElection.set(eid, []);
        }
        candidatesByElection.get(eid)!.push(c._id.toString());
      }

      // Remove candidates from elections
      let candidatesRemoved = 0;
      if (independentCandidates.length > 0) {
        const candidateIds = independentCandidates.map((c) => c._id);
        const result = await db
          .collection<ElectionCandidate>("electionCandidates")
          .deleteMany({ _id: { $in: candidateIds } });
        candidatesRemoved = result.deletedCount;
      }

      // Clean up election tallies for affected elections
      let electionsUpdated = 0;
      for (const [electionIdStr, candidateIdsList] of candidatesByElection) {
        const electionId = new ObjectId(electionIdStr);
        for (const candidateId of candidateIdsList) {
          await removeWithdrawnCandidateFromTally(db, electionId, candidateId);
        }
        electionsUpdated++;
      }

      // Retire the Independent NPPs
      const retireResult = await db
        .collection<NPP>("npps")
        .updateMany(
          { _id: { $in: independentNppIds } },
          { $set: { retiredAt: now, currentOffice: null, updatedAt: now } }
        );
      const nppsRetired = retireResult.modifiedCount;

      // Vacate any seats held by these NPPs
      let seatsVacated = 0;
      const seatsResult = await db.collection<ElectedOfficial>("electedOfficials").updateMany(
        { nppId: { $in: independentNppIds } },
        {
          $set: { characterId: null, isNPP: false, updatedAt: now },
          $unset: { nppId: "", characterName: "", party: "" },
        }
      );
      seatsVacated = seatsResult.modifiedCount;

      const stateDesc =
        states && states.length > 0 ? `in ${states.join(", ")}` : "across all states";
      return NextResponse.json({
        message: `Retired ${nppsRetired} Independent NPP(s), removed ${candidatesRemoved} election candidate(s), updated ${electionsUpdated} election(s), and vacated ${seatsVacated} seat(s) ${stateDesc}`,
        nppsRetired,
        candidatesRemoved,
        electionsUpdated,
        seatsVacated,
      });
    }

    const nppQuery: Record<string, unknown> = { retiredAt: null };
    if (states && states.length > 0) {
      nppQuery.homeState = { $in: states };
    }

    let candidatesRemoved = 0;
    if (states && states.length > 0) {
      const elections = await db
        .collection<Election>("elections")
        .find({ state: { $in: states } })
        .toArray();
      const electionIds = elections.map((e) => e._id);

      const result = await db.collection<ElectionCandidate>("electionCandidates").deleteMany({
        electionId: { $in: electionIds },
        isNPP: true,
      });
      candidatesRemoved = result.deletedCount;
    } else {
      const result = await db.collection<ElectionCandidate>("electionCandidates").deleteMany({
        isNPP: true,
      });
      candidatesRemoved = result.deletedCount;
    }

    let nppsRetired = 0;
    let seatsVacated = 0;
    if (!candidatesOnly) {
      // Get NPPs that will be retired so we can find their seats
      const nppsToRetire = await db.collection<NPP>("npps").find(nppQuery).toArray();
      const nppIdsToRetire = nppsToRetire.map((n) => n._id);

      // Retire the NPPs
      const result = await db.collection<NPP>("npps").updateMany(nppQuery, {
        $set: { retiredAt: now, currentOffice: null, updatedAt: now },
      });
      nppsRetired = result.modifiedCount;

      // Also vacate any seats held by NPPs being retired (or already retired)
      if (nppIdsToRetire.length > 0) {
        const seatsResult = await db.collection<ElectedOfficial>("electedOfficials").updateMany(
          { nppId: { $in: nppIdsToRetire } },
          {
            $set: { characterId: null, isNPP: false, updatedAt: now },
            $unset: { nppId: "", characterName: "", party: "" },
          }
        );
        seatsVacated = seatsResult.modifiedCount;
      }

      // Also check for any already-retired NPPs still holding seats
      const retiredNppsWithSeats = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ isNPP: true, nppId: { $exists: true } })
        .toArray();

      if (retiredNppsWithSeats.length > 0) {
        const retiredNppIds = retiredNppsWithSeats.map((o) => o.nppId).filter(Boolean);
        const actuallyRetired = await db
          .collection<NPP>("npps")
          .find({ _id: { $in: retiredNppIds as ObjectId[] }, retiredAt: { $ne: null } })
          .toArray();

        if (actuallyRetired.length > 0) {
          const retiredIds = actuallyRetired.map((n) => n._id);
          const additionalSeatsResult = await db
            .collection<ElectedOfficial>("electedOfficials")
            .updateMany(
              { nppId: { $in: retiredIds } },
              {
                $set: { characterId: null, isNPP: false, updatedAt: now },
                $unset: { nppId: "", characterName: "", party: "" },
              }
            );
          seatsVacated += additionalSeatsResult.modifiedCount;
        }
      }
    }

    const stateDesc = states && states.length > 0 ? `in ${states.join(", ")}` : "in all states";

    return NextResponse.json({
      message: candidatesOnly
        ? `Removed ${candidatesRemoved} NPP candidate(s) from elections ${stateDesc}`
        : `Retired ${nppsRetired} NPP(s), removed ${candidatesRemoved} candidate entries, and vacated ${seatsVacated} elected seat(s) ${stateDesc}`,
      candidatesRemoved,
      nppsRetired: candidatesOnly ? 0 : nppsRetired,
      seatsVacated: candidatesOnly ? 0 : seatsVacated,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
