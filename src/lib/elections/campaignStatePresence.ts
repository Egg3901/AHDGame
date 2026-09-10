/**
 * Where a presidential candidate is campaigning, and how they move.
 *
 * Two mechanics answer "how do I do better in this state", and which one is
 * live depends on the phase:
 *
 *   - primary : camp in a state (`primaryCampaignState`, ticks accrue) plus the
 *               one-off home-state surge.
 *   - general : travel to a state (`travelState`), which is also what unlocks
 *               canvassing there.
 *
 * The travel half had a working route and a real turn-engine effect but no UI
 * in any component, on this branch or on development, so the action was
 * unreachable. This assembles what both controls need from one state list, so
 * the campaign manager and the primary screen cannot quote different prices for
 * the same journey.
 */

import type { Db } from "mongodb";
import type { Character, Election, ElectionCandidate } from "@/lib/db/types";
import { isPrimaryEnded } from "@/lib/elections/phases";
import { getGameTime } from "@/lib/time/gameTime";
import { buildPrimaryViewerCampaign } from "@/lib/elections/primaryPartyDetail";
import { loadStateTravelOptions } from "@/lib/elections/stateTravelOptions";
import type { CampaignStatePresence } from "@/lib/elections/dto/campaignStatePresence";

export type { CampaignStatePresence };

/**
 * Assemble the presence block for one candidate, or null when there is nothing
 * to offer: a race that is not a US presidential one, a race that is not
 * running, or a viewer who is not a live candidate in it.
 */
export async function buildCampaignStatePresence(
  db: Db,
  args: { election: Election | null; character: Character | null }
): Promise<CampaignStatePresence | null> {
  const { election, character } = args;
  if (!election || !character) return null;
  if (election.electionType !== "president" || election.countryId !== "US") return null;
  if (election.status !== "active") return null;

  const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
    electionId: election._id,
    characterId: character._id,
    status: "active",
  });
  // Only the candidate moves: the actions come out of their own pool, which is
  // why both routes gate on the authenticated character rather than on manager
  // access. A manager opening this page has nothing to press here.
  if (!candidate) return null;

  const gameTime = await getGameTime();
  const inPrimary = !isPrimaryEnded(election, gameTime.currentTurn, gameTime);

  const { options, stateNameById, preset } = await loadStateTravelOptions(db);

  const primary = inPrimary
    ? await buildPrimaryViewerCampaign(db, {
        viewerCandidate: candidate,
        viewerCharacter: character,
        stateNameById,
        apportionmentPreset: preset,
      })
    : null;

  const currentStateId = inPrimary
    ? (candidate.primaryCampaignState ?? null)
    : (candidate.travelState ?? null);

  return {
    electionId: election._id.toString(),
    phase: inPrimary ? "primary" : "general",
    currentStateId,
    currentStateName: currentStateId ? (stateNameById[currentStateId] ?? currentStateId) : null,
    playerActions: character.actions ?? 0,
    states: options,
    primary,
  };
}
