import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { listPrimaryUnderwritingBanks } from "@/lib/banking/underwritingOffer";
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
    const currencyCode = resolved.corporation.liquidCurrencyCode ?? "USD";
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
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const ceoError = requireCeo(corporation, auth.user.userId);
    if (ceoError) return ceoError;

    const policy = await loadBankingPolicy(db);
    if (!policy.primaryUnderwriting) {
      return NextResponse.json({ error: "Primary underwriting is unavailable" }, { status: 409 });
    }

    const nowTurn = (await getGameState(db))?.currentTurn ?? 1;
    const now = new Date();
    if (parsed.data.bankCorporationId === null) {
      await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: corporation._id },
          { $unset: { primaryUnderwritingMandate: "" }, $set: { updatedAt: now } }
        );
      return NextResponse.json({ ok: true, selectedBankId: null });
    }

    const bankId = new ObjectId(parsed.data.bankCorporationId);
    if (bankId.equals(corporation._id)) {
      return NextResponse.json({ error: "Choose another corporation's bank" }, { status: 400 });
    }
    const currencyCode = corporation.liquidCurrencyCode ?? "USD";
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
      { projection: { _id: 1, bankCharter: 1 } }
    );
    if (!bank?.bankCharter || !Number.isInteger(bank.bankCharter.charteredTurn)) {
      return NextResponse.json(
        { error: "The selected bank is no longer eligible in this currency" },
        { status: 409 }
      );
    }
    const result = await db.collection<Corporation>("corporations").updateOne(
      {
        _id: corporation._id,
        ...(corporation.liquidCurrencyCode === undefined
          ? { liquidCurrencyCode: { $exists: false } }
          : { liquidCurrencyCode: corporation.liquidCurrencyCode }),
      },
      {
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
      }
    );
    if (result.matchedCount !== 1) {
      return NextResponse.json({ error: "Corporation currency changed; retry" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, selectedBankId: bank._id.toHexString() });
  } catch (error) {
    return handleRouteError(error);
  }
}
