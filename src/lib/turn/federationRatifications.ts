import type { Db } from "mongodb";
import type { Bill } from "@/lib/db/types/legislation";
import {
  FEDERATION_POLITICAL_PROPOSALS_COLLECTION,
  type FederationPoliticalProposalRecord,
} from "@/lib/world/succession/politicalProposal";
import { recordFederationRatifications } from "@/lib/world/succession/recordRatifications";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  type FederationSettlementApplicationRecord,
} from "@/lib/world/succession/runtimeEntities";

/** Run after the ordinary bill lifecycle: only a signed settlement mandate
 * can trigger autonomous decisions, and replay preserves the first decision. */
export async function processFederationRatifications(
  db: Db,
  preset: string | undefined,
  currentTurn: number
): Promise<number> {
  if (preset !== "1991-default") return 0;
  if (!Number.isSafeInteger(currentTurn) || currentTurn < 1)
    throw new Error("Federation ratification needs a valid turn");
  const proposals = await db
    .collection<FederationPoliticalProposalRecord>(FEDERATION_POLITICAL_PROPOSALS_COLLECTION)
    .find({ presetId: "1991-default", status: "open" })
    .toArray();
  if (proposals.length === 0) return 0;
  const [applications, bills] = await Promise.all([
    db
      .collection<FederationSettlementApplicationRecord>(
        FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
      )
      .find(
        {
          presetId: "1991-default",
          sourceEntityId: { $in: proposals.map((proposal) => proposal.sourceEntityId) },
          status: "applied",
        },
        { projection: { sourceEntityId: 1 } }
      )
      .toArray(),
    db
      .collection<Bill>("bills")
      .find(
        { _id: { $in: proposals.map((proposal) => proposal.billId) } },
        { projection: { _id: 1, status: 1, federationSettlementMandate: 1 } }
      )
      .toArray(),
  ]);
  const appliedSources = new Set(applications.map((application) => application.sourceEntityId));
  const billsById = new Map(bills.map((bill) => [bill._id.toString(), bill]));
  const closed: { id: string; status: "rejected" | "withdrawn" }[] = [];
  let processed = 0;
  for (const proposal of proposals) {
    if (appliedSources.has(proposal.sourceEntityId)) continue;
    const bill = billsById.get(proposal.billId.toString());
    if (bill?.federationSettlementMandate?.termsHash === proposal.termsHash) {
      if (bill.status === "failed" || bill.status === "override_failed") {
        closed.push({ id: proposal._id, status: "rejected" });
        continue;
      }
      if (bill.status === "withdrawn") {
        closed.push({ id: proposal._id, status: "withdrawn" });
        continue;
      }
    }
    if (
      !bill ||
      bill.status !== "signed" ||
      bill.federationSettlementMandate?.termsHash !== proposal.termsHash
    )
      continue;
    const votes = await recordFederationRatifications({
      db,
      sourceCountryId: proposal.sourceEntityId,
      settlementId: proposal.settlementId,
      revision: proposal.revision,
      currentTurn,
    });
    if (votes.some((vote) => vote.choice === "reject"))
      closed.push({ id: proposal._id, status: "rejected" });
    processed += 1;
  }
  if (closed.length)
    await db
      .collection<FederationPoliticalProposalRecord>(FEDERATION_POLITICAL_PROPOSALS_COLLECTION)
      .bulkWrite(
        closed.map(({ id, status }) => ({
          updateOne: { filter: { _id: id, status: "open" }, update: { $set: { status } } },
        }))
      );
  return processed;
}
