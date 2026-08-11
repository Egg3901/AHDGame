import type { Db } from "mongodb";
import type { Election, ElectionCandidate } from "@/lib/db/types";
import { isCampaignEligibleElection } from "@/lib/campaigns/isCampaignEligible";
import { ensureCampaignForCandidate } from "@/lib/campaigns/createInitialCampaign";

/**
 * Standing backstop: guarantee every active player candidate in a
 * Campaign-eligible election has a live (non-archived) campaign.
 *
 * Campaigns are normally created at entry (enter route / admin placement), but
 * a candidate can end up active-without-a-campaign through legacy entry paths,
 * seeded rosters, a re-entry after archival, or an out-of-band data wipe. This
 * sweep — run once per turn from `processCampaignTurn` — repairs all of those
 * within a single turn so the Campaign Manager UI never dead-ends on
 * "Campaign not found".
 *
 * Idempotent via `ensureCampaignForCandidate`: existing active campaigns are a
 * no-op, archived ones for a re-active candidate are reactivated. Scoped to
 * non-NPP (player) candidates, mirroring the enter route's creation rule.
 *
 * Returns the number of candidates created or reactivated.
 */
export async function selfHealMissingCampaigns(db: Db, now: Date = new Date()): Promise<number> {
  const activeCandidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ status: "active" })
    .toArray();
  if (activeCandidates.length === 0) return 0;

  const electionIds = [...new Set(activeCandidates.map((c) => c.electionId.toString()))].map(
    (id) => activeCandidates.find((c) => c.electionId.toString() === id)!.electionId
  );
  const elections = await db
    .collection<Election>("elections")
    .find({ _id: { $in: electionIds } }, { projection: { _id: 1, countryId: 1, electionType: 1 } })
    .toArray();
  const eligibleElectionIds = new Set(
    elections.filter((e) => isCampaignEligibleElection(e)).map((e) => e._id.toString())
  );

  let healed = 0;
  for (const candidate of activeCandidates) {
    if (candidate.isNPP || !candidate.characterId) continue;
    if (!eligibleElectionIds.has(candidate.electionId.toString())) continue;

    const before = await db
      .collection("campaigns")
      .findOne(
        { electionId: candidate.electionId, candidateId: candidate.characterId },
        { projection: { _id: 1, status: 1 } }
      );
    const needsHeal = !before || before.status === "archived";

    await ensureCampaignForCandidate({
      db,
      electionId: candidate.electionId,
      candidateId: candidate.characterId,
      candidateIsNPP: false,
      party: candidate.party,
      now,
    });

    if (needsHeal) healed++;
  }

  return healed;
}
