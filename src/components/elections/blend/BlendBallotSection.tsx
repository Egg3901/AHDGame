"use client";

/**
 * A grid of Blend race cards for one tier of a region's ballot.
 *
 * Kept separate from `StateElections` so the federal and regional sections
 * share one code path, and so the per-card clock lookups (which need the game
 * clock context) stay out of the fetch-heavy parent.
 */

import { useMemo } from "react";
import { useGameClock } from "@/contexts/useGameClock";
import { resolveEntryAction } from "@/lib/elections/entryEligibility";
import {
  buildBlendRegionCards,
  type BlendTier,
  type PartyLookup,
  type RegionElectorate,
} from "@/lib/elections/blendRegionViewModel";
import { electionRaceTitle, buildElectionHref } from "@/components/elections/electionHelpers";
import type { CharacterBasic, ElectionDisplay } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { BlendRaceCard } from "./BlendRaceCard";

interface BlendBallotSectionProps {
  elections: ElectionDisplay[];
  countryId: CountryId;
  regionName: string;
  /** Region code on screen, so a nationwide race can be told from a local one. */
  regionCode?: string;
  /** Ballots across the region's whole ballot, not just this section's races. */
  regionBallots?: number;
  tier: BlendTier;
  parties: PartyLookup;
  character: CharacterBasic | null;
  electorate?: RegionElectorate;
  gameYearFor: (election: ElectionDisplay) => number | null;
  isInRace: (election: ElectionDisplay) => boolean;
  isInAnyRace: () => boolean;
  actionLoading: string | null;
  onEnterRace: (electionId: string) => void;
  onWithdraw: (electionId: string) => void;
  /** Region-scoped vote totals, for a race whose stored tally is nationwide. */
  regionVotesByElectionId?: Record<string, Record<string, number>>;
  /** Electoral votes this region awards, for a winner-take-all presidency. */
  regionElectoralVotes?: number;
}

export function BlendBallotSection({
  elections,
  countryId,
  regionName,
  regionCode,
  regionBallots,
  tier,
  parties,
  character,
  electorate,
  gameYearFor,
  isInRace,
  isInAnyRace,
  actionLoading,
  onEnterRace,
  onWithdraw,
  regionVotesByElectionId,
  regionElectoralVotes,
}: BlendBallotSectionProps) {
  const clock = useGameClock();

  const cards = useMemo(() => {
    const titleById: Record<string, string> = {};
    const hrefById: Record<string, string> = {};
    const tierById: Record<string, BlendTier> = {};
    for (const election of elections) {
      titleById[election.id] = electionRaceTitle(election, gameYearFor(election));
      hrefById[election.id] = buildElectionHref(election);
      tierById[election.id] = tier;
    }
    return buildBlendRegionCards({
      elections,
      countryId,
      regionName,
      regionCode,
      regionBallots,
      parties,
      viewerCharacterId: character?._id ?? null,
      viewerPartyId: character?.party ?? null,
      electorate,
      titleById,
      hrefById,
      tierById,
      regionVotesByElectionId,
      regionElectoralVotes,
    });
  }, [
    elections,
    countryId,
    regionName,
    regionCode,
    regionBallots,
    parties,
    character,
    electorate,
    gameYearFor,
    tier,
    regionVotesByElectionId,
    regionElectoralVotes,
  ]);

  const inAnyRace = isInAnyRace();

  // Three-up only on a genuinely wide screen. At 1600px a third column left
  // roughly 280px of card, which truncated candidate names mid-word.
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {cards.map((card) => {
        const election = elections.find((e) => e.id === card.electionId);
        if (!election) return null;

        // The primary countdown comes from the game clock rather than the
        // payload: the elections API and turn status are fetched separately and
        // can disagree for a few seconds after a turn.
        const primaryTimer =
          election.primaryEndTurn != null
            ? clock.formatRemainingTurns(election.primaryEndTurn)
            : clock.formatRemaining(election.primaryEndTime);
        const generalTimer =
          election.endTurn != null
            ? clock.formatRemainingTurns(election.endTurn)
            : clock.formatRemaining(election.endTime);

        const activeTimer = card.isPrimary ? primaryTimer : generalTimer;
        const closed = card.phase === "final" || generalTimer.urgency === "ended";

        return (
          <BlendRaceCard
            key={card.electionId}
            card={card}
            closesIn={activeTimer.text || null}
            closed={closed}
            entryAction={resolveEntryAction({
              election,
              character,
              stateId: election.state,
              inThisRace: isInRace(election),
              inAnyRace,
              primaryEnded: primaryTimer.urgency === "ended",
            })}
            entryLoading={actionLoading === election.id}
            onEnterRace={onEnterRace}
            onWithdraw={onWithdraw}
          />
        );
      })}
    </div>
  );
}
