import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { listPrimaryUnderwritingBanks } from "@/lib/banking/underwritingOffer";
import { capturePrimaryUnderwritingCurrencySnapshot } from "@/lib/banking/underwritingTypes";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { getDb } from "@/lib/mongodb";
import type { Corporation } from "@/lib/db/types";
import { getGameState } from "@/lib/gameState";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const mandateSchema = z.object({
  bankCorporationId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .nullable(),
});

/** Read the issuer's available same-currency investment bank choices. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const ceoError = requireCeo(resolved.corporation, auth.user.userId);
    if (ceoError) return ceoError;

    const policy = await loadBankingPolicy(db);
    if (!policy.primaryUnderwriting) {
      return NextResponse.json({ enabled: false, selectedBankId: null, banks: [] });
    }
    const currencyCode = resolveCorpLiquidCurrencyCode(resolved.corporation);
    if (!currencyCode) return errorResponse(409, "Corporation currency is unavailable");
    const banks = await listPrimaryUnderwritingBanks(db, policy, currencyCode);
    return NextResponse.json({
      enabled: true,
      selectedBankId:
        resolved.corporation.primaryUnderwritingMandate?.bankCorporationId.toHexString() ?? null,
      banks,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Replace or clear the CEO-selected primary underwriting mandate. */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, mandateSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const ceoError = requireCeo(corporation, auth.user.userId);
    if (ceoError) return ceoError;

    const policy = await loadBankingPolicy(db);
    if (!policy.primaryUnderwriting) {
      return errorResponse(409, "Primary underwriting is unavailable");
    }
    const corporationActionBlock = await requireCorporationActionsEnabled(db);
    if (corporationActionBlock) return corporationActionBlock;
    const turnBlock = await rejectDuringTurn(db);
    if (turnBlock) return turnBlock;

    const nowTurn = (await getGameState(db))?.currentTurn ?? 1;
    const now = new Date();
    const issuerCurrencySnapshot = capturePrimaryUnderwritingCurrencySnapshot(corporation);
    const revisionFilter =
      corporation.primaryUnderwritingMandateRevision === undefined
        ? { primaryUnderwritingMandateRevision: { $exists: false } }
        : { primaryUnderwritingMandateRevision: corporation.primaryUnderwritingMandateRevision };
    const CEO_FILTER = {
      _id: corporation._id,
      userId: corporation.userId,
      ceoVacant: { $ne: true },
      ...(Object.hasOwn(corporation, "ceoId")
        ? { ceoId: { $exists: true, $eq: corporation.ceoId } }
        : { ceoId: { $exists: false } }),
      ...(Object.hasOwn(corporation, "ceoType")
        ? { ceoType: { $exists: true, $eq: corporation.ceoType } }
        : { ceoType: { $exists: false } }),
      ...revisionFilter,
      ...(corporation.liquidCurrencyCode === undefined
        ? { liquidCurrencyCode: { $exists: false } }
        : { liquidCurrencyCode: corporation.liquidCurrencyCode }),
      ...(issuerCurrencySnapshot?.countryIdPresent
        ? {
            $or: [
              { countryId: issuerCurrencySnapshot.countryId as Corporation["countryId"] },
              ...(corporation.headquartersState
                ? [
                    {
                      countryId: { $exists: false },
                      headquartersState: corporation.headquartersState,
                    },
                  ]
                : []),
            ],
          }
        : { countryId: { $exists: false } }),
    };
    if (parsed.data.bankCorporationId === null) {
      const result = await db.collection<Corporation>("corporations").updateOne(CEO_FILTER, {
        $unset: { primaryUnderwritingMandate: "" },
        $set: { updatedAt: now },
        $inc: { primaryUnderwritingMandateRevision: 1 },
      });
      if (result.matchedCount !== 1) {
        return errorResponse(409, "CEO, currency, or mandate changed; retry");
      }
      return NextResponse.json({ ok: true, selectedBankId: null });
    }

    const bankId = new ObjectId(parsed.data.bankCorporationId);
    if (bankId.equals(corporation._id)) {
      return errorResponse(400, "Choose another corporation's bank");
    }
    const currencyCode = resolveCorpLiquidCurrencyCode(corporation);
    if (!currencyCode) return errorResponse(409, "Corporation currency is unavailable");
    const bank = await db.collection<Corporation>("corporations").findOne(
      {
        _id: bankId,
        "bankCharter.status": "active",
        "bankCharter.type": { $in: ["investment", "universal"] },
        "bankCharter.currency": currencyCode,
        "bankCharter.resolutionClaimedTurn": { $exists: false },
        bankCharterTransfer: { $exists: false },
        bankPrimaryFunding: { $exists: false },
        bankUnderwritingFunding: { $exists: false },
        bankConstructionFunding: { $exists: false },
      },
      { projection: { _id: 1, bankCharter: 1, countryId: 1, liquidCurrencyCode: 1 } }
    );
    if (
      !bank?.bankCharter ||
      !Number.isInteger(bank.bankCharter.charteredTurn) ||
      capturePrimaryUnderwritingCurrencySnapshot(bank)?.currencyCode !== currencyCode
    ) {
      return errorResponse(409, "The selected bank is no longer eligible in this currency");
    }
    const result = await db.collection<Corporation>("corporations").updateOne(CEO_FILTER, {
      $set: {
        primaryUnderwritingMandate: {
          bankCorporationId: bank._id,
          charteredTurn: bank.bankCharter.charteredTurn,
          currencyCode,
          feeRate: 0.015,
          selectedAtTurn: nowTurn,
        },
        updatedAt: now,
      },
      $inc: { primaryUnderwritingMandateRevision: 1 },
    });
    if (result.matchedCount !== 1) {
      return errorResponse(409, "Corporation currency changed; retry");
    }
    return NextResponse.json({ ok: true, selectedBankId: bank._id.toHexString() });
  } catch (error) {
    return handleRouteError(error);
  }
}
