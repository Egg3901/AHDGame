import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { buyBondSchema } from "@/lib/api/schemas/bonds";
import { handleRouteError } from "@/lib/api/errors";
import type { Bond, Corporation } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  estimateCorpWalletSpend,
  getCorpFxRate,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { distributeConversionSpread } from "@/lib/currency/marketMaker";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface RouteParams {
  params: Promise<{ bondId: string }>;
}

/**
 * POST /api/bonds/[bondId]/buyback
 * CEO buys back bond units from the public float, retiring them.
 * This reduces the corporation's outstanding debt.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const user = auth.user;

    const { bondId } = await params;
    const parsed = await parseJsonBody(request, buyBondSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { units } = parsed.data;
    const db = await getDb();

    // Buyback is a corporate-market action (CEO retires outstanding debt with
    // corporate funds): blocked while an admin has paused corporation actions.
    const pausedGuard = await requireCorporationActionsEnabled(db);
    if (pausedGuard) return pausedGuard;

    const bond = await db.collection<Bond>("bonds").findOne({ _id: new ObjectId(bondId) });
    if (!bond) {
      return NextResponse.json({ error: "Bond not found" }, { status: 404 });
    }

    if (bond.matured) {
      return NextResponse.json({ error: "Bond has already matured" }, { status: 400 });
    }

    // Verify CEO - use requireCeo for proper vacant seat handling
    const resolved = await resolveCorporation(db, bond.corporationId.toString());
    if (!resolved.ok) return resolved.response;
    const { corporation: issuingCorp } = resolved;

    const ceoCheck = requireCeo(issuingCorp, user.userId);
    if (ceoCheck) return ceoCheck;

    if (bond.publicFloat < units) {
      return NextResponse.json(
        { error: `Only ${bond.publicFloat} units available in public float` },
        { status: 400 }
      );
    }

    // Bond denomination — canonical key is `bond.currencyCode` (Task-18B). Do
    // not derive from issuer corp's current country: admin-initiated
    // cross-country HQ moves don't change the bond's denomination.
    const bondCurrency: CurrencyCode = (bond.currencyCode ??
      (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : "USD")) as CurrencyCode;

    // Defaulted bonds: buyback at full face value (no discount exploit).
    // Non-defaulted: buyback at current market price. Both expressions produce
    // LOCAL in `bondCurrency`.
    const pricePerUnit = bond.defaulted
      ? BOND_UNIT_FACE_VALUE
      : BOND_UNIT_FACE_VALUE * bond.marketPrice;
    const costLocal = units * pricePerUnit;

    // Normalize bond cost through ₳ before comparing / deducting against the
    // issuing corp's liquidCapital (stored in corp.liquidCurrencyCode). Pre-fix
    // this path compared LOCAL-bond cost directly with ₳-normalized corp
    // capital and deducted LOCAL as if it were ₳ (A21).
    const fxRates = await loadFxRatesRecord(db);
    const bondFxRate =
      fxRates[bondCurrency] && fxRates[bondCurrency]! > 0 ? fxRates[bondCurrency]! : 1;
    const costAnchor = corpCapitalToAnchor(costLocal, bondCurrency, bondFxRate);
    const corpCurrency = resolveCorpLiquidCurrencyCode(issuingCorp) ?? null;
    const corpPurchaseEstimate = estimateCorpWalletSpend({
      requiredAmount: costLocal,
      availableBalance: issuingCorp.liquidCapital ?? 0,
      fromCurrency: corpCurrency,
      toCurrency: bondCurrency,
      rates: fxRates,
    });
    if (!corpPurchaseEstimate) {
      return NextResponse.json(
        { error: "Exchange rate unavailable, try again shortly" },
        { status: 503 }
      );
    }
    if (!corpPurchaseEstimate.canAfford) {
      const corpSym = CURRENCY_SYMBOLS[corpCurrency ?? "USD"] ?? "$";
      const bondSym = CURRENCY_SYMBOLS[bondCurrency] ?? "$";
      const needStr = costLocal.toLocaleString(undefined, { minimumFractionDigits: 2 });
      const adjustedStr = corpPurchaseEstimate.requiredFromAmount.toLocaleString(undefined, {
        minimumFractionDigits: 2,
      });
      const haveStr = (issuingCorp.liquidCapital ?? 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
      });
      const currencyNote =
        corpCurrency && corpCurrency !== bondCurrency
          ? ` (~${corpSym}${adjustedStr} ${corpCurrency} incl. FX, corp has ${corpSym}${haveStr} ${corpCurrency})`
          : `, have ${corpSym}${haveStr} ${corpCurrency ?? "USD"}`;
      return NextResponse.json(
        {
          error: `Insufficient corporate funds. Need ${bondSym}${needStr} ${bondCurrency}${currencyNote}`,
        },
        { status: 400 }
      );
    }

    const now = new Date();
    const retiredFaceValue = units * BOND_UNIT_FACE_VALUE;
    const holderUnits = bond.holders.reduce((sum, h) => sum + h.units, 0);
    const corpFxRate = await getCorpFxRate(db, issuingCorp);
    const costInCorpCapital =
      corpCurrency && corpCurrency !== bondCurrency
        ? corpPurchaseEstimate.spendAmount
        : anchorToCorpLiquidCapital(costAnchor, issuingCorp, corpFxRate);

    const debitResult = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: issuingCorp._id, liquidCapital: { $gte: costInCorpCapital } },
        { $inc: { liquidCapital: -costInCorpCapital }, $set: { updatedAt: now } }
      );
    if (debitResult.modifiedCount === 0) {
      return NextResponse.json(
        { error: "Insufficient corporate funds (race with another transaction)." },
        { status: 400 }
      );
    }

    let bondUpdateFilter: Record<string, unknown> = {
      _id: bond._id,
      matured: false,
      publicFloat: { $gte: units },
    };
    let bondUpdate: Record<string, unknown> = { updatedAt: now };
    if (holderUnits <= 0 && bond.publicFloat === units) {
      bondUpdateFilter = { _id: bond._id, matured: false, publicFloat: units };
      bondUpdate = {
        ...bondUpdate,
        matured: true,
        defaulted: false,
        marketPrice: 1.0,
      };
    }

    const floatClaim = await db.collection<Bond>("bonds").updateOne(bondUpdateFilter, {
      $inc: { publicFloat: -units, totalIssued: -retiredFaceValue },
      $set: bondUpdate,
    });

    if (floatClaim.modifiedCount === 0) {
      await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: issuingCorp._id },
          { $inc: { liquidCapital: costInCorpCapital }, $set: { updatedAt: new Date() } }
        );
      const refreshedBond = await db.collection<Bond>("bonds").findOne({ _id: bond._id });
      return NextResponse.json(
        {
          error: `Only ${refreshedBond?.publicFloat ?? 0} units available in public float`,
        },
        { status: 400 }
      );
    }

    const refreshedBond = await db.collection<Bond>("bonds").findOne({ _id: bond._id });
    const remainingPublicFloat =
      refreshedBond?.publicFloat ?? Math.max(0, bond.publicFloat - units);
    const newTotalIssued = refreshedBond?.totalIssued ?? bond.totalIssued - retiredFaceValue;
    const fullyRetired =
      (refreshedBond?.publicFloat ?? 0) <= 0 &&
      (refreshedBond?.holders?.reduce((sum, h) => sum + h.units, 0) ?? holderUnits) <= 0;

    if (fullyRetired && refreshedBond && !refreshedBond.matured) {
      await db.collection<Bond>("bonds").updateOne(
        { _id: refreshedBond._id, matured: false, publicFloat: { $lte: 0 } },
        {
          $set: {
            matured: true,
            defaulted: false,
            marketPrice: 1.0,
            updatedAt: now,
          },
        }
      );
    }

    // Route the FX spread the corp paid on a cross-currency buyback into the CB
    // system (was destroyed). The corp already lost it via spendAmount above.
    if (corpCurrency && corpCurrency !== bondCurrency) {
      await distributeConversionSpread(
        db,
        corpPurchaseEstimate.spreadFee,
        corpCurrency,
        bondCurrency
      );
    }

    return NextResponse.json({
      success: true,
      unitsBoughtBack: units,
      cost: Math.round(costLocal * 100) / 100,
      costCurrency: bondCurrency,
      pricePerUnit: Math.round(pricePerUnit * 100) / 100,
      remainingPublicFloat,
      newTotalIssued,
      fullyRetired,
      spreadPaid:
        corpCurrency && corpCurrency !== bondCurrency
          ? Math.round(corpPurchaseEstimate.spreadFee * 100) / 100
          : 0,
      spreadCurrency: corpCurrency ?? bondCurrency,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
