import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadValuationFxRates,
} from "@/lib/currency/corporationCapital";
import { NPP_OPERATOR_TELEMETRY_COLLECTION } from "@/lib/corporations/nppOperatorTelemetry/persistence";
import type { NppOperatorAggregate } from "@/lib/corporations/nppOperatorTelemetry/rules";
import {
  computeNppCorporationHealth,
  type NppCorporationHealthCorporation,
} from "@/lib/economy/nppCorporationHealth";

const querySchema = z.object({
  turn: z.coerce.number().int().nonnegative().optional(),
});

// GET /api/admin/economy/npp-corp-health - Return the issue #2122 regression
// metric: per-sector cash-negative share and median liquid capital for NPP-led
// corporations, plus the aggregate binding-gate/binding-constraint counts from
// the persisted operator diagnostics. The metric is COMPUTED here from live
// corporation documents (this is a low-frequency admin read, not a turn hot
// path); the binding counts are read from the turn snapshot the NPP phase
// already flushed, so no entry/dividend formula is recomputed.
// Auth: requireAdmin
// Errors: 400, 403
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries())
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = await getDb();
    // NPP-led corps are exactly the ones the NPP brain operates: `ceoType` is
    // "npp". The query filters on that rather than loading the whole NPP id set.
    const corps = await db
      .collection<Corporation>("corporations")
      .find(
        { ceoType: "npp", suspended: { $ne: true } },
        {
          projection: {
            ceoId: 1,
            ceoType: 1,
            type: 1,
            liquidCapital: 1,
            liquidCurrencyCode: 1,
            countryId: 1,
            countryOwnerId: 1,
            bankCharter: 1,
          },
        }
      )
      .toArray();

    // liquidCapital is denominated in each corp's home currency; restate to ₳
    // anchor so the median is comparable across countries. Valuation rates
    // (with the authored era fallback) are correct here — nothing settles.
    const fxByCurrency = await loadValuationFxRates(db);
    const corporations: NppCorporationHealthCorporation[] = corps.map((corp) => ({
      ceoId: corp.ceoId?.toString() ?? "",
      ceoType: corp.ceoType ?? "npp",
      type: corp.type,
      liquidCapital: corpLiquidCapitalToAnchor(
        corp.liquidCapital ?? 0,
        corp,
        fxRateForCorpFromMap(corp, fxByCurrency)
      ),
      countryOwnerId: corp.countryOwnerId ?? null,
      bankCharter: corp.bankCharter ? { status: corp.bankCharter.status } : null,
    }));

    const diagnosticsCollection = db.collection<
      NppOperatorAggregate & { _id?: string; turn?: number }
    >(NPP_OPERATOR_TELEMETRY_COLLECTION);
    const diagnostics =
      parsed.data.turn == null
        ? await diagnosticsCollection.findOne({}, { sort: { turn: -1 } })
        : await diagnosticsCollection.findOne({ _id: `turn:${parsed.data.turn}` });

    const health = computeNppCorporationHealth({
      corporations,
      operatorDiagnostics: diagnostics,
    });

    return NextResponse.json({
      health,
      turn: diagnostics?.turn ?? parsed.data.turn ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
