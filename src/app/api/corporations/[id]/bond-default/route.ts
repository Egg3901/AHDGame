import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { Bond, CentralBank, CorporateSector } from "@/lib/db/types";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import {
  allocateShareholderPool,
  buildPrimeRateMap,
  canRefinanceDefaultedDebt,
  computeSectorNpvSum,
  isBondDefaultCreditPenaltyActive,
  previewDissolveSettlement,
  previewRefinanceIssuance,
  sumDefaultedBondPrincipal,
  sumNonMaturedBondPrincipal,
  totalEquityForBonds,
} from "@/lib/bonds/corporateBondDefault";
import { previewRestructure } from "@/lib/bonds/restructure";
import { sectorExitValueByIdAnchor } from "@/lib/bonds/sectorExitBasis";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { sumSectorBookValueAnchor } from "@/lib/corporations/sectorProfitBasis";
import { sumCorporateSectorConstructionInProgress } from "@/lib/bonds/corporateCredit";
import { MAX_BOND_DEFAULT_REFINANCES } from "@/lib/constants/bonds";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getCountryConfig } from "@/lib/constants/countries";
import {
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import type { Character } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/corporations/[id]/bond-default
 * CEO-only. Crisis panel data when the corporation has defaulted bonds.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (corporation.countryOwnerId) {
      return NextResponse.json(
        { error: "National corporations cannot use bond default resolution here" },
        { status: 400 }
      );
    }

    const bonds = await db
      .collection<Bond>("bonds")
      .find({ corporationId: corporation._id, matured: false })
      .toArray();

    const hasDefaulted = bonds.some((b) => b.defaulted);
    if (!hasDefaulted) {
      return NextResponse.json({ active: false });
    }

    const [sectors, centralBanks, gameState, latestHistory, marketMode] = await Promise.all([
      db
        .collection<CorporateSector>("corporateSectors")
        .find({ corporationId: corporation._id })
        .toArray(),
      db.collection<CentralBank>("centralBanks").find({}).toArray(),
      getGameState(),
      db
        .collection("corporationHistory")
        .findOne({ corporationId: corporation._id }, { sort: { turn: -1 } }),
      getMarketSystemModeForDb(db),
    ]);

    const currentTurn = gameState?.currentTurn ?? 1;
    // D11 — this panel PREVIEWS three executors (cash / refinance / dissolve /
    // restructure). Every basis below must be computed with the same mode the
    // executor reads, or the CEO picks an option against a number the executor
    // will not honour. See `sectorExitBasis.ts`.
    const plantsEnabled = marketAtLeast(marketMode, "plants");
    const currentYear = gameState?.currentYear;
    const annualIncome = (latestHistory?.income ?? 0) * TURNS_PER_YEAR;
    const primeMap = buildPrimeRateMap(centralBanks);
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const sectorNpv = computeSectorNpvSum(sectors, primeMap, corporation, fxByCurrency, {
      plantsEnabled,
    });
    const corpFxRate = await getCorpFxRate(db, corporation);
    const liquidCapitalAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital,
      corporation,
      corpFxRate
    );
    // P3a: capitalized build spend is an asset on the equity leg — the same
    // term `executeCorporationBondRefinance` adds, so the refinance capacity
    // shown here equals the capacity the refinance route will actually grant.
    const cipAnchor = sumCorporateSectorConstructionInProgress(sectors, corporation._id);
    const totalEquity = totalEquityForBonds(liquidCapitalAnchor, sectorNpv, cipAnchor);
    const defaultedPrincipal = sumDefaultedBondPrincipal(bonds, fxByCurrency);
    const existingDebtAll = sumNonMaturedBondPrincipal(bonds, fxByCurrency);

    // The dissolve path settles the share-buyback escrow into the payout pool
    // (see executeCorporationBondDefaultDissolution), so the dissolve PREVIEW must
    // net escrow into its cash base too. Cash-pay and refinance keep the
    // escrow-exclusive `liquidCapitalAnchor` above: escrow is a ring-fenced
    // market-making reserve, and their execution routes debit liquidCapital only.
    const dissolveLiquidCapitalAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital + (corporation.shareEscrowBalance ?? 0),
      corporation,
      corpFxRate
    );
    // D11 — the dissolve EXECUTOR (`executeCorporationBondDefaultDissolution`)
    // settles at Σ book under plants. Quote the identical basis here: pre-fix
    // this preview passed only `sectorNpv`, so the panel advertised
    // salvageFraction × NPV while the button paid salvageFraction × book.
    const sectorBookAnchor = plantsEnabled
      ? sumSectorBookValueAnchor(sectors, currentYear, await loadWorldEraUnitScale(db))
      : undefined;
    const dissolvePreview = previewDissolveSettlement(
      corporation,
      sectorNpv,
      bonds,
      dissolveLiquidCapitalAnchor,
      fxByCurrency,
      { plantsEnabled, sectorBookAnchor }
    );
    const regularShareholderIds = (corporation.shareholders ?? [])
      .map((s) => s.characterId)
      .filter((id): id is ObjectId => id !== undefined);
    const imperialShareholderIds = (corporation.shareholders ?? [])
      .map((s) => s.imperialCharacterId)
      .filter((id): id is ObjectId => id !== undefined);
    const corpShareholderIds = (corporation.shareholders ?? [])
      .map((s) => s.corporationId)
      .filter((id): id is ObjectId => id !== undefined);
    const [shareholderChars, imperialShareholderChars, corpShareholderDocs] = await Promise.all([
      regularShareholderIds.length > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: regularShareholderIds } }, { projection: { _id: 1, name: 1 } })
            .toArray()
        : [],
      imperialShareholderIds.length > 0
        ? db
            .collection<ImperialCharacter>("imperialCharacters")
            .find({ _id: { $in: imperialShareholderIds } }, { projection: { _id: 1, name: 1 } })
            .toArray()
        : [],
      corpShareholderIds.length > 0
        ? db
            .collection("corporations")
            .find({ _id: { $in: corpShareholderIds } }, { projection: { _id: 1, name: 1 } })
            .toArray()
        : [],
    ]);
    const nameById = new Map<string, string>([
      ...shareholderChars.map((c) => [c._id.toString(), c.name] as const),
      ...imperialShareholderChars.map((c) => [c._id.toString(), c.name] as const),
      ...corpShareholderDocs.map((c) => [c._id.toString(), c.name as string] as const),
    ]);
    const allocation = allocateShareholderPool(
      corporation,
      dissolvePreview.shareholderPool,
      nameById
    );

    const cashCost = defaultedPrincipal;
    // Cash-pay is a bond repayment, so it may draw on a POSITIVE buyback escrow
    // when liquidCapital is short (mirrors the cash route's split debit). Refinance
    // capacity (totalEquity) stays escrow-exclusive — issuing new debt isn't a repayment.
    const escrowPositiveAnchor = corpLiquidCapitalToAnchor(
      Math.max(0, corporation.shareEscrowBalance ?? 0),
      corporation,
      corpFxRate
    );
    const canCashPay = liquidCapitalAnchor + escrowPositiveAnchor >= cashCost;

    const refi = canRefinanceDefaultedDebt({
      equity: totalEquity,
      existingDebtAllNonMatured: existingDebtAll,
      defaultedPrincipal,
    });

    const penaltyActive = isBondDefaultCreditPenaltyActive(corporation, currentTurn);

    const countryId = corporation.countryId;
    const centralBank = centralBanks.find((bank) => bank.countryId === countryId);
    const primeRate =
      centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;

    const refiPreview =
      refi.requiredFace > 0
        ? previewRefinanceIssuance({
            corporation,
            liquidCapitalAnchor,
            allNonMaturedBonds: bonds,
            actualFaceAnchor: refi.requiredFace,
            sectorNpv,
            annualIncome,
            primeRate,
            currentTurn,
            fxByCurrency,
          })
        : null;

    const imfBlocked = corporation.imfBailoutActive === true;

    // Restructure preview: can we liquidate the minimum sectors needed to repay
    // defaulted bondholders in full while keeping the corp alive?
    // Same helper the restructure EXECUTOR calls, with the same mode — the two
    // must rank and select the same sectors or "sectorsToLiquidate: 2" here
    // becomes three sectors sold there.
    const sectorNpvByIdAnchor = sectorExitValueByIdAnchor(
      sectors,
      primeMap,
      corporation,
      fxByCurrency,
      { plantsEnabled, currentYear, eraUnitScale: await loadWorldEraUnitScale(db) }
    );
    const restructurePreview = previewRestructure({
      defaultedPrincipalAnchor: defaultedPrincipal,
      liquidCapitalAnchor,
      sectorNpvByIdAnchor,
    });

    return NextResponse.json({
      active: true,
      currentTurn,
      // Return anchor-denominated liquidCapital so the client can use formatAmount()
      // directly — matches the other monetary fields in this payload (sectorNpv,
      // totalEquity, defaultedPrincipal, cashCost, dissolve.preview.*). Previously
      // returned the raw native value, which displayed wrong for non-USD corps.
      liquidCapital: liquidCapitalAnchor,
      sectorNpv,
      totalEquity,
      defaultedPrincipal,
      creditPenalty: {
        active: penaltyActive,
        untilTurn: corporation.bondDefaultCreditPenaltyUntilTurn ?? null,
      },
      cash: {
        canPay: canCashPay,
        cost: cashCost,
      },
      refinance: {
        canRefinance:
          !imfBlocked &&
          refi.ok &&
          (corporation.bondDefaultRefinanceCount ?? 0) < MAX_BOND_DEFAULT_REFINANCES,
        imfRestructuring: imfBlocked,
        requiredFace: refi.requiredFace,
        maxAllowedFace: refi.maxAllowedFace,
        primeRate,
        creditRating: refiPreview
          ? {
              rating: refiPreview.creditRating.rating,
              compositeScore: refiPreview.creditRating.compositeScore,
            }
          : null,
        couponRate: refiPreview?.couponRate ?? null,
        refinanceCount: corporation.bondDefaultRefinanceCount ?? 0,
        maxRefinances: MAX_BOND_DEFAULT_REFINANCES,
      },
      dissolve: {
        preview: dissolvePreview,
        shareholders: allocation.characterRows,
        corporateShareholders: allocation.corporationRows,
        publicFloat: allocation.publicFloatRow,
      },
      restructure: {
        feasible: restructurePreview.feasible,
        // Defaulted principal repaid in full when restructuring (holders made whole).
        cost: restructurePreview.defaultedPrincipal,
        sectorsToLiquidate: restructurePreview.sectorsToLiquidate.length,
        totalSectors: sectors.length,
        proceeds: restructurePreview.proceeds,
        needFromSectors: restructurePreview.needFromSectors,
        totalSalvageAvailable: restructurePreview.totalSalvageAvailable,
        residualLiquidCapital: restructurePreview.residualLiquidCapital,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
