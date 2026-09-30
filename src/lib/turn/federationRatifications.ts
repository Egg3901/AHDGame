import type { Db } from "mongodb";
import type { Bill } from "@/lib/db/types/legislation";
import {
  FEDERATION_POLITICAL_PROPOSALS_COLLECTION,
  type FederationPoliticalProposalRecord,
} from "@/lib/world/succession/politicalProposal";
import { recordFederationRatifications } from "@/lib/world/succession/recordRatifications";

/** Run after the ordinary bill lifecycle: only a signed settlement mandate
 * can trigger autonomous decisions, and replay preserves the first decision. */
export async function processFederationRatifications(
  db: Db,
  preset: string,
  currentTurn: number
): Promise<number> {
  if (preset !== "1991-default") return 0;
  if (!Number.isSafeInteger(currentTurn) || currentTurn < 1)
    throw new Error("Federation ratification needs a valid turn");
  const proposals = await db
    .collection<FederationPoliticalProposalRecord>(FEDERATION_POLITICAL_PROPOSALS_COLLECTION)
    .find({ presetId: "1991-default", status: "open" })
    .toArray();
  let processed = 0;
  for (const proposal of proposals) {
    const bill = await db
      .collection<Bill>("bills")
      .findOne(
        { _id: proposal.billId },
        { projection: { status: 1, federationSettlementMandate: 1 } }
      );
    if (
      !bill ||
      !["signed", "veto_override"].includes(bill.status) ||
      bill.federationSettlementMandate?.termsHash !== proposal.termsHash
    )
      continue;
    await recordFederationRatifications({
      db,
      sourceCountryId: proposal.sourceEntityId,
      settlementId: proposal.settlementId,
      revision: proposal.revision,
      currentTurn,
    });
    processed += 1;
  }
  return processed;
}
