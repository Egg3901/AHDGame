import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import { getExtractionContractsCollection } from "@/lib/db/collections/extractionContracts";
import { getStateResourceCapacityCollection } from "@/lib/db/collections/stateResourceCapacity";
import { computeRemainingContractHeadroom } from "@/lib/extraction/computeContractedShare";
import { getResourceContractAuthority } from "@/lib/extraction/contractAuthority";
import { isNationalIssuer, isStateIssuer } from "@/lib/extraction/contractIssuerAuth";
import { createNotifications } from "@/lib/notifications";
import { CONTRACT_OFFER_EXPIRY_TURNS } from "@/lib/constants/prospecting";

export interface IssueContractOfferInput {
  countryId: CountryId;
  stateId: string;
  corporationId: string;
  resource: ExtractableResource;
  share: number;
  royaltyRatePerTurn: number;
  termTurns: number;
  signingFeeAnchor: number;
}

export type IssueContractOfferResult =
  | {
      ok: true;
      status: 200;
      contractId: string;
      grantedByLevel: "national" | "state";
      offerExpiresTurn: number;
    }
  | { ok: false; status: number; error: string; remainingHeadroom?: number };

/**
 * Player-issued extraction-contract OFFER (offer→accept flow).
 *
 * The issuer's level (national vs state) is DERIVED from who the caller is and
 * must be permitted by the country's Resource Extraction Authority Act. Enforces
 * the 75% total-contracted-share cap (offered + active, all issuers) with no
 * force override. Inserts a `status:"offered"` contract and notifies the corp
 * CEO. Caller handles auth (requireAuth) and the issuance feature gate.
 */
export async function issueContractOffer(
  db: Db,
  input: IssueContractOfferInput,
  actor: { characterId: import("mongodb").ObjectId; isAdmin: boolean },
  turn: number,
  now: Date
): Promise<IssueContractOfferResult> {
  const {
    countryId,
    stateId,
    corporationId,
    resource,
    share,
    royaltyRatePerTurn,
    termTurns,
    signingFeeAnchor,
  } = input;

  // Derive the issuer level, gated by the country's licensing authority law.
  const authority = await getResourceContractAuthority(db, countryId);
  const allowsNational = authority === "national" || authority === "both";
  const allowsState = authority === "state" || authority === "both";

  const canNational =
    allowsNational && (actor.isAdmin || (await isNationalIssuer(db, countryId, actor.characterId)));
  const canState =
    allowsState &&
    (actor.isAdmin || (await isStateIssuer(db, countryId, stateId, actor.characterId)));

  let grantedByLevel: "national" | "state";
  let grantedBy: string;
  if (canNational) {
    grantedByLevel = "national";
    grantedBy = countryId;
  } else if (canState) {
    grantedByLevel = "state";
    grantedBy = stateId;
  } else {
    return {
      ok: false,
      status: 403,
      error:
        authority === "national"
          ? "Only national officials may issue extraction contracts here."
          : authority === "state"
            ? "Only the state governor may issue extraction contracts here."
            : "You are not authorized to issue extraction contracts for this state.",
    };
  }

  // Resource must be an enabled deposit in a state that belongs to the country.
  const capCol = await getStateResourceCapacityCollection(db);
  const cap = await capCol.findOne({ stateId, countryId });
  if (!cap) {
    return { ok: false, status: 400, error: "That state is not part of this country." };
  }
  if ((cap.resources?.[resource] ?? 0) <= 0) {
    return { ok: false, status: 400, error: "That resource is not extractable in this state." };
  }

  // Target corporation must exist, be an extraction corp, and operate in the state.
  if (!ObjectId.isValid(corporationId)) {
    return { ok: false, status: 400, error: "Invalid corporation id." };
  }
  const corpId = new ObjectId(corporationId);
  const corp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corpId }, { projection: { type: 1, userId: 1, name: 1 } });
  if (!corp) {
    return { ok: false, status: 404, error: "Corporation not found." };
  }
  if (corp.type !== "extraction") {
    return {
      ok: false,
      status: 400,
      error: "Contracts can only be offered to extraction corporations.",
    };
  }
  const sector = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne({ corporationId: corpId, stateId }, { projection: { _id: 1 } });
  if (!sector) {
    return { ok: false, status: 400, error: "That corporation has no operations in this state." };
  }

  // 75% total-contracted-share cap (offered + active, any issuer). No override.
  const remainingHeadroom = await computeRemainingContractHeadroom(db, stateId, resource);
  if (share > remainingHeadroom + 1e-9) {
    return {
      ok: false,
      status: 409,
      error: "This offer would exceed the 75% contracted-capacity cap for this resource.",
      remainingHeadroom,
    };
  }

  const offerExpiresTurn = turn + CONTRACT_OFFER_EXPIRY_TURNS;
  const contract: Omit<ExtractionContract, "_id"> = {
    stateId,
    countryId,
    corporationId: corpId,
    resource,
    share,
    grantedTurn: turn,
    grantedBy,
    grantedByLevel,
    status: "offered",
    signingFeeAnchor,
    royaltyRatePerTurn,
    termTurns,
    offerExpiresTurn,
    updatedAt: now,
  };
  const contractsCol = await getExtractionContractsCollection(db);
  const insert = await contractsCol.insertOne(contract as ExtractionContract);

  // Re-check the cap AFTER the insert and roll back if we're over. The pre-insert
  // headroom read above is check-then-insert (TOCTOU): two concurrent offers for the
  // same (stateId, resource) can both pass it and both land, cornering >75% of a
  // resource's contracted capacity. Prod runs a standalone mongod (no multi-doc
  // transactions), so there is no atomic reservation to lean on — instead we let the
  // insert land, recompute the true total (which now includes this row), and delete
  // this offer if the total exceeds the cap. Fail-closed: under a genuine race both
  // racers may roll back and retry, which is correct behaviour for an anti-cornering
  // guard.
  const postInsertHeadroom = await computeRemainingContractHeadroom(db, stateId, resource);
  if (postInsertHeadroom < -1e-9) {
    await contractsCol.deleteOne({ _id: insert.insertedId });
    return {
      ok: false,
      status: 409,
      error: "This offer would exceed the 75% contracted-capacity cap for this resource.",
      remainingHeadroom: Math.max(0, remainingHeadroom),
    };
  }

  if (corp.userId) {
    await createNotifications([
      {
        userId: corp.userId,
        type: "contract_offered",
        title: "Extraction Contract Offered",
        message: `Your company has been offered a ${resource} extraction contract in ${stateId}. Review the signing fee and royalty terms to accept or decline before it lapses.`,
        metadata: {
          contractId: insert.insertedId.toString(),
          stateId,
          countryId,
          resource,
          share,
          signingFeeAnchor,
          royaltyRatePerTurn,
          termTurns,
          offerExpiresTurn,
        },
      },
    ]);
  }

  return {
    ok: true,
    status: 200,
    contractId: insert.insertedId.toString(),
    grantedByLevel,
    offerExpiresTurn,
  };
}
