/**
 * NPP engine 6.5: count the votes before sponsoring (v6).
 *
 * Below v6 an NPP sponsor files the highest-scoring bill whether or not its
 * chamber will pass it. At v6 the sponsor projects the lower-chamber vote with
 * the same forces autonomous bill voting applies when no whip is set
 * (`turn/npp/billVoting.ts`): ideology, district and donors from
 * `computeCrossPressureForces`, the co-partisan party-line lean and the
 * opposition bloc. Player seats are counted as voting with their party: for
 * when they share the sponsor's party, against otherwise. A bill that does not
 * project more seats for than against is not introduced, and the sponsor tries
 * its next-best bill instead.
 */
import type { LegislationType, NPP, StateDemographics } from "@/lib/db/types";
import {
  computeCrossPressureForces,
  computePartyLineForce,
  verdictFromForces,
} from "@/lib/turn/npp/crossPressure";
import { computeOppositionVoteForce } from "@/lib/nppAutonomy/oppositionBehavior";

/** How many bills a v6 sponsor checks before filing nothing this attempt. */
export const WHIP_COUNT_MAX_CANDIDATES = 3;

export type WhipCountBill = Parameters<typeof computeCrossPressureForces>[1];

export interface WhipCountInput {
  bill: WhipCountBill;
  legislationType: LegislationType | null;
  sponsorParty: string;
  /** Seated NPPs in the chamber the bill starts in. */
  voters: ReadonlyArray<{ npp: NPP; seats: number }>;
  /** Player-held seats in the same chamber, by party. */
  playerSeatsByParty: Readonly<Record<string, number>>;
  demographicsByState: ReadonlyMap<string, StateDemographics>;
  opposition: { governingPartyId: string; oppositionPartyId: string } | null;
  oppositionCoordination: number;
}

export interface WhipCount {
  forSeats: number;
  againstSeats: number;
  abstainSeats: number;
}

export function projectChamberVote(input: WhipCountInput): WhipCount {
  const count: WhipCount = { forSeats: 0, againstSeats: 0, abstainSeats: 0 };
  for (const { npp, seats } of input.voters) {
    const { forces } = computeCrossPressureForces(npp, input.bill, {
      legislationType: input.legislationType,
      homeStateDemographics: input.demographicsByState.get(npp.homeState) ?? null,
      whips: { partyWhip: null, caucusWhip: null },
    });
    let ideology = forces.ideology + computePartyLineForce(npp, input.sponsorParty);
    if (input.opposition) {
      ideology += computeOppositionVoteForce(npp, {
        sponsorParty: input.sponsorParty,
        governingPartyId: input.opposition.governingPartyId,
        oppositionPartyId: input.opposition.oppositionPartyId,
        coordination: input.oppositionCoordination,
      });
    }
    forces.ideology = Math.max(-100, Math.min(100, ideology));
    const verdict = verdictFromForces(forces);
    if (verdict === "for") count.forSeats += seats;
    else if (verdict === "against") count.againstSeats += seats;
    else count.abstainSeats += seats;
  }
  for (const [party, seats] of Object.entries(input.playerSeatsByParty)) {
    if (party === input.sponsorParty) count.forSeats += seats;
    else count.againstSeats += seats;
  }
  return count;
}

export function hasTheVotes(count: WhipCount): boolean {
  return count.forSeats > count.againstSeats;
}
