/**
 * Close-time ballots for autonomy-active org voters.
 *
 * The active-mode foreign-policy planner takes ONE diplomatic action per
 * six-hour Tier-1 slot per country. A pending unanimous ballot — an admission,
 * an FTA, a bloc war call — competes for that slot against routine diplomacy,
 * and a 24-turn window gives each member only a handful of chances. One busy
 * cycle starves the vote, the member "withholds consent", and a single silent
 * member vetoes the whole bloc forever. This module is the safety net the
 * resolvers lean on: as an item's window closes, every autonomy-active member
 * of the voting roll that has not yet cast casts the cooperative ballot the
 * shadow-mode voter has always cast (see castAutonomousOrgVotes).
 *
 * Firing at the deadline, not the filing turn, keeps the window the planner's
 * own: it scores real opinions all window long, and the safety net only fills
 * the silence it never got to. The vote is "yes" because everything that
 * reaches this pass was already cleared to carry — an alignment-accession
 * application only exists because the alignment engine sustained the applicant
 * past the join share for a full sustain window, and the planner's own routine
 * votes score 46+, above its action threshold. A government that wants to vote
 * no does so through the planner, which has the whole window to itself.
 *
 * Player-enabled members are never touched: their foreign minister still
 * decides, and their silence stays a nay.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { NPP } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { ProposalVoteRecord } from "@/lib/db/types/internationalOrganization";
import { isNppAutonomyActive } from "@/lib/nppAutonomy/featureFlag";

/** The head-of-government NPP that speaks for an autonomous country's ballot. */
async function headNppFor(
  db: Db,
  countryId: CountryId
): Promise<{ characterId: NPP["_id"]; characterName: string } | null> {
  const formation = await db
    .collection<GovernmentFormation>("governmentFormations")
    .findOne(
      { _id: countryId, status: "formed" },
      { projection: { presidentNppId: 1, pmNppId: 1 } }
    );
  const headNppId = formation?.presidentNppId ?? formation?.pmNppId ?? null;
  if (!headNppId) return null;
  const npp = await db
    .collection<NPP>("npps")
    .findOne({ _id: headNppId }, { projection: { _id: 1, name: 1 } });
  if (npp) return { characterId: npp._id, characterName: npp.name };
  // A dangling NPP id must not stall the ballot: fall through to a synthetic
  // identity rather than re-creating the silent-veto this pass exists to end.
  return {
    characterId: headNppId,
    characterName: `${COUNTRY_CONFIGS[countryId]?.name ?? countryId} Government`,
  };
}

function alreadyVoted(votes: ProposalVoteRecord[] | undefined, countryId: string): boolean {
  return (votes ?? []).some((v) => v.countryId === countryId);
}

/**
 * One write contract: upsert a vote into an item's embedded vote list while it
 * is still pending. Abstracted so the pass can serve all three ballot
 * collections through one loop.
 */
type VoteSink<T> = (item: T, vote: ProposalVoteRecord) => Promise<{ matchedCount: number }>;

/**
 * Fill the silent ballots of `voters` on every item in `items` whose window has
 * closed. Items already carry their votes; `applicantOf` names the country
 * whose accession or candidacy the item is about, so the proposer never votes
 * on its own item. Mutates each item's `votes` in place so a later tally in the
 * same pass reads the ballots it just cast. Returns the number of votes cast.
 */
async function fillSilentBallots<
  T extends { votes?: ProposalVoteRecord[] | null; organizationId: string },
>(
  db: Db,
  items: T[],
  votersFor: (organizationId: string) => CountryId[] | undefined,
  applicantOf: (item: T) => string | null,
  sink: VoteSink<T>,
  currentTurn: number
): Promise<number> {
  const now = new Date();
  const headCache = new Map<string, { characterId: NPP["_id"]; characterName: string } | null>();
  let cast = 0;

  for (const item of items) {
    const voters = votersFor(item.organizationId);
    if (!voters) continue;
    const applicant = applicantOf(item);
    const votes = itemVotes(item);
    for (const voter of voters) {
      if (applicant != null && voter === applicant) continue;
      if (alreadyVoted(votes, voter)) continue;
      if (!(await isNppAutonomyActive(db, voter))) continue;
      let head = headCache.get(voter);
      if (head === undefined) {
        head = await headNppFor(db, voter);
        headCache.set(voter, head);
      }
      if (!head) continue;
      const vote: ProposalVoteRecord = {
        countryId: voter,
        characterId: head.characterId,
        characterName: head.characterName,
        vote: "yes",
        castAt: now,
        castOnTurn: currentTurn,
      };
      const res = await sink(item, vote);
      if ((res?.matchedCount ?? 0) > 0) {
        cast++;
        // Keep the in-memory item honest: the loop may tally right after the
        // last voter lands, and the resolver reads this same list.
        votes.push(vote);
      }
    }
  }
  return cast;
}

function itemVotes<T extends { votes?: ProposalVoteRecord[] | null }>(
  item: T
): ProposalVoteRecord[] {
  if (!Array.isArray(item.votes)) item.votes = [];
  return item.votes;
}

export { fillSilentBallots };
export type { VoteSink };
