import type { Db, ObjectId } from "mongodb";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import type { CountryId } from "@/lib/constants/countries";
import { getExtractionContractsCollection } from "@/lib/db/collections/extractionContracts";
import { isNationalIssuer, isStateIssuer } from "@/lib/extraction/contractIssuerAuth";

export type RevokeContractResult =
  { ok: true; status: 200 } | { ok: false; status: number; error: string };

/**
 * Player revocation of an extraction contract. The caller must be an authorized
 * issuer at the SAME level that granted the contract (or an admin). Works on
 * active or still-open offered contracts; sets `revokedTurn` and leaves `status`
 * (the active-contract and headroom filters both exclude a set `revokedTurn`).
 * Caller handles auth.
 */
export async function revokeContract(
  db: Db,
  contract: ExtractionContract,
  actor: { characterId: ObjectId; isAdmin: boolean },
  turn: number,
  now: Date
): Promise<RevokeContractResult> {
  if (contract.revokedTurn != null) {
    return { ok: false, status: 409, error: "This contract is already terminated." };
  }

  const countryId = contract.countryId as CountryId;
  const authorized = actor.isAdmin
    ? true
    : contract.grantedByLevel === "national"
      ? await isNationalIssuer(db, countryId, actor.characterId)
      : await isStateIssuer(db, countryId, contract.stateId, actor.characterId);
  if (!authorized) {
    return {
      ok: false,
      status: 403,
      error: "Only the issuing authority can revoke this contract.",
    };
  }

  const contractsCol = await getExtractionContractsCollection(db);
  const res = await contractsCol.updateOne(
    { _id: contract._id, revokedTurn: { $exists: false } },
    { $set: { revokedTurn: turn, updatedAt: now } }
  );
  if (res.modifiedCount === 0) {
    return { ok: false, status: 409, error: "This contract is already terminated." };
  }
  return { ok: true, status: 200 };
}
