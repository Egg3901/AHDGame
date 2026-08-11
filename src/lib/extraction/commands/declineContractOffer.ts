import type { Db } from "mongodb";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import { getExtractionContractsCollection } from "@/lib/db/collections/extractionContracts";

export type DeclineContractResult =
  { ok: true; status: 200 } | { ok: false; status: number; error: string };

/**
 * Corp CEO declines an offered extraction contract. Only `offered` contracts can
 * be declined; sets `status:"declined"` + `revokedTurn` (the active-contract
 * filter already excludes both). Caller handles requireCeo.
 */
export async function declineContractOffer(
  db: Db,
  contract: ExtractionContract,
  turn: number,
  now: Date
): Promise<DeclineContractResult> {
  if (contract.status !== "offered") {
    return { ok: false, status: 409, error: "This contract is not an open offer." };
  }
  const contractsCol = await getExtractionContractsCollection(db);
  const res = await contractsCol.updateOne(
    { _id: contract._id, status: "offered" },
    { $set: { status: "declined", revokedTurn: turn, updatedAt: now } }
  );
  if (res.modifiedCount === 0) {
    return { ok: false, status: 409, error: "This offer is no longer available." };
  }
  return { ok: true, status: 200 };
}
