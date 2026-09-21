/**
 * Advertising agreement command shell (issue #2235 slice).
 *
 * Thin route handlers: auth guard, CEO check, feature flag, Zod parse (done
 * by the caller via parseJsonBody), then into
 * `src/lib/advertising/persistence.ts`. All negotiation state transitions
 * stay in persistence; this layer only maps outcomes to HTTP statuses.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/currentTurn";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { isCorporationProductsEnabled } from "@/lib/products/featureFlag";
import { productFamilyForCorporationType } from "@/lib/products/types";
import { CORPORATION_OPERATING_MODELS_COLLECTION } from "@/lib/products/persistence";
import {
  advertisingAgreementProposalSchema,
  advertisingAgreementUpdateSchema,
} from "@/lib/api/schemas/advertisingAgreements";
import {
  ADVERTISING_AGREEMENTS_COLLECTION,
  type AdvertisingAgreement,
} from "@/lib/advertising/types";
import {
  getAdvertisingAgreementsForCorp,
  getBuyerCommittedShareBps,
  proposeAdvertisingAgreementPersistent,
  updateAdvertisingAgreementPersistent,
} from "@/lib/advertising/persistence";

export function serializeAdvertisingAgreement(agreement: AdvertisingAgreement) {
  return {
    id: agreement._id,
    buyerCorpId: agreement.buyerCorpId,
    supplierCorpId: agreement.supplierCorpId,
    allocationShareBps: agreement.allocationShareBps,
    ...(agreement.durationTurns !== undefined ? { durationTurns: agreement.durationTurns } : {}),
    ...(agreement.startsAtTurn !== undefined ? { startsAtTurn: agreement.startsAtTurn } : {}),
    ...(agreement.expiresAtTurn !== undefined ? { expiresAtTurn: agreement.expiresAtTurn } : {}),
    ...(agreement.cancelEffectiveTurn !== undefined
      ? { cancelEffectiveTurn: agreement.cancelEffectiveTurn }
      : {}),
    status: agreement.status,
    proposedByCorpId: agreement.proposedByCorpId,
    ...(agreement.currentOffer
      ? {
          currentOffer: {
            revision: agreement.currentOffer.revision,
            proposedByCorpId: agreement.currentOffer.proposedByCorpId,
            allocationShareBps: agreement.currentOffer.allocationShareBps,
            ...(agreement.currentOffer.durationTurns !== undefined
              ? { durationTurns: agreement.currentOffer.durationTurns }
              : {}),
          },
        }
      : {}),
    ...(agreement.lastSettlementTurn !== undefined
      ? { lastSettlementTurn: agreement.lastSettlementTurn }
      : {}),
    ...(agreement.lastCoveredSpendAnchor !== undefined
      ? { lastCoveredSpendAnchor: agreement.lastCoveredSpendAnchor }
      : {}),
    ...(agreement.lastEffectiveAnchor !== undefined
      ? { lastEffectiveAnchor: agreement.lastEffectiveAnchor }
      : {}),
    ...(agreement.lastOverlap !== undefined ? { lastOverlap: agreement.lastOverlap } : {}),
  };
}

/** GET /api/corporations/[id]/advertising-agreements: CEO-only agreement list. */
export async function listAdvertisingAgreements(corpId: string) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const resolved = await resolveCorporation(db, corpId);
    if (!resolved.ok) return resolved.response;
    const corp = resolved.corporation;
    const ceoCheck = requireCeo(corp, auth.user.userId);
    if (ceoCheck) return ceoCheck;
    if (!(await isCorporationProductsEnabled(db))) {
      return NextResponse.json(
        { error: "Corporation products are not enabled in this world" },
        { status: 403 }
      );
    }

    const corpHex = corp._id.toString();
    const agreements = await getAdvertisingAgreementsForCorp(db, corpHex);
    const counterpartyHex = [
      ...new Set(
        agreements.flatMap((agreement) => [agreement.supplierCorpId, agreement.buyerCorpId])
      ),
    ].filter((id) => ObjectId.isValid(id));
    const counterparties =
      counterpartyHex.length > 0
        ? await db
            .collection("corporations")
            .find({ _id: { $in: counterpartyHex.map((id) => new ObjectId(id)) } })
            .project<{ _id: ObjectId; name: string; ticker?: string | null }>({
              name: 1,
              ticker: 1,
            })
            .toArray()
        : [];
    const counterpartyById = new Map(
      counterparties.map((counterparty) => [counterparty._id.toString(), counterparty])
    );
    return NextResponse.json(
      {
        agreements: agreements.map((agreement) => {
          const counterpartyHexId =
            agreement.buyerCorpId === corpHex ? agreement.supplierCorpId : agreement.buyerCorpId;
          const counterparty = counterpartyById.get(counterpartyHexId);
          return {
            ...serializeAdvertisingAgreement(agreement),
            role: agreement.buyerCorpId === corpHex ? "buyer" : "supplier",
            ...(counterparty
              ? {
                  counterparty: {
                    id: counterpartyHexId,
                    name: counterparty.name,
                    ...(counterparty.ticker ? { ticker: counterparty.ticker } : {}),
                  },
                }
              : {}),
          };
        }),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/corporations/[id]/advertising-agreements: CEO-only propose. */
export async function proposeAdvertisingAgreement(request: Request, initiatingCorpId: string) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, advertisingAgreementProposalSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const db = await getDb();
    const resolved = await resolveCorporation(db, initiatingCorpId);
    if (!resolved.ok) return resolved.response;
    const initiator = resolved.corporation;
    const ceoCheck = requireCeo(initiator, auth.user.userId);
    if (ceoCheck) return ceoCheck;
    if (!(await isCorporationProductsEnabled(db))) {
      return NextResponse.json(
        { error: "Corporation products are not enabled in this world" },
        { status: 403 }
      );
    }

    const body = parsed.data;
    const isSupplierInitiated = !!body.buyerCorpId;
    const counterpartyResolved = await resolveCorporation(
      db,
      isSupplierInitiated ? body.buyerCorpId! : body.supplierCorpId!
    );
    if (!counterpartyResolved.ok) return counterpartyResolved.response;
    const counterparty = counterpartyResolved.corporation;
    if (counterparty._id.equals(initiator._id)) {
      return NextResponse.json(
        { error: "A corporation cannot contract with itself" },
        { status: 400 }
      );
    }
    const initiatorHex = initiator._id.toString();
    const counterpartyHex = counterparty._id.toString();
    const supplier = isSupplierInitiated ? initiator : counterparty;
    const supplierHex = supplier._id.toString();
    if (productFamilyForCorporationType(supplier.type) !== "media_entertainment") {
      return NextResponse.json(
        { error: "Advertising suppliers must be Media & Entertainment corporations" },
        { status: 400 }
      );
    }
    const supplierModelCount = await db
      .collection(CORPORATION_OPERATING_MODELS_COLLECTION)
      .countDocuments({ corporationId: supplierHex });
    if (supplierModelCount === 0) {
      return NextResponse.json(
        { error: "Advertising suppliers need an operating model" },
        { status: 400 }
      );
    }
    const turn = await getCurrentTurn(db);
    const now = new Date();
    const proposed = await proposeAdvertisingAgreementPersistent(db, {
      enabled: true,
      buyerCorpId: isSupplierInitiated ? counterpartyHex : initiatorHex,
      supplierCorpId: isSupplierInitiated ? initiatorHex : counterpartyHex,
      proposedByCorpId: initiatorHex,
      allocationShareBps: body.allocationShareBps,
      ...(body.durationTurns !== undefined ? { durationTurns: body.durationTurns } : {}),
      turn,
      now,
    });
    if (!proposed.ok) {
      const status = proposed.reason === "feature_disabled" ? 403 : 400;
      return NextResponse.json({ error: proposed.reason }, { status });
    }
    return NextResponse.json({
      success: true,
      agreementId: proposed.agreement._id,
      agreement: serializeAdvertisingAgreement(proposed.agreement),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** PATCH .../[agreementId]: CEO-only accept, counter, or cancel. */
export async function updateAdvertisingAgreement(
  request: Request,
  corpId: string,
  agreementId: string
) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, advertisingAgreementUpdateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const db = await getDb();
    if (!ObjectId.isValid(agreementId)) {
      return NextResponse.json({ error: "Invalid agreement id" }, { status: 400 });
    }
    const resolved = await resolveCorporation(db, corpId);
    if (!resolved.ok) return resolved.response;
    const corp = resolved.corporation;
    const ceoCheck = requireCeo(corp, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!(await isCorporationProductsEnabled(db))) {
      return NextResponse.json(
        { error: "Corporation products are not enabled in this world" },
        { status: 403 }
      );
    }

    const agreement = await db
      .collection<AdvertisingAgreement>(ADVERTISING_AGREEMENTS_COLLECTION)
      .findOne({ _id: agreementId } as never);
    if (!agreement) {
      return NextResponse.json({ error: "Agreement not found" }, { status: 404 });
    }
    const corpHex = corp._id.toString();
    if (agreement.buyerCorpId !== corpHex && agreement.supplierCorpId !== corpHex) {
      return NextResponse.json({ error: "Not a party to this agreement" }, { status: 403 });
    }

    const body = parsed.data;
    const turn = await getCurrentTurn(db);
    const buyerCommittedShareBps =
      body.action === "accept"
        ? await getBuyerCommittedShareBps(db, agreement.buyerCorpId, turn)
        : undefined;
    const updated = await updateAdvertisingAgreementPersistent(db, {
      agreementId,
      corpId: corpHex,
      action: body.action,
      ...(body.action === "counter"
        ? {
            allocationShareBps: body.allocationShareBps,
            ...(body.durationTurns !== undefined ? { durationTurns: body.durationTurns } : {}),
          }
        : {}),
      turn,
      ...(buyerCommittedShareBps !== undefined ? { buyerCommittedShareBps } : {}),
    });
    if (!updated.ok) {
      const status =
        updated.reason === "not_found"
          ? 404
          : updated.reason === "not_party" || updated.reason === "not_counterparty"
            ? 403
            : updated.reason === "stale_offer" ||
                updated.reason === "allocation_exceeds_budget" ||
                updated.reason === "already_closed"
              ? 409
              : 400;
      return NextResponse.json({ error: updated.reason }, { status });
    }
    return NextResponse.json({
      success: true,
      status: updated.agreement.status,
      agreement: serializeAdvertisingAgreement(updated.agreement),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
