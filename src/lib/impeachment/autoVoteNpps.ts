import type { Db } from "@/lib/mongodb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { ElectedOfficial } from "@/lib/db/types";
import type { Impeachment, ImpeachmentVoteValue } from "@/lib/db/types/impeachment";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { getSubNationalLegislatureKey } from "@/lib/constants/countries";
import { impeachmentChamberOfficialFilter } from "./impeachmentTally";

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
 * Give every unvoted NPP bloc a party-line impeachment vote.
 *
 * The target's party votes nay; opposition parties vote aye. Partyless blocs
 * abstain. Existing votes are never overwritten, so a whip or earlier vote
 * remains authoritative. The returned map includes votes successfully written
 * by this pass and can be tallied immediately without another database read.
 */
export async function autoVoteNppsForImpeachmentStage(
  db: Db,
  impeachment: Impeachment
): Promise<Record<string, ImpeachmentVoteValue>> {
  if (impeachment.stage !== "house" && impeachment.stage !== "senate") return {};

  const officeType =
    impeachment.targetOffice === "governor"
      ? getSubNationalLegislatureKey(impeachment.countryId)
      : impeachment.stage === "house"
        ? getLowerChamberOfficeType(impeachment.countryId)
        : getUpperChamberOfficeType(impeachment.countryId);
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

  const seenNppIds = new Set<string>();
  for (const official of officials) {
    if (!official.nppId) continue;
    const nppId = official.nppId.toString();
    if (seenNppIds.has(nppId)) continue;
    seenNppIds.add(nppId);

    const nppKey = `npp_${nppId}`;
    if (votes[nppKey]) continue;

    const choice: ImpeachmentVoteValue =
      !official.party || targetParty == null
        ? "abstain"
        : official.party === targetParty
          ? "nay"
          : "aye";
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
