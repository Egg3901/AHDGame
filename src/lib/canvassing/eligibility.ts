import type { Db, ObjectId } from "mongodb";
import type { Character, ElectionCandidate, Election } from "@/lib/db/types";
import { getGameTime } from "@/lib/time/gameTime";
import { isPrimaryEnded, isCampaignUpgradeGeneralPhase } from "@/lib/elections/phases";

export type CanvassEligibility =
  | { ok: true; stateId: string; source: "home" | "travel" | "primaryCampaign" }
  | { ok: false; reason: "needs_travel" | "needs_primary_campaign" | "campaign_suspended" };

export const CANVASS_ELIGIBILITY_MESSAGE: Record<
  Exclude<CanvassEligibility, { ok: true }>["reason"],
  string
> = {
  needs_travel: "Travel to a state to canvass voters there",
  needs_primary_campaign: "Set your primary campaign state to canvass voters there",
  campaign_suspended: "Your presidential campaign is suspended — canvassing is disabled",
};

export async function resolveCanvassState(
  db: Db,
  character: Character
): Promise<CanvassEligibility> {
  const presidential = await findActivePresidentialCandidacy(db, character._id);
  if (!presidential) {
    return { ok: true, stateId: character.homeState, source: "home" };
  }

  if (presidential.candidate.campaignSuspended) {
    return { ok: false, reason: "campaign_suspended" };
  }

  // Turn-first so canvass eligibility agrees with the turn-based primary
  // resolution rather than wall-clock drift (Date fallback for legacy docs).
  const gameTime = await getGameTime();
  const inPrimaryPhase = !isPrimaryEnded(presidential.election, gameTime.currentTurn, gameTime);

  if (inPrimaryPhase) {
    if (presidential.candidate.primaryCampaignState) {
      return {
        ok: true,
        stateId: presidential.candidate.primaryCampaignState,
        source: "primaryCampaign",
      };
    }
    return { ok: false, reason: "needs_primary_campaign" };
  }

  if (presidential.candidate.travelState) {
    return { ok: true, stateId: presidential.candidate.travelState, source: "travel" };
  }
  return { ok: false, reason: "needs_travel" };
}

/**
 * Running-mate surrogate canvass eligibility. Resolves whether `character` is
 * the running mate on an active presidential ticket that is in its general
 * phase, and if so, the state the surrogate is canvassing (the nominee row's
 * `runningMateTravelState`). Unlike `resolveCanvassState`, this reads the
 * ticket's travel state, not the character's own candidacy; the running mate
 * has no candidate row of their own. `nomineeCharacterId` + `electionId` let the
 * caller find the ticket's Campaign to draw down the shared surrogate pool.
 */
export type RunningMateCanvassEligibility =
  | {
      ok: true;
      stateId: string;
      electionId: ObjectId;
      nomineeCharacterId: ObjectId;
    }
  | { ok: false; reason: "not_running_mate" | "needs_travel" };

export async function resolveRunningMateCanvassState(
  db: Db,
  character: Character
): Promise<RunningMateCanvassEligibility> {
  const mateRows = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ runningMateId: character._id, status: "active" })
    .toArray();
  if (mateRows.length === 0) return { ok: false, reason: "not_running_mate" };

  const electionIds = mateRows.map((row) => row.electionId);
  const gameTime = await getGameTime();
  const elections = await db
    .collection<Election>("elections")
    .find({ _id: { $in: electionIds }, electionType: "president", status: "active" })
    .toArray();

  const generalElections = elections.filter((election) =>
    isCampaignUpgradeGeneralPhase(election, gameTime.currentTurn, gameTime)
  );
  if (generalElections.length === 0) return { ok: false, reason: "not_running_mate" };

  // Prefer the soonest-closing general race when a character somehow mates two.
  generalElections.sort((a, b) => {
    const aTime = a.endTime ? new Date(a.endTime).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.endTime ? new Date(b.endTime).getTime() : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });

  const election = generalElections[0];
  const mateRow = mateRows.find((row) => row.electionId.equals(election._id));
  if (!mateRow) return { ok: false, reason: "not_running_mate" };
  if (!mateRow.runningMateTravelState) return { ok: false, reason: "needs_travel" };

  return {
    ok: true,
    stateId: mateRow.runningMateTravelState,
    electionId: election._id,
    nomineeCharacterId: mateRow.characterId,
  };
}

interface PresidentialCandidacy {
  candidate: ElectionCandidate;
  election: Election;
}

async function findActivePresidentialCandidacy(
  db: Db,
  characterId: ObjectId
): Promise<PresidentialCandidacy | null> {
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ characterId, status: "active" })
    .toArray();

  if (candidates.length === 0) return null;

  const electionIds = candidates.map((c) => c.electionId);
  const elections = await db
    .collection<Election>("elections")
    .find({
      _id: { $in: electionIds },
      electionType: "president",
      status: "active",
    })
    .toArray();

  if (elections.length === 0) return null;

  elections.sort((a, b) => {
    const aTime = a.endTime ? new Date(a.endTime).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.endTime ? new Date(b.endTime).getTime() : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });

  const election = elections[0];
  const candidate = candidates.find((c) => c.electionId.equals(election._id));
  if (!candidate) return null;

  return { candidate, election };
}
