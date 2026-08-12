// GET /api/corporations/[id]/group — consolidated group balance sheet (C4),
// plus the group's recent loss relief and transfer-pricing audit outcomes (C5)
// read back from the financial tx log, and open exposure from the agreements.
// Auth: requireBasicAuth
// Errors: 401, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { loadGroupBalanceSheet } from "@/lib/corporations/groups/groupBalanceSheet";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import type { SupplyAgreement } from "@/lib/db/types/supplyAgreement";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;

    // Deliberately readable by anyone, not just the CEO. A group's size is the
    // thing competition policy and rival CEOs need to be able to see; hiding it
    // behind ownership would make the structure a way to disappear rather than
    // a way to organise.
    const sheet = await loadGroupBalanceSheet(db, resolved.corporation._id);
    if (!sheet) {
      return NextResponse.json({ group: null, lossRelief: null, transferPricing: null });
    }

    const memberIds = sheet.members.map((m) => new ObjectId(m.corporationId));
    const txLog = db.collection<FinancialTxLogEntry>("financialTxLog");
    const [reliefTxs, auditTxs, exposedAgreements] = await Promise.all([
      // The tx log has a ~7-day TTL, so this is inherently "recent" — which is
      // exactly the window the panel wants.
      txLog
        .find({ type: "corp_group_relief", subjectId: { $in: memberIds } })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray(),
      txLog
        .find({
          type: "corp_fine",
          "meta.kind": "transfer_pricing_assessment",
          subjectId: { $in: memberIds },
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray(),
      db
        .collection<SupplyAgreement>("supplyAgreements")
        .find({
          supplierCorpId: { $in: memberIds },
          buyerCorpId: { $in: memberIds },
          status: { $in: ["active", "cancelling"] },
          transferPricingExposureAnchor: { $gt: 0 },
        })
        .project<Pick<SupplyAgreement, "transferPricingExposureAnchor">>({
          transferPricingExposureAnchor: 1,
        })
        .toArray(),
    ]);

    // "This cycle" = the most recent turn that credited relief to this group.
    const reliefTurn = reliefTxs.length > 0 ? Math.max(...reliefTxs.map((t) => t.turn)) : null;
    const lossRelief =
      reliefTurn === null
        ? null
        : {
            turn: reliefTurn,
            corpsCredited: reliefTxs.filter((t) => t.turn === reliefTurn).length,
            totalReliefAnchor: Math.round(
              reliefTxs
                .filter((t) => t.turn === reliefTurn)
                .reduce((sum, t) => sum + (Number(t.meta?.reliefAnchor) || 0), 0)
            ),
          };

    const transferPricing = {
      exposedAgreements: exposedAgreements.length,
      openExposureAnchor: Math.round(
        exposedAgreements.reduce((sum, a) => sum + (a.transferPricingExposureAnchor ?? 0), 0)
      ),
      recentAudits: auditTxs.map((t) => ({
        turn: t.turn,
        corporationName: t.subjectName ?? "Unknown",
        treasury: t.counterpartyName ?? "Tax authority",
        shiftedBaseAnchor: Number(t.meta?.shiftedBaseAnchor) || 0,
        assessmentAnchor: Number(t.meta?.assessmentAnchor) || 0,
      })),
    };

    return NextResponse.json({ group: sheet, lossRelief, transferPricing });
  } catch (error) {
    return handleRouteError(error);
  }
}
