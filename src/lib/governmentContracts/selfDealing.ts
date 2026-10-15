import { ObjectId, type Db } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import type { Corporation } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { resolveSelfDealing } from "@/lib/military/defenceSelfDealing";
import { createSystemNewsPost } from "@/lib/news";
import { tenderSelfDealingPenalty } from "./rules/selfDealing";
import type { GovernmentTender } from "./types";

export function tenderAwardInterest(
  tender: GovernmentTender,
  corp: Corporation,
  user: AuthUserWithCharacter,
  amount: number,
  defenceTranche: number
): GovernmentTender["awardSelfDealing"] {
  const interest = resolveSelfDealing({
    corp,
    ministerUserId: new ObjectId(user.userId),
    ministerCharacterId: user.character?._id,
  });
  return interest.basis
    ? {
        ...interest,
        basis: interest.basis,
        ministerCharacterId: user.character?._id,
        ministerName: user.character?.name,
        favorabilityPenalty: tenderSelfDealingPenalty(tender.terms, amount, defenceTranche),
      }
    : null;
}

/** Run only after payment/activation. Character and news markers make retries harmless. */
export async function discloseExtractionAward(db: Db, tender: GovernmentTender) {
  const interest = tender.awardSelfDealing;
  if (!interest || tender.terms.type !== "extraction") return;
  if (interest.ministerCharacterId)
    await db.collection("characters").updateOne(
      { _id: interest.ministerCharacterId, governmentContractDisclosures: { $ne: tender._id } },
      {
        $inc: { favorability: -interest.favorabilityPenalty },
        $addToSet: { governmentContractDisclosures: tender._id },
      }
    );
  const corporation =
    tender.bids[tender.winningCorporationId ?? ""]?.corporationName ?? "the supplier";
  const relationship =
    interest.basis === "owner"
      ? `owns ${corporation}`
      : `holds ${(interest.stakeShare * 100).toFixed(1)}% of ${corporation}`;
  await createSystemNewsPost(
    `${interest.ministerName ?? "The awarding official"}, who ${relationship}, has awarded the company a ${COUNTRY_CONFIGS[tender.countryId].name} extraction concession for ${(tender.terms.share * 100).toFixed(1)}% of ${tender.terms.resource} capacity in ${tender.terms.stateId} for ${tender.terms.termTurns} turns. The award is on the public contract board.`,
    "executive",
    {
      title: "Extraction concession awarded to official's own company",
      id: new ObjectId(tender.contractId),
      db,
    }
  );
}
