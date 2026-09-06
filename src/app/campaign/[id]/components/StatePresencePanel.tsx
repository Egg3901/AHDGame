"use client";

import { PrimaryCampaignControls } from "@/components/elections/primary/PrimaryCampaignControls";
import { TravelControls } from "@/components/elections/primary/TravelControls";
import type { CampaignStatePresence } from "@/lib/elections/dto/campaignStatePresence";

/**
 * The candidate's state presence, in whichever form the phase allows.
 *
 * Both mechanics answer the same player question, "how do I do better in this
 * state", so they sit in one place rather than being scattered: camping and the
 * home-state surge during the primary, travel during the general. Canvassing is
 * rendered directly beneath by the page, because it is the thing being where
 * you are unlocks.
 */
export function StatePresencePanel({
  presence,
  onChanged,
}: {
  presence: CampaignStatePresence | null | undefined;
  onChanged?: () => void;
}) {
  if (!presence) return null;

  if (presence.phase === "primary") {
    // Null only if the candidacy vanished between the two reads; nothing to show.
    if (!presence.primary) return null;
    return (
      <PrimaryCampaignControls
        electionId={presence.electionId}
        {...presence.primary}
        onChanged={onChanged}
      />
    );
  }

  return (
    <TravelControls
      electionId={presence.electionId}
      currentStateId={presence.currentStateId}
      currentStateName={presence.currentStateName}
      playerActions={presence.playerActions}
      states={presence.states}
      onChanged={onChanged}
    />
  );
}
