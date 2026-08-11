import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { issueBondSchema } from "@/lib/api/schemas/bonds";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { Corporation, Bond, CorporateSector } from "@/lib/db/types";
import { getTurnReferenceData } from "@/lib/corporations/turnReferenceData";
import { withCorpLock } from "@/lib/corporations/corpMoneyLock";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import {
  BOND_ISSUANCE_FREEZE_UNTIL,
  BOND_ISSUANCE_COOLDOWN_TURNS,
  BOND_ISSUANCE_COOLDOWN_TURNS_PRIVATE,
  MIN_BOND_ISSUANCE,
  MAX_BOND_ISSUANCE_FRACTION,
  MAX_BOND_ISSUANCE_REVENUE_FRACTION,
  MIN_BOND_ISSUANCE_PER_ISSUE,
  calculateCreditScore,
  getBondCouponRate,
} from "@/lib/constants/bonds";
import {
  computeCorporateCreditAtTurn,
  sumCorporateSectorNpv,
  sumCorporateSectorPerTurnIncome,
  sumCorporateSectorAnnualRevenue,
  sumCorporateSectorConstructionInProgress,
} from "@/lib/bonds/corporateCredit";
import {
  ceoOwnershipFraction,
  insiderConcentrationPenaltyApplies,
} from "@/lib/corporations/ceoOwnership";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { isBondDefaultCreditPenaltyActive } from "@/lib/bonds/corporateBondDefault";
import { logWireEvent, wireHeadlineBond } from "@/lib/wireEvent";
import { shouldRedactCorporation } from "@/lib/corporations/redaction";
import { BOND_MATURITY_LABELS } from "@/lib/db/types/bond";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getCountryConfig } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { sumNonMaturedBondPrincipal } from "@/lib/bonds/corporateBondDefault";
import { sumBondAnnualInterestAnchor } from "@/lib/bonds/bondPrincipalSum";
import { emitTx } from "@/lib/financialTxLog/emit";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/corporations/[id]/bonds
 * List all bonds issued by this corporation, plus the corp's credit rating.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();

    const [resolved, gameState] = await Promise.all([resolveCorporation(db, id), getGameState()]);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const currentTurn = gameState?.currentTurn ?? 1;

    // Load bonds + sectors + per-turn reference data in parallel.
    // centralBanks come from the shared per-turn cache so a burst of corp-
    // detail requests in the same turn shares a single DB round-trip.
    const [bonds, sectors, refData, fxByCurrency, marketMode] = await Promise.all([
      db
        .collection<Bond>("bonds")
        .find({ corporationId: corporation._id })
        .sort({ createdAt: -1 })
        .toArray(),
      db
        .collection<CorporateSector>("corporateSectors")
        .find({ corporationId: corporation._id })
        .toArray(),
      getTurnReferenceData(db, currentTurn),
      loadFxRatesByCurrency(db),
      getMarketSystemModeForDb(db),
    ]);
    const { centralBanks } = refData;
    // This GET is the PREVIEW for the POST below (it quotes the coupon the CEO
    // is about to lock in for the bond's whole life). Both halves read the mode
    // and feed the identical basis into the credit scorer.
    const plantsEnabled = marketAtLeast(marketMode, "plants");
    const primeRateByCountry = new Map(
      centralBanks.map((bank) => [bank.countryId, bank.primeRate])
    );
    const sectorNPV = sumCorporateSectorNpv(
      sectors,
      corporation._id,
      primeRateByCountry,
      corporation,
      fxByCurrency,
      plantsEnabled
    );

    const corpFxRate = await getCorpFxRate(db, corporation);
    const liquidCapitalAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital,
      corporation,
      corpFxRate
    );

    // Compute income live from current sector state so the credit display
    // reflects the CEO's current growth/strategy settings rather than the
    // last saved turn snapshot (which can be stale and misdenominated after
    // a high-growth period that has since been cut back).
    const incomePerTurn = sumCorporateSectorPerTurnIncome(
      sectors,
      corporation._id,
      primeRateByCountry,
      corporation,
      fxByCurrency,
      plantsEnabled
    );

    const penaltyActive = isBondDefaultCreditPenaltyActive(corporation, currentTurn);

    const creditPack = computeCorporateCreditAtTurn({
      liquidCapitalAnchor,
      incomePerTurn,
      sectorNpv: sectorNPV,
      // P3a: capitalized build spend is an asset. The turn processor's credit
      // pass already adds it; without it here the displayed rating and the
      // rating the turn writes disagree for any mid-build corp.
      constructionInProgressAnchor: sumCorporateSectorConstructionInProgress(
        sectors,
        corporation._id
      ),
      bonds,
      corporationId: corporation._id,
      currentTurn,
      bondDefaultCreditPenaltyUntilTurn: corporation.bondDefaultCreditPenaltyUntilTurn,
      previousCompositeScore: corporation.creditCompositeSnapshot ?? undefined,
      fxByCurrency,
      // Insider-concentration notch. The turn processor passes these, so without
      // them the live screens (Overview / Bonds / Credit Rating tabs) showed a
      // concentrated public corp one notch above the rating the turn persisted
      // and the header + Financials tab display.
      ceoOwnershipFraction: ceoOwnershipFraction(corporation),
      isPrivate: corporation.isPrivate ?? false,
    });
    const creditRating = creditPack.creditRating;
    const totalDebt = creditPack.totalDebt;
    const totalEquity = creditPack.totalEquity;
    const annualIncome = creditPack.annualIncome;
    const annualInterest = creditPack.annualCouponObligations;

    // Get prime rate for HQ country
    const countryId = corporation.countryId;
    const centralBank = centralBanks.find((bank) => bank.countryId === countryId);
    const primeRate =
      centralBank?.primeRate ?? getCountryConfig(countryId)?.centralBank?.defaultPrimeRate ?? 0.05;
    const effectiveCouponRate = getBondCouponRate(primeRate, creditRating.rating, 96);
    const couponRatesByDuration = {
      96: effectiveCouponRate,
      240: getBondCouponRate(primeRate, creditRating.rating, 240),
      336: getBondCouponRate(primeRate, creditRating.rating, 336),
    };

    // Check if user is CEO (for issuance UI)
    let isCeo = false;
    const user = await getAuthUser();
    if (user) {
      isCeo = corporation.userId?.toString() === user.userId;
    }
    const modViewEnabled =
      !user?.isAdmin &&
      user?.isModerator === true &&
      new URL(request.url).searchParams.get("modView") === "1";

    // Fog of war: private corps redact bond amounts to non-CEO viewers.
    // Existence (count, maturity, defaulted status) stays visible so the bond
    // market can still display them; amounts and credit diagnostics are hidden.
    const redact = shouldRedactCorporation(
      corporation,
      user?.userId,
      user?.isAdmin === true,
      modViewEnabled
    );
    if (redact) {
      return NextResponse.json({
        isPrivate: true,
        bonds: bonds.map((b) => ({
          _id: b._id.toString(),
          maturityTurns: b.maturityTurns,
          maturityTurn: b.maturityTurn,
          turnsRemaining: Math.max(0, b.maturityTurn - currentTurn),
          defaulted: b.defaulted,
          matured: b.matured,
        })),
        creditRating: { rating: creditRating.rating },
        currentTurn,
      });
    }

    // Calculate cooldown remaining (private corps have a halved cooldown).
    const effectiveCooldown = corporation.isPrivate
      ? BOND_ISSUANCE_COOLDOWN_TURNS_PRIVATE
      : BOND_ISSUANCE_COOLDOWN_TURNS;
    let cooldownTurnsRemaining = 0;
    if (bonds.length > 0) {
      const latestBond = bonds[0]; // sorted by createdAt desc
      const issuedTurn = latestBond.issuedAtTurn;
      const cooldownEnd = issuedTurn + effectiveCooldown;
      cooldownTurnsRemaining = Math.max(0, cooldownEnd - currentTurn);
    }

    // Find bonds this corporation HOLDS in other companies
    const heldBonds = await db
      .collection<Bond>("bonds")
      .find({
        "holders.corporationId": corporation._id,
        corporationId: { $ne: corporation._id },
      })
      .toArray();

    // Resolve issuer names for held bonds
    const issuerIds = [...new Set(heldBonds.map((b) => b.corporationId.toString()))];
    const issuers =
      issuerIds.length > 0
        ? await db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: issuerIds.map((i) => new ObjectId(i)) } })
            .project<Pick<Corporation, "_id" | "name" | "sequentialId">>({
              _id: 1,
              name: 1,
              sequentialId: 1,
            })
            .toArray()
        : [];
    const issuerMap = new Map(issuers.map((i) => [i._id.toString(), i]));

    const holdings = heldBonds.map((b) => {
      const holding = b.holders.find(
        (h) => h.corporationId?.toString() === corporation._id.toString()
      );
      const issuer = issuerMap.get(b.corporationId.toString());
      // The bond's marketPrice/face value are denominated in the bond's own
      // currencyCode; normalize the holding value to ₳ so JPY/GBP-denominated
      // holdings aren't reported at order-of-magnitude wrong values. See the
      // Bond.currencyCode docstring for the governing convention.
      const bondCcy = (b.currencyCode ?? undefined) as CurrencyCode | undefined;
      const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
      const valueLocal = (holding?.units ?? 0) * BOND_UNIT_FACE_VALUE * b.marketPrice;
      const valueAnchor = corpCapitalToAnchor(valueLocal, bondCcy, bondRate);
      return {
        bondId: b._id.toString(),
        issuerName: issuer?.name ?? "Unknown",
        issuerSequentialId: issuer?.sequentialId,
        couponRate: b.couponRate,
        marketPrice: b.marketPrice,
        units: holding?.units ?? 0,
        faceValue: BOND_UNIT_FACE_VALUE,
        value: Math.round(valueAnchor * 100) / 100,
        turnsRemaining: Math.max(0, b.maturityTurn - currentTurn),
        defaulted: b.defaulted,
        matured: b.matured,
      };
    });

    const debtToEquityRatio = creditPack.debtToEquityRatio;
    const interestCoverageRatio = creditPack.interestCoverageRatio;

    const annualRevenueGet = sumCorporateSectorAnnualRevenue(
      sectors,
      corporation._id,
      corporation,
      fxByCurrency
    );
    const maxPerIssuance = Math.max(
      MIN_BOND_ISSUANCE_PER_ISSUE,
      annualRevenueGet * MAX_BOND_ISSUANCE_REVENUE_FRACTION
    );

    const imfBailoutActive = corporation.imfBailoutActive === true;
    const imfFacility = imfBailoutActive
      ? {
          principalOutstanding: corporation.imfFacilityPrincipalOutstanding ?? 0,
          annualRatePercent: corporation.imfFacilityAnnualRate ?? 0,
          amortizationTurnsRemaining: corporation.imfFacilityAmortizationTurnsRemaining ?? 0,
          incomeCapturePercent:
            corporation.imfFacilityIncomeCaptureFraction != null
              ? Math.round(corporation.imfFacilityIncomeCaptureFraction * 1000) / 10
              : 35,
        }
      : null;

    return NextResponse.json({
      imfFacility,
      bonds: bonds.map((b) => ({
        _id: b._id.toString(),
        faceValue: b.faceValue,
        couponRate: b.couponRate,
        maturityTurns: b.maturityTurns,
        issuedAtTurn: b.issuedAtTurn,
        maturityTurn: b.maturityTurn,
        marketPrice: b.marketPrice,
        totalIssued: b.totalIssued,
        publicFloat: b.publicFloat,
        defaulted: b.defaulted,
        matured: b.matured,
        turnsRemaining: Math.max(0, b.maturityTurn - currentTurn),
        holders: b.holders.length,
        defaultedAtTurn: b.defaultedAtTurn,
        defaultCure: b.defaultCure,
      })),
      holdings,
      creditRating: {
        ...creditRating,
        effectiveCouponRate,
        couponRatesByDuration,
        primeRate,
      },
      creditDiagnostics: {
        totalEquity,
        annualIncome,
        annualCouponObligations: annualInterest,
        debtToEquityRatio,
        interestCoverageRatio,
      },
      bondDefaultCreditPenalty: {
        active: penaltyActive,
        untilTurn: corporation.bondDefaultCreditPenaltyUntilTurn ?? null,
      },
      totalDebt,
      maxPerIssuance: Math.round(maxPerIssuance),
      isCeo,
      cooldownTurnsRemaining,
      currentTurn,
      issuanceFrozenUntil:
        BOND_ISSUANCE_FREEZE_UNTIL && Date.now() < BOND_ISSUANCE_FREEZE_UNTIL.getTime()
          ? BOND_ISSUANCE_FREEZE_UNTIL.toISOString()
          : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/corporations/[id]/bonds
 * Issue a new bond. CEO only, with 24-turn cooldown.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, issueBondSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { faceValue, maturityTurns } = parsed.data;
    const db = await getDb();

    // Issuing corporate bonds is a corporation action: blocked while an admin
    // has paused corporation actions.
    const pausedGuard = await requireCorporationActionsEnabled(db);
    if (pausedGuard) return pausedGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // CEO check
    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (corporation.imfBailoutActive) {
      return NextResponse.json(
        {
          error:
            "Cannot issue corporate bonds while an IMF restructuring program is active for this corporation",
        },
        { status: 400 }
      );
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    // Launch-window freeze: block all corporate bond issuance until the freeze
    // instant passes. Time-boxed to give the opening days an easier start; it
    // lifts itself with no deploy. See BOND_ISSUANCE_FREEZE_UNTIL.
    if (BOND_ISSUANCE_FREEZE_UNTIL && Date.now() < BOND_ISSUANCE_FREEZE_UNTIL.getTime()) {
      return NextResponse.json(
        {
          error: "Bond issuance is paused for the opening of the world and will reopen shortly.",
        },
        { status: 400 }
      );
    }

    // Check cooldown (private corps have a halved cooldown).
    const postEffectiveCooldown = corporation.isPrivate
      ? BOND_ISSUANCE_COOLDOWN_TURNS_PRIVATE
      : BOND_ISSUANCE_COOLDOWN_TURNS;
    const latestBond = await db
      .collection<Bond>("bonds")
      .findOne({ corporationId: corporation._id }, { sort: { issuedAtTurn: -1 } });
    if (latestBond) {
      const cooldownEnd = latestBond.issuedAtTurn + postEffectiveCooldown;
      if (currentTurn < cooldownEnd) {
        return NextResponse.json(
          {
            error: `Bond issuance on cooldown. ${cooldownEnd - currentTurn} turns remaining.`,
          },
          { status: 400 }
        );
      }
    }

    // Validate issuance amount
    if (faceValue < MIN_BOND_ISSUANCE) {
      return NextResponse.json(
        { error: `Minimum issuance is ₳${MIN_BOND_ISSUANCE.toLocaleString()}` },
        { status: 400 }
      );
    }

    // Calculate existing debt (includes defaulted bonds — they still count toward
    // leverage). All inputs to `calculateCreditScore` normalized to ₳ so the
    // debt/equity and interest-coverage sub-scores compare coherent units. Pre-fix
    // this route passed LOCAL bond sums alongside ₳ liquidCapitalAnchor, producing
    // wildly inflated credit-score drift on new non-USD bond issuances and
    // setting the wrong coupon rate for the bond's entire lifetime.
    const [existingBonds, sectors, refData, fxByCurrency, postMarketMode] = await Promise.all([
      db
        .collection<Bond>("bonds")
        .find({ corporationId: corporation._id, matured: false })
        .toArray(),
      db
        .collection<CorporateSector>("corporateSectors")
        .find({ corporationId: corporation._id })
        .toArray(),
      getTurnReferenceData(db, currentTurn),
      loadFxRatesByCurrency(db),
      getMarketSystemModeForDb(db),
    ]);
    const { centralBanks } = refData;
    // Same mode + same basis the GET preview quoted — the equity headroom the
    // CEO was shown is the equity headroom enforced here.
    const postPlantsEnabled = marketAtLeast(postMarketMode, "plants");
    const primeRateByCountry = new Map(
      centralBanks.map((bank) => [bank.countryId, bank.primeRate])
    );
    const sectorNPV = sumCorporateSectorNpv(
      sectors,
      corporation._id,
      primeRateByCountry,
      corporation,
      fxByCurrency,
      postPlantsEnabled
    );
    const postCorpFxRate = await getCorpFxRate(db, corporation);
    const postLiquidCapitalAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital,
      corporation,
      postCorpFxRate
    );
    const existingDebt = sumNonMaturedBondPrincipal(existingBonds, fxByCurrency);
    // Mirrors `computeCorporateCreditAtTurn`'s equity identity (liquid + NPV +
    // CIP) that the GET preview reports. Pre-fix this line dropped the CIP leg,
    // so a mid-build corp was quoted a debt ceiling it could not actually use.
    const totalEquity =
      postLiquidCapitalAnchor +
      sectorNPV +
      sumCorporateSectorConstructionInProgress(sectors, corporation._id);

    // Per-issuance cap: 25% of annual revenue, floored at $100M
    const annualRevenuePost = sumCorporateSectorAnnualRevenue(
      sectors,
      corporation._id,
      corporation,
      fxByCurrency
    );
    const maxPerIssuancePost = Math.max(
      MIN_BOND_ISSUANCE_PER_ISSUE,
      annualRevenuePost * MAX_BOND_ISSUANCE_REVENUE_FRACTION
    );
    if (faceValue > maxPerIssuancePost) {
      return NextResponse.json(
        {
          error: `Issuance of ₳${faceValue.toLocaleString()} exceeds per-issuance cap of ₳${Math.round(maxPerIssuancePost).toLocaleString()} (25% of annual revenue, floor ₳${MIN_BOND_ISSUANCE_PER_ISSUE.toLocaleString()})`,
        },
        { status: 400 }
      );
    }

    // Max debt: 2x equity (all ₳)
    if (existingDebt + faceValue > totalEquity * MAX_BOND_ISSUANCE_FRACTION) {
      return NextResponse.json(
        {
          error: `Total debt would exceed ${MAX_BOND_ISSUANCE_FRACTION}x equity. Current debt: ₳${existingDebt.toLocaleString()}, equity: ₳${Math.round(totalEquity).toLocaleString()}`,
        },
        { status: 400 }
      );
    }

    // Calculate credit rating and coupon rate using live sector income (₳)
    // so issuance terms reflect current settings, not a potentially stale
    // or misdenominated history snapshot.
    const issueIncomePerTurn = sumCorporateSectorPerTurnIncome(
      sectors,
      corporation._id,
      primeRateByCountry,
      corporation,
      fxByCurrency,
      postPlantsEnabled
    );
    const annualIncome = issueIncomePerTurn * TURNS_PER_YEAR;
    const annualInterest = sumBondAnnualInterestAnchor(existingBonds, fxByCurrency);

    const penaltyActive = isBondDefaultCreditPenaltyActive(corporation, currentTurn);

    // Same option set as the GET preview above and the turn processor's credit
    // pass. Dropping the smoothing prior or the concentration notch here quoted
    // the CEO a coupon the preview never showed them.
    const creditResult = calculateCreditScore(
      postLiquidCapitalAnchor,
      existingDebt + faceValue,
      annualIncome,
      annualInterest,
      totalEquity,
      {
        bondDefaultCreditPenaltyActive: penaltyActive,
        previousCompositeScore: corporation.creditCompositeSnapshot ?? undefined,
        insiderConcentrationPenalty: insiderConcentrationPenaltyApplies(corporation),
      }
    );

    const countryId = corporation.countryId;
    const centralBank = centralBanks.find((bank) => bank.countryId === countryId);
    const primeRate =
      centralBank?.primeRate ?? getCountryConfig(countryId)?.centralBank?.defaultPrimeRate ?? 0.05;
    const couponRate = getBondCouponRate(
      primeRate,
      creditResult.rating,
      maturityTurns as BondMaturityTurns
    );

    const now = new Date();
    // `faceValue` from the request is in ₳ by convention. The stored bond's
    // `totalIssued` must be LOCAL to match its `currencyCode` tag.
    const corpCurrencyCode = resolveCorpLiquidCurrencyCode(corporation);
    const faceValueLocal = anchorToCorpCapital(faceValue, corpCurrencyCode, postCorpFxRate);
    const totalUnits = Math.floor(faceValueLocal / BOND_UNIT_FACE_VALUE);
    const actualFaceValueLocal = totalUnits * BOND_UNIT_FACE_VALUE;
    // ₳ mirror for wire + response payload (matches request's faceValue units).
    const actualFaceValueAnchor = corpLiquidCapitalToAnchor(
      actualFaceValueLocal,
      corporation,
      postCorpFxRate
    );

    const bondDoc: Omit<Bond, "_id"> = {
      corporationId: corporation._id,
      faceValue: BOND_UNIT_FACE_VALUE,
      couponRate,
      maturityTurns: maturityTurns as BondMaturityTurns,
      issuedAtTurn: currentTurn,
      maturityTurn: currentTurn + maturityTurns,
      marketPrice: 1.0, // Issued at par
      totalIssued: actualFaceValueLocal,
      publicFloat: totalUnits, // All units available for purchase initially
      holders: [],
      defaulted: false,
      defaultedAtTurn: null,
      matured: false,
      // Corporate bonds denominate in the issuing corp's home currency.
      currencyCode: corpCurrencyCode,
      restructureHaircutPercent: null,
      restructureExtendedMaturityTurn: null,
      originalMaturityTurn: null,
      originalTotalIssued: null,
      createdAt: now,
      updatedAt: now,
    };

    // Proceeds go to liquidCapital which is itself LOCAL — direct $inc.
    const faceValueInCorpCapital = actualFaceValueLocal;

    const insertResult = await db.collection("bonds").insertOne(bondDoc);
    // Serialize the treasury credit against other same-corp money ops (e.g. a
    // hostile takeover firing on this corp in the same instant) so the two
    // writes can't interleave and drop one (issue #2949).
    await withCorpLock(corporation._id, () =>
      db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: corporation._id },
          { $inc: { liquidCapital: faceValueInCorpCapital }, $set: { updatedAt: now } }
        )
    );
    const insertedBondId = insertResult.insertedId;

    void emitTx(db, {
      type: "bond_issuance",
      turn: currentTurn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: corporation._id,
      subjectName: corporation.name,
      amount: faceValueInCorpCapital,
      currencyCode: (corpCurrencyCode ?? "USD") as CurrencyCode,
      meta: { bondId: insertedBondId.toString(), units: totalUnits, couponRate, maturityTurns },
    });

    const matLabel =
      BOND_MATURITY_LABELS[maturityTurns as BondMaturityTurns] ?? `${maturityTurns}T`;
    logWireEvent(
      "bond_issued",
      wireHeadlineBond(corporation.name, actualFaceValueAnchor, matLabel, couponRate.toFixed(1)),
      { href: `/corporation/${corporation.sequentialId ?? corporation._id}` }
    );

    return NextResponse.json({
      success: true,
      bondId: insertedBondId.toString(),
      faceValue: actualFaceValueAnchor,
      couponRate,
      maturityTurns,
      maturityTurn: currentTurn + maturityTurns,
      creditRating: creditResult.rating,
      units: totalUnits,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
