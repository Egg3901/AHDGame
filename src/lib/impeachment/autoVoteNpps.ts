import type { Db } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { Character, ElectedOfficial, NPP, PoliticalParty } from "@/lib/db/types";
import type { Impeachment, ImpeachmentVoteValue } from "@/lib/db/types/impeachment";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import {
  impeachmentChamberOfficialFilter,
  impeachmentStageChamberOfficeType,
} from "./impeachmentTally";
import { resolvePartyTier } from "@/lib/parties/partyTier";

/**
 * Per-axis stance distance (on the shared -5..+5 economic/social axes) within
 * which an NPP counts as ideologically close to the impeachment target. A bloc
 * this close to the target does not auto-vote for removal, whatever its party
 * label says.
 */
export const NPP_IMPEACHMENT_STANCE_DISTANCE = 2;

export interface NppImpeachmentVoteInput {
  nppParty: string | undefined;
  /** NPP's stored stance (policies.economic/social, drifted toward its target). */
  nppStance: { economic: number; social: number } | undefined;
  targetParty: string | undefined;
  /** Target's stored character stance; missing on legacy or stance-less docs. */
  targetStance: { economic: number; social: number } | undefined;
  /** Party ids (sequentialId strings) whose tier resolves to Major for this country. */
  majorPartyIds: ReadonlySet<string>;
  /** Injected so outcomes are deterministic under test. */
  rng: () => number;
}

/**
 * Per-axis closeness of two stances. True when BOTH axes sit within
 * {@link NPP_IMPEACHMENT_STANCE_DISTANCE}; null when either side is missing a
 * usable stance, which callers must treat as "no ideology signal".
 */
export function nppStanceCloseness(
  a: { economic: number; social: number } | undefined,
  b: { economic: number; social: number } | undefined
): boolean | null {
  if (!a || !b) return null;
  const econ = Math.abs(a.economic - b.economic);
  const social = Math.abs(a.social - b.social);
  if (!Number.isFinite(econ) || !Number.isFinite(social)) return null;
  return econ <= NPP_IMPEACHMENT_STANCE_DISTANCE && social <= NPP_IMPEACHMENT_STANCE_DISTANCE;
}

/**
 * One NPP bloc's impeachment vote. Mirrors the cabinet-confirmation NPP shape:
 * same-party blocs defend the target, opposition Major-party blocs oppose,
 * everything else is graded by ideological distance and uncertainty. Never a
 * blanket yes: a bloc ideologically close to the target abstains rather than
 * remove it, and a bloc with no usable signal (no party, or no stance on
 * either side of a non-major pairing) abstains too. Under the all-seats
 * impeachment bars an abstention weighs against passage, so abstain is the
 * conservative default.
 */
export function nppImpeachmentVote(input: NppImpeachmentVoteInput): ImpeachmentVoteValue {
  const { nppParty, nppStance, targetParty, targetStance, majorPartyIds, rng } = input;

  // Partyless blocs have no stake to model.
  if (!nppParty) return "abstain";

  // Same party as the target: defend.
  if (targetParty && nppParty === targetParty) return "nay";

  const close = nppStanceCloseness(nppStance, targetStance);
  const bothMajor = !!targetParty && majorPartyIds.has(nppParty) && majorPartyIds.has(targetParty);

  // Opposition Major party: opposes removal unless ideologically close to the
  // target, in which case the vote is genuinely uncertain.
  if (bothMajor) {
    return close === true ? (rng() < 0.5 ? "aye" : "abstain") : "aye";
  }

  // Minor or unaligned party: only back removal on clear ideological distance.
  if (close === false) return rng() < 0.5 ? "aye" : "abstain";
  return "abstain";
}

/** Distinct non-independent party ids (sequentialId strings) in a set of officials. */
function collectPartyIds(
  officials: Array<Pick<ElectedOfficial, "party">>,
  targetParty: string | undefined
): number[] {
  const ids = new Set<number>();
  for (const party of [...officials.map((o) => o.party), targetParty]) {
    if (!party || party === "independent") continue;
    const n = Number(party);
    if (Number.isInteger(n) && n > 0) ids.add(n);
  }
  return [...ids];
}

function targetOfficialFilter(impeachment: Impeachment): Record<string, unknown> {
  if (impeachment.targetOffice !== "governor" || !impeachment.state) {
    return getExecutiveOfficialFilter(impeachment.countryId, "president");
  }
  const stateFilter = { officeType: "governor", state: impeachment.state };
  if (impeachment.countryId === COUNTRY_CONFIGS.US.id) {
    return {
      ...stateFilter,
      $or: [{ countryId: impeachment.countryId }, { countryId: { $exists: false } }],
    };
  }
  return { ...stateFilter, countryId: impeachment.countryId };
}

/**
 * Give every unvoted NPP bloc a graded impeachment vote.
 *
 * The target's party votes nay; opposition Major-party blocs vote aye unless
 * they sit ideologically close to the target (stance distance, then it is a
 * coin flip between aye and abstain); minor-party and unaligned blocs vote aye
 * only on clear ideological distance and abstain otherwise. Existing votes are
 * never overwritten, so a whip or earlier vote remains authoritative. The
 * returned map includes votes successfully written by this pass and can be
 * tallied immediately without another database read.
 *
 * `rng` is injectable so resolution outcomes are deterministic under test.
 */
export async function autoVoteNppsForImpeachmentStage(
  db: Db,
  impeachment: Impeachment,
  rng: () => number = Math.random
): Promise<Record<string, ImpeachmentVoteValue>> {
  if (impeachment.stage !== "house" && impeachment.stage !== "senate") return {};

  const officeType = impeachmentStageChamberOfficeType(impeachment);
  if (!officeType) return {};

  const voteField = impeachment.stage === "house" ? "houseVotes" : "senateVotes";
  const votesForField = impeachment.stage === "house" ? "houseVotesFor" : "senateVotesFor";
  const votesAgainstField =
    impeachment.stage === "house" ? "houseVotesAgainst" : "senateVotesAgainst";
  const votesAbstainField =
    impeachment.stage === "house" ? "houseVotesAbstain" : "senateVotesAbstain";
  const votes = { ...(impeachment[voteField] ?? {}) };

  const target = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne(targetOfficialFilter(impeachment), { projection: { party: 1 } });
  const targetParty = target?.party;

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      ...impeachmentChamberOfficialFilter(
        impeachment.countryId,
        officeType,
        impeachment.targetOffice === "governor" ? impeachment.state : undefined
      ),
      isNPP: true,
    })
    .project<Pick<ElectedOfficial, "nppId" | "party" | "seatsHeld">>({
      nppId: 1,
      party: 1,
      seatsHeld: 1,
    })
    .toArray();

  // Stances: each bloc's NPP doc, plus the target character's own stance.
  const nppIdList = officials
    .map((o) => o.nppId)
    .filter((id): id is ObjectId => id instanceof ObjectId);
  const [nppDocs, targetChar] = await Promise.all([
    nppIdList.length > 0
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIdList } })
          .project<Pick<NPP, "_id" | "policies">>({ _id: 1, policies: 1 })
          .toArray()
      : Promise.resolve([] as Array<Pick<NPP, "_id" | "policies">>),
    db
      .collection<Character>("characters")
      .findOne({ _id: impeachment.targetCharacterId }, { projection: { policies: 1 } }),
  ]);
  const stanceByNppId = new Map(
    nppDocs.map((n) => [
      n._id.toString(),
      n.policies as { economic: number; social: number } | undefined,
    ])
  );
  const targetStance = targetChar?.policies as { economic: number; social: number } | undefined;

  // Major-party ids for this country, from the live party tier (party docs are
  // country-scoped; legacy rows fall back via resolvePartyTier).
  const partyNumIds = collectPartyIds(officials, targetParty);
  const majorPartyIds = new Set<string>();
  if (partyNumIds.length > 0) {
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: impeachment.countryId, sequentialId: { $in: partyNumIds } })
      .project<Pick<PoliticalParty, "sequentialId" | "tier" | "isDefault">>({
        sequentialId: 1,
        tier: 1,
        isDefault: 1,
      })
      .toArray();
    for (const party of parties) {
      if (resolvePartyTier(party) === "major" && party.sequentialId != null) {
        majorPartyIds.add(String(party.sequentialId));
      }
    }
  }

  const seenNppIds = new Set<string>();
  for (const official of officials) {
    if (!official.nppId) continue;
    const nppId = official.nppId.toString();
    if (seenNppIds.has(nppId)) continue;
    seenNppIds.add(nppId);

    const nppKey = `npp_${nppId}`;
    if (votes[nppKey]) continue;

    const choice = nppImpeachmentVote({
      nppParty: official.party,
      nppStance: stanceByNppId.get(nppId),
      targetParty,
      targetStance,
      majorPartyIds,
      rng,
    });
    const tallyField =
      choice === "aye" ? votesForField : choice === "nay" ? votesAgainstField : votesAbstainField;
    const result = await db.collection<Impeachment>("impeachments").updateOne(
      {
        _id: impeachment._id,
        stage: impeachment.stage,
        [`${voteField}.${nppKey}`]: { $exists: false },
      },
      {
        $set: { [`${voteField}.${nppKey}`]: choice, updatedAt: new Date() },
        $inc: { [tallyField]: official.seatsHeld ?? 1 },
      }
    );
    if (result.modifiedCount > 0) votes[nppKey] = choice;
  }

  return votes;
}
