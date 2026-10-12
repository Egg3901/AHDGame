import { withNoStore } from "@/lib/api/withNoStore";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { isIndexFundsEnabled } from "@/lib/indexFunds/featureFlag";
import { validateCharter } from "@/lib/indexFunds/sponsorship/charterFund";
import {
  FUND_CHARTER_FEE_ANCHOR,
  FUND_MIN_SEED_CAPITAL_ANCHOR,
  MIN_EXPENSE_RATIO_ANNUAL,
} from "@/lib/indexFunds/sponsorship/constants";
import { getCorpFxRate, anchorToCorpLiquidCapital } from "@/lib/currency/corporationCapital";
import type { GameConfig, CorporateSector } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireCeo, resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { listFundsBySponsor } from "@/lib/indexFunds/fundQueries";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/corporations/[id]/funds: Index funds this corporation sponsors.
// Public listing (fund existence is public). Fixes ticket 1088: a chartered
// fund was invisible to its owner after the charter session.
// Errors: 404
export const GET = withNoStore(async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;

    const corporation = resolved.corporation;
    const auth = await getAuthUser();
    let canCreate = false;
    if (
      auth &&
      !requireCeo(corporation, auth.userId) &&
      !(await requireCorporationActionsEnabled(db)) &&
      (await isIndexFundsEnabled())
    ) {
      const config = await db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { playerFundSponsorshipEnabled: 1 } });
      if (config?.playerFundSponsorshipEnabled && corporation.bankCharter?.status !== "active") {
        const sectors = await db
          .collection<CorporateSector>("corporateSectors")
          .find({ corporationId: corporation._id })
          .project<{ sectorType: CorporateSector["sectorType"] }>({ sectorType: 1 })
          .toArray();
        const invalid = validateCharter(
          {
            name: "Sample fund",
            tickerSymbol: "SAMPLE",
            scope: "global",
            kind: "broad",
            expenseRatioAnnual: MIN_EXPENSE_RATIO_ANNUAL,
            seedCapitalAnchor: FUND_MIN_SEED_CAPITAL_ANCHOR,
          },
          sectors.map((sector) => sector.sectorType)
        );
        if (!invalid) {
          const minimumCost = Math.round(
            anchorToCorpLiquidCapital(
              FUND_CHARTER_FEE_ANCHOR + FUND_MIN_SEED_CAPITAL_ANCHOR,
              corporation,
              await getCorpFxRate(db, corporation)
            )
          );
          canCreate = corporation.liquidCapital >= minimumCost;
        }
      }
    }
    const funds = await listFundsBySponsor(db, corporation._id);
    return NextResponse.json({
      canCreate,
      funds: funds.map((f) => ({
        id: f._id.toString(),
        slug: f.slug,
        name: f.name,
        ticker: f.tickerSymbol,
        status: f.status,
        scope: f.scope,
        kind: f.kind,
        countryId: f.countryId ?? null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
