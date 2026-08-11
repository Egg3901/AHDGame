import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { ElectedOfficial, Character } from "@/lib/db/types";
import {
  getPMAppointmentVotesCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * GET /api/admin/heal/confidence-votes
 * Diagnose active PM appointment and no-confidence votes — show NPP vote status.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const [activeAppointments, activeNoConf] = await Promise.all([
      getPMAppointmentVotesCollection(db).find({ status: "active" }).toArray(),
      getNoConfidenceVotesCollection(db).find({ status: "active" }).toArray(),
    ]);

    const results = [];

    for (const vote of activeAppointments) {
      const countryConfig = COUNTRY_CONFIGS[vote.countryId as CountryId];
      const lowerChamberKey = countryConfig?.legislature.lowerChamber.key ?? "commons";
      const allMPs = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ officeType: lowerChamberKey, countryId: vote.countryId })
        .toArray();

      const mpCharIds = allMPs
        .map((m) => m.characterId)
        .filter((id): id is import("mongodb").ObjectId => id != null);
      const playerChars = await db
        .collection<Character>("characters")
        .find({ _id: { $in: mpCharIds }, userId: { $exists: true } })
        .project<{ _id: import("mongodb").ObjectId }>({ _id: 1 })
        .toArray();
      const playerSet = new Set(playerChars.map((c) => c._id.toString()));

      let nppTotal = 0;
      let nppVoted = 0;
      let playerTotal = 0;
      let playerVoted = 0;

      for (const mp of allMPs) {
        if (mp.isNPP && mp.nppId) {
          const nppKey = `npp_${mp.nppId.toString()}`;
          nppTotal++;
          if (vote.votes[nppKey]) nppVoted++;
        } else if (mp.characterId) {
          const id = mp.characterId.toString();
          if (playerSet.has(id)) {
            playerTotal++;
            if (vote.votes[id]) playerVoted++;
          }
        }
      }

      results.push({
        voteId: vote._id.toString(),
        type: "pmAppointment",
        countryId: vote.countryId,
        nomineeName: vote.nomineeName,
        formationType: vote.formationType,
        status: vote.status,
        votesFor: vote.votesFor,
        votesAgainst: vote.votesAgainst,
        nppMPs: nppTotal,
        nppVoted,
        nppMissing: nppTotal - nppVoted,
        playerMPs: playerTotal,
        playerVoted,
      });
    }

    for (const vote of activeNoConf) {
      results.push({
        voteId: vote._id.toString(),
        type: "noConfidence",
        countryId: vote.countryId,
        targetPmName: vote.targetPmName,
        status: vote.status,
        votesFor: vote.votesFor,
        votesAgainst: vote.votesAgainst,
      });
    }

    return NextResponse.json({ activeVotes: results });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/confidence-votes
 * Fix active PM appointment votes by auto-recording aye for all qualifying NPP MPs who haven't voted.
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const votesColl = getPMAppointmentVotesCollection(db);

    const activeVotes = await votesColl.find({ status: "active" }).toArray();

    let totalFixed = 0;

    for (const vote of activeVotes) {
      const countryConfig = COUNTRY_CONFIGS[vote.countryId as CountryId];
      const lowerChamberKey = countryConfig?.legislature.lowerChamber.key ?? "commons";
      const allMPs = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ officeType: lowerChamberKey, countryId: vote.countryId, isNPP: true })
        .toArray();

      // Qualifying parties for auto-aye: nominating party or coalition parties
      const qualifyingPartyIds: Set<string> =
        vote.formationType === "coalition" && vote.coalitionPartyIds
          ? new Set(vote.coalitionPartyIds)
          : new Set([vote.nomineePartyId]);

      let autoAyeCount = 0;
      const votesUpdate: Record<string, "aye"> = {};

      for (const mp of allMPs) {
        if (!mp.nppId) continue;
        const nppKey = `npp_${mp.nppId.toString()}`;
        if (vote.votes[nppKey]) continue; // already voted
        if (!mp.party || !qualifyingPartyIds.has(mp.party)) continue; // not in qualifying party
        votesUpdate[`votes.${nppKey}`] = "aye";
        autoAyeCount += mp.seatsHeld ?? 1;
      }

      if (autoAyeCount > 0) {
        await votesColl.updateOne(
          { _id: vote._id },
          {
            $set: { ...votesUpdate, updatedAt: new Date() },
            $inc: { votesFor: autoAyeCount },
          }
        );
        totalFixed += autoAyeCount;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Fixed ${totalFixed} missing NPP votes across ${activeVotes.length} active appointment vote(s).`,
      votesFixed: totalFixed,
      votesProcessed: activeVotes.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
