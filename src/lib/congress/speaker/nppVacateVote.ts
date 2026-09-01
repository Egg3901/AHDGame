/**
 * NPP voting heuristic for a motion to vacate the Speaker's chair.
 *
 * Mirrors {@link nppImpeachmentVote}: a bloc sharing the Speaker's party
 * defends the chair, an opposition Major-party bloc moves to vacate, and
 * everything else is graded by ideological distance.
 *
 * Vacate ballots are binary ("for" = vacate, "against" = keep) with no
 * abstain option, and the motion carries only on an absolute majority of ALL
 * chamber seats. An unvoted seat therefore counts the same as a vote to keep,
 * so "against" is the conservative default whenever there is no usable signal.
 */
import type { Db } from "@/lib/mongodb";
import type {
  Character,
  ElectedOfficial,
  NPP,
  PoliticalParty,
  SpeakerVacateMotion,
} from "@/lib/db/types";
import { resolvePartyTier } from "@/lib/parties/partyTier";

/**
 * Per-axis stance distance (on the shared -5..+5 economic/social axes) within
 * which an NPP counts as ideologically close to the sitting Speaker. A bloc
 * this close does not move to vacate, whatever its party label says.
 */
export const NPP_VACATE_STANCE_DISTANCE = 2;

export type VacateVoteValue = "for" | "against";

export interface NppVacateVoteInput {
  nppParty: string | undefined;
  /** NPP's stored stance (policies.economic/social, drifted toward its target). */
  nppStance: { economic: number; social: number } | undefined;
  speakerParty: string | undefined;
  /** Speaker's stored character stance; missing on legacy or stance-less docs. */
  speakerStance: { economic: number; social: number } | undefined;
  /** Party ids (sequentialId strings) whose tier resolves to Major for this country. */
  majorPartyIds: ReadonlySet<string>;
  /** Injected so outcomes are deterministic under test. */
  rng: () => number;
}

/**
 * Per-axis closeness of two stances. True when BOTH axes sit within
 * {@link NPP_VACATE_STANCE_DISTANCE}; null when either side is missing a
 * usable stance, which callers must treat as "no ideology signal".
 */
export function nppVacateStanceCloseness(
  a: { economic: number; social: number } | undefined,
  b: { economic: number; social: number } | undefined
): boolean | null {
  if (!a || !b) return null;
  const econ = Math.abs(a.economic - b.economic);
  const social = Math.abs(a.social - b.social);
  if (!Number.isFinite(econ) || !Number.isFinite(social)) return null;
  return econ <= NPP_VACATE_STANCE_DISTANCE && social <= NPP_VACATE_STANCE_DISTANCE;
}

/**
 * One NPP bloc's vote on a motion to vacate. Never a blanket yes: a bloc
 * ideologically close to the Speaker keeps them rather than vacate, and a bloc
 * with no usable signal keeps them too.
 */
export function nppVacateMotionVote(input: NppVacateVoteInput): VacateVoteValue {
  const { nppParty, nppStance, speakerParty, speakerStance, majorPartyIds, rng } = input;

  // Partyless blocs have no stake in who holds the chair.
  if (!nppParty) return "against";

  // Same party as the Speaker: defend the chair.
  if (speakerParty && nppParty === speakerParty) return "against";

  const close = nppVacateStanceCloseness(nppStance, speakerStance);
  const bothMajor =
    !!speakerParty && majorPartyIds.has(nppParty) && majorPartyIds.has(speakerParty);

  // Opposition Major party: moves to vacate unless ideologically close to the
  // Speaker, in which case the vote is genuinely uncertain.
  if (bothMajor) {
    return close === true ? (rng() < 0.5 ? "for" : "against") : "for";
  }

  // Minor or unaligned party: only moves to vacate on clear ideological distance.
  if (close === false) return rng() < 0.5 ? "for" : "against";
  return "against";
}

/**
 * Stance accessor shared by the whip fallback and the auto-vote pass. Takes the
 * projected shape so callers that only fetched `policies` need no cast.
 */
export function nppStance(
  npp: Pick<NPP, "policies"> | undefined
): { economic: number; social: number } | undefined {
  return npp?.policies;
}

export interface VacateSpeakerContext {
  speakerParty: string | undefined;
  speakerStance: { economic: number; social: number } | undefined;
  majorPartyIds: ReadonlySet<string>;
}

/**
 * Load the ideology signal a vacate ballot is graded against: the sitting
 * Speaker's party and stance, plus the US parties whose tier resolves to Major.
 *
 * The party is read from `electedOfficials` rather than the `congressLeaders`
 * row so it matches the slug space the chamber composition and whip queries
 * use (a party sequentialId string, not a display name).
 */
export async function loadVacateSpeakerContext(
  db: Db,
  motion: Pick<SpeakerVacateMotion, "targetSpeakerId">
): Promise<VacateSpeakerContext> {
  const [speakerOfficial, speakerChar, parties] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne(
        { characterId: motion.targetSpeakerId, officeType: "house" },
        { projection: { party: 1 } }
      ),
    db
      .collection<Character>("characters")
      .findOne({ _id: motion.targetSpeakerId }, { projection: { policies: 1 } }),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: "US" })
      .project<Pick<PoliticalParty, "sequentialId" | "tier" | "isDefault">>({
        sequentialId: 1,
        tier: 1,
        isDefault: 1,
      })
      .toArray(),
  ]);

  const majorPartyIds = new Set<string>();
  for (const party of parties) {
    if (resolvePartyTier(party) === "major" && party.sequentialId != null) {
      majorPartyIds.add(String(party.sequentialId));
    }
  }

  return {
    speakerParty: speakerOfficial?.party,
    speakerStance: speakerChar?.policies,
    majorPartyIds,
  };
}
