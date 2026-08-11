import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getAuthUser } from "@/lib/auth";
import { shouldRedactCorporation } from "@/lib/corporations/redaction";
import { getRoundedPublicMarketCap } from "@/lib/corporations/marketQuote";
import type { CorporationHistory } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

type CorporationHistoryChartRow = Pick<
  CorporationHistory,
  | "turn"
  | "sharePrice"
  | "marketCap"
  | "liquidCapital"
  | "revenue"
  | "totalCosts"
  | "income"
  | "incomePreDividends"
  | "dividendPaidPerTurn"
  | "corporateTaxPaid"
  | "federalTaxPaid"
  | "stateTaxPaid"
  | "perTurnBondCouponIncome"
  | "perTurnBondInterestExpense"
  | "perTurnBondDragOnNetIncome"
  | "taxPaidByCountry"
  | "taxPaidByState"
  | "taxPaidByCountryDomestic"
  | "taxPaidByCountryForeign"
  | "taxPaidByStateDomestic"
  | "taxPaidByStateForeign"
  | "marketingStrength"
  | "dividendRate"
  | "brandLoyalty"
  | "averageQuality"
  | "commodityOutput"
  | "creditComposite"
  | "creditRating"
  | "marginDiagnostic"
  | "currencyCode"
  | "fxRateAtWrite"
  | "totalShares"
  | "createdAt"
>;

// GET /api/corporations/[id]/history — Returns immutable corporation chart history snapshots.
// Auth: public
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // Fog of war: private corps return no historical financial deltas to non-CEO viewers.
    // The chart axis is meaningless without numbers; we send an empty history so the UI
    // can render an "Information not disclosed" placeholder.
    const authUser = await getAuthUser().catch(() => null);
    const modViewEnabled =
      !authUser?.isAdmin &&
      authUser?.isModerator === true &&
      new URL(request.url).searchParams.get("modView") === "1";
    if (
      shouldRedactCorporation(
        corporation,
        authUser?.userId,
        authUser?.isAdmin === true,
        modViewEnabled
      )
    ) {
      return NextResponse.json(
        { history: [], isPrivate: true },
        {
          headers: {
            "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
          },
        }
      );
    }

    // Default view returns the most recent 500 per-turn snapshots (consecutive
    // turns — the masthead sparkline / day-change rely on that). The Charts tab
    // requests `?full=1` for the full history back to game start, downsampled to
    // ~MAX_CHART_POINTS evenly-spaced points so the payload stays bounded
    // without dropping the early years.
    const fullRange = new URL(request.url).searchParams.get("full") === "1";
    const MAX_CHART_POINTS = 500;

    // Per-turn snapshot count drives the downsample stride for the full view.
    let stride = 1;
    let snapshotTurns = 0;
    if (fullRange) {
      const countRes = await db
        .collection<CorporationHistory>("corporationHistory")
        .aggregate<{ n: number }>([
          { $match: { corporationId: corporation._id } },
          { $group: { _id: "$turn" } },
          { $count: "n" },
        ])
        .toArray();
      snapshotTurns = countRes[0]?.n ?? 0;
      stride = Math.max(1, Math.ceil(snapshotTurns / MAX_CHART_POINTS));
    }

    const dedupeStages = [
      { $match: { corporationId: corporation._id } },
      { $sort: { turn: -1, createdAt: -1, _id: -1 } },
      { $group: { _id: "$turn", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
    ];

    // Recent-500 window vs full-range downsample (every `stride`-th turn, always
    // keeping the newest snapshot so the latest price is exact).
    const windowStages = fullRange
      ? [
          { $sort: { turn: 1 } },
          {
            $setWindowFields: {
              sortBy: { turn: 1 },
              output: { _rank: { $documentNumber: {} } },
            },
          },
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: [{ $mod: [{ $subtract: ["$_rank", 1] }, stride] }, 0] },
                  { $eq: ["$_rank", snapshotTurns] },
                ],
              },
            },
          },
          { $sort: { turn: 1 } },
        ]
      : [{ $sort: { turn: -1 } }, { $limit: 500 }, { $sort: { turn: 1 } }];

    const history = await db
      .collection<CorporationHistory>("corporationHistory")
      .aggregate<CorporationHistoryChartRow>([
        ...dedupeStages,
        ...windowStages,
        {
          $project: {
            _id: 0,
            turn: 1,
            sharePrice: 1,
            marketCap: 1,
            liquidCapital: 1,
            revenue: 1,
            totalCosts: 1,
            income: 1,
            incomePreDividends: 1,
            dividendPaidPerTurn: 1,
            corporateTaxPaid: 1,
            federalTaxPaid: 1,
            stateTaxPaid: 1,
            perTurnBondCouponIncome: 1,
            perTurnBondDragOnNetIncome: 1,
            taxPaidByCountry: 1,
            taxPaidByState: 1,
            taxPaidByCountryDomestic: 1,
            taxPaidByCountryForeign: 1,
            taxPaidByStateDomestic: 1,
            taxPaidByStateForeign: 1,
            marketingStrength: 1,
            dividendRate: 1,
            creditComposite: 1,
            creditRating: 1,
            marginDiagnostic: 1,
            currencyCode: 1,
            fxRateAtWrite: 1,
            totalShares: 1,
            brandLoyalty: 1,
            averageQuality: 1,
            commodityOutput: 1,
            createdAt: 1,
          },
        },
      ])
      .toArray();

    const responseHistory = history.map(
      ({ totalShares: _totalShares, createdAt: _createdAt, ...row }) => row
    );

    // #963: the most recent point is frozen at last turn-processing time
    // (snapshotMarketCap writes it once per turn), so it can visibly disagree
    // with the live Market Cap on the Overview card (getRoundedPublicMarketCap,
    // computed from the corp document's current sharePrice/totalShares on every
    // request). Overwrite just the latest point with that same live figure —
    // older points stay frozen snapshots, since re-deriving them would drift
    // (#2958's whole reason fxRateAtWrite exists). Stamp the corp's current
    // currency and drop fxRateAtWrite so the chart's toAnchor conversion uses
    // the live rate instead of a stale one for this one live-valued point.
    const latestPoint = responseHistory[responseHistory.length - 1];
    if (latestPoint) {
      latestPoint.marketCap = getRoundedPublicMarketCap(corporation, corporation.totalShares ?? 0);
      latestPoint.currencyCode = corporation.liquidCurrencyCode;
      delete latestPoint.fxRateAtWrite;
    }

    return NextResponse.json(
      { history: responseHistory },
      {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
