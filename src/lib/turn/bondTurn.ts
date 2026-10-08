/**
 * Bond turns settle coupons and principal while preserving holder denominations.
 * processBondTurn shares one monetary quote snapshot across payout conversions.
 */
import { substepMarker } from "@/lib/observability/phaseSubsteps";
import { euroSettlementRates } from "@/lib/currency/euro/rules";
import { purchaseSpreadRate } from "@/lib/currency/rules/purchaseConversion";
import { loadConversionQuoteContext } from "@/lib/currency/euro/quotes";
import { roundedAggregateCredit } from "@/lib/bonds/rules/roundedAggregateCredit";
import { readForcedRolloverFaceLocal } from "@/lib/bonds/forcedSovereignRollover";
import { getDb } from "@/lib/mongodb";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import type {
  Bond,
  Corporation,
  CentralBank,
  Character,
  FederalBudget,
  GameConfig,
} from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  BOND_DEFAULT_CREDIT_PENALTY_TURNS,
  CORP_BOND_DUE_SOON_REMINDER_TURNS,
  calculateBondMarketPrice,
  calculateCreditScore,
  bondAccruesCoupon,
  getBondCouponRate,
  perTurnCouponPayment,
} from "@/lib/constants/bonds";
import {
  getNationalBudgetId,
  getBondCountryId,
  isCorporateBond,
  issueScheduledSovereignBondSeries,
  freezeFundedSovereignBondMaturityQuote,
  settleFundedSovereignBondMaturity,
  settleSovereignBondMaturity,
} from "@/lib/bonds/sovereign";
import {
  addBankMaturityClaims,
  settleBankSovereignClaims,
} from "@/lib/banking/bankSovereignClaims";
import {
  buildPersonalBalanceBulkOp,
  buildPersonalBalanceInc,
  getHomeCurrency,
} from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getGameState } from "@/lib/gameState";
import {
  executeMarketMakerTrade,
  distributeConversionSpreadsBatch,
} from "@/lib/currency/marketMaker";
import { corporateBondMaturityLiquidity } from "@/lib/bonds/corporateCredit";
import { garnishLocFromIncome } from "@/lib/lineOfCredit/garnishment";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { fireBondDefaultPulse } from "@/lib/corporations/sentimentEvents";
import { processSovereignImfFacilityPayments } from "@/lib/sovereignDefault/imfSovereignFacilityTurn";
import { processSovereignRecoveryTurn } from "@/lib/sovereignDefault/recovery/recoveryTurn";
import { processSovereignLegislativeTurn } from "@/lib/sovereignDefault/legislative/legislativeTurn";
import { processCrisisAutoActions } from "@/lib/sovereignDefault/crisisAutoAction";
import {
  coverBondShortfallsFromEscrow,
  filterInsolventCorps,
  resolveBondCurrency,
  rollbackDefaultedIssuerMaturityFlows,
  type BondMaturityFlow,
} from "./bondTurnHelpers";
import { emitBondTurnLedger, snapshotBondHistory, type PartialTxEntry } from "./bondTurnLedger";
import { autoResolveLingeringDefaults } from "./bondTurnAutoResolve";
import { applyQePriceSupport } from "@/lib/moneySupply/quantitativeEasing";
import { loadBondPoolLedgerContext, withBondPoolLedgerBatch } from "@/lib/bonds/marketPoolLedger";
import { bondPoolCurrency, creditBondPool } from "@/lib/bonds/marketPool";
import { processBondMarketPoolTurn } from "@/lib/bonds/marketPoolTurn";
import { placeUnsoldBondUnits, settlePlacementProceeds } from "@/lib/bonds/primaryMarket";
import { sovereignIssuanceFlowsByCountry } from "@/lib/resetFinance/rules/sovereignProceeds";
import { sovereignBondOutstanding } from "@/lib/bonds/sovereignPrincipal";
import { payNppBondReturns, type NppBondReturns } from "./nppBondCash";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import { resumeSettlement } from "@/lib/banking/settlementJournal";
import { KeyedQueue, interleaveByKey, runInLanes } from "@/lib/turn/settlementLanes";

/** Concurrent sovereign maturity settlements; one Treasury still runs one at a time. */
const SOVEREIGN_MATURITY_LANES = 8;

export interface BondTurnResult {
  bondsProcessed: number;
  couponsPaid: number;
  bondsMatured: number;
  bondsDefaulted: number;
  totalCouponsPaid: number;
  bondHistorySnapshots: number;
  /** Bonds cured this turn by forced auto-restructuring (sector sale) of lingering defaults. */
  bondsAutoRestructured: number;
  /** Bonds cured this turn by auto-refinance (replacement bond, no sale) of lingering defaults. */
  bondsAutoRefinanced: number;
  /** Actual at-par issuance plus later placements, for the v2 cash shell. */
  sovereignCashProceedsByCountry?: Record<string, number>;
  /** New debt face, which can differ from actual placement consideration. */
  sovereignDebtFaceIssuedByCountry?: Record<string, number>;
  /** Actual sovereign coupon and maturity obligations already paid by this bond phase. */
  sovereignCouponPaidByCountry?: Record<string, number>;
  sovereignMaturityCashPaidByCountry?: Record<string, number>;
  sovereignDebtFaceRetiredByCountry?: Record<string, number>;
}

/**
 * Process all active bonds each turn:
 * 1. Pay coupon interest to bond holders (per-turn fraction of annual coupon)
 * 2. Update market prices based on current interest rates and time to maturity
 * 3. Check for defaults (corporation liquidCapital < 0 after coupon payments)
 * 4. Settle matured bonds (return face value to holders)
 */
export async function processBondTurn(
  turn: number,
  config?: Pick<GameConfig, "treasuryCashLedgerEnabled"> & {
    captureSovereignCashProceeds?: boolean;
  }
): Promise<BondTurnResult> {
  const db = await getDb();
  const steps = substepMarker();
  const now = new Date();
  const forexEnabled = await isForexEnabled();
  // #1198: gates default DETECTION only, in Phase 3. Coupon and maturity
  // settlement runs regardless — see the comment there for why the two are
  // treated differently.
  const gameState = await getGameState(db);
  const corporationActionsPaused = gameState?.corporationActionsPaused === true;
  const captureSovereignCashProceeds = config?.captureSovereignCashProceeds === true;

  await db
    .collection("corporations")
    .updateMany(
      { bondDefaultCreditPenaltyUntilTurn: { $lte: turn } },
      { $unset: { bondDefaultCreditPenaltyUntilTurn: "" }, $set: { updatedAt: now } }
    );

  await issueScheduledSovereignBondSeries(db, turn, now);
  steps.mark("sovereignIssuance");
  // Snapshot new at-par issuance before the placement sweep can add cash to
  // those same bonds. Reconcile tranches convert existing debt, not proceeds.
  const atParIssues: { countryId: string; face: number }[] = [];
  if (captureSovereignCashProceeds) {
    const issued = await db
      .collection<Bond>("bonds")
      .find(
        {
          issuerType: "sovereign",
          issuedAtTurn: turn,
          reconcile: { $ne: true },
        },
        { projection: { countryId: 1, totalIssued: 1 } }
      )
      .toArray();
    for (const bond of issued) {
      if (!bond.countryId || !Number.isSafeInteger(bond.totalIssued) || bond.totalIssued < 0) {
        throw new Error("Sovereign cash capture found an invalid at-par issue");
      }
      atParIssues.push({ countryId: bond.countryId, face: bond.totalIssued });
    }
  }
  // Size each currency's bond market pool, let savings flow toward its target,
  // and refresh its appetite for each sovereign issuer before anyone trades.
  const poolLedgerContext = await loadBondPoolLedgerContext(db, turn);
  // Funded Treasury cash needs a currency valuation even when shadow-ledger
  // publication is off. Keep this additional read strictly behind its flag.
  const treasuryCashRates =
    config?.treasuryCashLedgerEnabled === true && !poolLedgerContext
      ? new Map(
          (
            await db
              .collection<{ currencyCode: string; rate: number }>("exchangeRates")
              .find({}, { projection: { currencyCode: 1, rate: 1 } })
              .toArray()
          ).map((rate) => [rate.currencyCode, rate.rate])
        )
      : null;
  const authoritativeRates = poolLedgerContext?.rates ?? treasuryCashRates;
  await processBondMarketPoolTurn(db, turn, now, poolLedgerContext);
  steps.mark("marketPools");
  await processSovereignImfFacilityPayments(db, turn);
  steps.mark("imfPayments");
  await processSovereignRecoveryTurn(db, turn);
  steps.mark("sovereignRecovery");
  // Auto-repudiate countries whose executive decision window has expired
  // (crisisAutoActionAt <= now AND sovereignCrisisState === "crisisPending").
  // Must run before legislativeTurn so countries resolved here are not double-processed.
  await processCrisisAutoActions(db, Date.now(), turn);
  steps.mark("crisisAutoActions");
  await processSovereignLegislativeTurn(db, Date.now(), turn);
  steps.mark("sovereignLegislative");

  const activeBonds = await db.collection<Bond>("bonds").find({ matured: false }).toArray();

  // Fund the exact holder snapshot this bond turn will pay. A funding failure
  // stops this payout phase before any creditor credits can escape its journal.
  // Recovery of an earlier bridge continues even after the last bond matures.
  if (gameState?.preset === "1991-default") {
    const { processLegacyFederationServiceTurn } =
      await import("@/lib/world/succession/legacyServiceTurn");
    await processLegacyFederationServiceTurn(db, turn, now, activeBonds);
    const { processContinuingFederationServiceTurn } =
      await import("@/lib/world/succession/continuingServiceTurn");
    await processContinuingFederationServiceTurn(db, turn, now, activeBonds);
  }

  if (activeBonds.length === 0) {
    const flows = captureSovereignCashProceeds
      ? sovereignIssuanceFlowsByCountry({ atParIssues, placements: [] })
      : null;
    return {
      bondsProcessed: 0,
      couponsPaid: 0,
      bondsMatured: 0,
      bondsDefaulted: 0,
      totalCouponsPaid: 0,
      bondHistorySnapshots: 0,
      bondsAutoRestructured: 0,
      bondsAutoRefinanced: 0,
      ...(flows
        ? {
            sovereignCashProceedsByCountry: Object.fromEntries(
              Object.entries(flows).map(([countryId, flow]) => [countryId, flow.cash])
            ),
            sovereignDebtFaceIssuedByCountry: Object.fromEntries(
              Object.entries(flows).map(([countryId, flow]) => [countryId, flow.face])
            ),
            sovereignCouponPaidByCountry: {},
            sovereignMaturityCashPaidByCountry: {},
            sovereignDebtFaceRetiredByCountry: {},
          }
        : {}),
    };
  }

  // Get all issuing corporations
  const corporateBonds = activeBonds.filter(isCorporateBond);
  const corpIds = [...new Set(corporateBonds.map((bond) => bond.corporationId.toString()))];
  // Holder corps may differ from issuer corps — include any corp that receives
  // coupon or maturity cash this turn so we can convert to each's home currency.
  const holderCorpIds = new Set<string>();
  for (const bond of activeBonds) {
    for (const h of bond.holders)
      if (h.corporationId) holderCorpIds.add(h.corporationId.toString());
  }
  const allCorpIds = new Set([...corpIds, ...holderCorpIds]);
  const corporations =
    allCorpIds.size === 0
      ? []
      : await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: [...allCorpIds].map((id) => new ObjectId(id)) } })
          .toArray();
  const corpMap = new Map(corporations.map((c) => [c._id.toString(), c]));
  // Natcorp set is consulted in every later phase (coupon-cost skip, default
  // detection, issuer-coupon ledger row); compute once up-front so Phase 1
  // can also gate the new issuer-side bond_coupon emission on it.
  const natcorpIds = new Set(
    corporations.filter((c) => !!c.countryOwnerId).map((c) => c._id.toString())
  );

  // FX rates for converting ₳-denominated coupon/face values into each corp's
  // liquidCapital home currency before $inc. Loaded once per turn.
  const quoteContext = forexEnabled
    ? await loadConversionQuoteContext(db, gameState?.euroMonetaryUnion)
    : undefined;
  const fxByCurrency = quoteContext
    ? euroSettlementRates(
        quoteContext.union,
        Object.fromEntries(
          [...quoteContext.quotes].map(([currency, quote]) => [currency, quote.rate])
        )
      )
    : await loadFxRatesByCurrency(db);
  if (quoteContext?.union && !fxByCurrency.has(quoteContext.union.anchorCurrency)) {
    throw new Error("Bond settlement requires the common monetary anchor quote.");
  }
  // USD remains the shared accounting anchor when no explicit quote is stored.
  if (!fxByCurrency.has("USD")) fxByCurrency.set("USD", 1);
  const spreadStrengths = Object.fromEntries(
    [...(quoteContext?.quotes ?? [])].map(([currency, quote]) => [
      currency,
      quote.forexSpreadStrength,
    ])
  );

  // Primary market: place unsold units from earlier issues as the pools'
  // cash allows, and fund the issuers for them. Runs after this turn's
  // active-bond snapshot, so newly placed units start earning next turn.
  const placement = await placeUnsoldBondUnits(db, turn, now);
  steps.mark("loadAndPlacement");
  if (placement.unitsPlaced > 0) {
    await settlePlacementProceeds(db, placement, fxByCurrency, now);
  }

  // Get central bank rates for price calculations
  const centralBanks = await db
    .collection<CentralBank>("centralBanks")
    .find({})
    .project<Pick<CentralBank, "_id" | "countryId" | "primeRate">>({ countryId: 1, primeRate: 1 })
    .toArray();
  const cbByCountry = new Map(centralBanks.map((cb) => [cb.countryId, cb]));

  // Track payments — currency-aware for forex support.
  // `amountAnchor` is ₳ (bond face × units for maturity, or perTurnCouponPayment × units for
  // coupons — both in anchor units). Character / imperial balances live in
  // currencyBalances.personal.<code> per-currency post-forex, so convert via the bond's
  // own denomination FX rate before tagging (Task-18B: `bond.currencyCode` is canonical).
  const charPayments = new Map<string, Map<CurrencyCode, number>>();
  function addCharPayment(charIdStr: string, amountAnchor: number, bondCurrency: CurrencyCode) {
    const fxRate = fxByCurrency.get(bondCurrency);
    const localAmount =
      Number.isFinite(fxRate) && fxRate && fxRate > 0 ? amountAnchor * fxRate : amountAnchor;
    if (!charPayments.has(charIdStr)) {
      charPayments.set(charIdStr, new Map());
    }
    const currMap = charPayments.get(charIdStr)!;
    currMap.set(bondCurrency, (currMap.get(bondCurrency) ?? 0) + localAmount);
  }
  const imperialPayments = new Map<string, Map<CurrencyCode, number>>();
  function addImperialPayment(
    imperialIdStr: string,
    amountAnchor: number,
    bondCurrency: CurrencyCode
  ) {
    const fxRate = fxByCurrency.get(bondCurrency);
    const localAmount =
      Number.isFinite(fxRate) && fxRate && fxRate > 0 ? amountAnchor * fxRate : amountAnchor;
    if (!imperialPayments.has(imperialIdStr)) {
      imperialPayments.set(imperialIdStr, new Map());
    }
    const currMap = imperialPayments.get(imperialIdStr)!;
    currMap.set(bondCurrency, (currMap.get(bondCurrency) ?? 0) + localAmount);
  }
  const fundPaymentsAnchor = new Map<string, number>(); // fundId -> coupon/maturity (₳)
  function addFundPayment(fundIdStr: string, paymentAnchor: number): number {
    if (paymentAnchor <= 0) return 0;
    const previous = fundPaymentsAnchor.get(fundIdStr) ?? 0;
    fundPaymentsAnchor.set(fundIdStr, previous + paymentAnchor);
    return roundedAggregateCredit(previous, paymentAnchor);
  }
  // v3 autonomous NPP bondholders: coupon/maturity are INVESTMENT returns, so
  // they accumulate in ₳ (anchor) and credit the personal forex account
  // (`nppInvestmentCashAnchor`) — NOT the campaign war chest. No LoC garnish /
  // national accounting (mirrors the NPP investment-account isolation).
  const nppPaymentsAnchor = new Map<string, number>(); // nppId -> coupon/maturity (₳)
  const nppReturnKinds = new Map<string, NppBondReturns>();
  function addNppPayment(
    nppIdStr: string,
    amountAnchor: number,
    _bondCurrency: CurrencyCode,
    kind: "coupon" | "maturity"
  ) {
    if (amountAnchor <= 0) return;
    nppPaymentsAnchor.set(nppIdStr, (nppPaymentsAnchor.get(nppIdStr) ?? 0) + amountAnchor);
    const returns = nppReturnKinds.get(nppIdStr) ?? { total: 0, coupon: 0, maturity: 0 };
    returns.total = nppPaymentsAnchor.get(nppIdStr)!;
    returns[kind] += amountAnchor;
    nppReturnKinds.set(nppIdStr, returns);
  }
  const corpPayments = new Map<string, number>(); // corporationId (holder) -> coupon amount (₳)
  const corpCouponCosts = new Map<string, number>(); // corporationId (issuer) -> total coupon cost (₳)
  // Maturity face-value flows pre-computed in Phase 1.5 so they enter the
  // unified pre-default delta (Phase 2) instead of the post-default Phase 5.
  // Tracked per-bond as well so a newly-defaulted issuer's maturity flows can
  // be rolled back (Phase 3.5) — the bond becomes defaulted, not matured, and
  // holders never actually receive face value.
  const corpMaturityIncome = new Map<string, number>(); // holder corp -> face value (₳)
  const corpMaturityCost = new Map<string, number>(); // issuer corp -> face value (₳)
  const bondMaturityFlows: BondMaturityFlow[] = [];
  // Read-only due classification is separate from bond.matured/receipt state.
  // It preserves the pre-default ordering while funded payout is retried under
  // one due-turn receipt and the bond stays active until every holder is paid.
  const sovereignMaturityCandidateIds = new Set(
    activeBonds
      .filter(
        (bond) =>
          !isCorporateBond(bond) &&
          bond.issuerType === "sovereign" &&
          !bond.defaulted &&
          turn >= bond.maturityTurn
      )
      .map((bond) => bond._id.toHexString())
  );
  const bondOps: {
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }[] = [];
  const maturedBonds: Bond[] = [];
  const defaultedCorps = new Set<string>();
  // Collected to insertMany once after all phases — avoids N concurrent
  // insertOne fan-out per matured/due-soon bond.
  const notifications: NotificationInput[] = [];

  // Tx log entry accumulators (resolved to names + emitted after all phases;
  // see PartialTxEntry in ./bondTurnLedger for the charId/isImperial shape).
  const txBondEntries: PartialTxEntry[] = [];
  const govCouponByCountry = new Map<string, { total: number; currency: CurrencyCode }>();
  const sovereignMaturityCashPaidByCountry = new Map<string, number>();
  const sovereignDebtFaceRetiredByCountry = new Map<string, number>();
  // #992 tranche 4: fund-holder coupon/maturity rows are fund-subject legs, so
  // the shadow ledger books them against fund:<id> (the stock-checked cash
  // account) instead of a phantom corporation:<fundId>. One projected read:
  // funds are few and the currency never changes mid-turn.
  const fundCurrencyById = new Map(
    (
      await db
        .collection("indexFunds")
        .find({}, { projection: { anchorCurrencyCode: 1 } })
        .toArray()
    ).map((f) => [
      String(f._id),
      typeof f.anchorCurrencyCode === "string" ? f.anchorCurrencyCode : "",
    ])
  );
  function fundLedgerCurrency(fundIdStr: string): CurrencyCode | null {
    const ccy = fundCurrencyById.get(fundIdStr);
    return ccy ? (ccy as CurrencyCode) : null;
  }
  // Cash owed to each currency's bond market pool for the units it holds
  // (`publicFloat`). Issuers already pay for those units: corporate coupon and
  // maturity cost below count float units, and the sovereign budget carries
  // them in debtInterest. Before the pool existed that money vanished.
  const poolCreditsLocal = new Map<CurrencyCode, { couponsIn: number; maturitiesIn: number }>();
  function addPoolCredit(
    currency: CurrencyCode,
    kind: "couponsIn" | "maturitiesIn",
    local: number
  ) {
    if (!(local > 0)) return;
    const row = poolCreditsLocal.get(currency) ?? { couponsIn: 0, maturitiesIn: 0 };
    row[kind] += local;
    poolCreditsLocal.set(currency, row);
  }

  let couponsPaid = 0;
  let totalCouponsPaid = 0;

  // FX spreads skimmed from corp holders' foreign-currency coupon income — same
  // rate players pay on auto_coupon conversion. Distributed to the CB system
  // after balances settle (skimmed before crediting so it can't push a corp
  // negative or affect the default check). fee is denominated in the bond currency.
  const corpCouponSpreadFees: Array<{
    fromCurrency: CurrencyCode;
    toCurrency: CurrencyCode;
    fee: number;
  }> = [];

  // ── Phase 1: Coupon payments ──────────────────────────────────────────────
  for (const bond of activeBonds) {
    if (!bondAccruesCoupon(bond)) continue;
    // Funded sovereign coupon claims are paid or retained as arrears by
    // TreasuryTurn. Do not run the legacy unfunded holder and pool credits.
    if (config?.treasuryCashLedgerEnabled === true && bond.issuerType === "sovereign") continue;

    // `perTurnCouponPayment(rate, BOND_UNIT_FACE_VALUE)` returns the coupon in
    // the bond's LOCAL currency (`bond.currencyCode`, post-Task-18B). Downstream
    // consumers (addCharPayment / addImperialPayment, corpCouponCosts →
    // anchorToCorpCapital) all expect ₳, so normalize LOCAL → ₳ once per bond.
    // Without this step JP bondholders receive ~114× intended coupons per turn
    // and JP corp issuers over-deduct by the same factor — the latter cascades
    // to forced default within a handful of turns.
    const couponPerUnitLocal = perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE);
    const bondCcy = resolveBondCurrency(bond);
    const bondFxRate = fxByCurrency.get(bondCcy) ?? 1;
    const couponPerUnitAnchor = corpCapitalToAnchor(couponPerUnitLocal, bondCcy, bondFxRate);

    // Pay each holder
    for (const holder of bond.holders) {
      const paymentAnchor = couponPerUnitAnchor * holder.units;
      if (paymentAnchor <= 0) continue;

      // Convert anchor → bondCurrency local for the tx amount + display.
      const localAmountForTx = bondFxRate > 0 ? paymentAnchor * bondFxRate : paymentAnchor;

      if (holder.characterId) {
        addCharPayment(holder.characterId.toString(), paymentAnchor, bondCcy);
        // bond_coupon was previously unlogged for character holders — Phase 5
        // pushed only bond_maturity. That gap is what made multi-billion-dollar
        // coupon distributions invisible in the financial ledger and produced
        // the cash-mismatch pattern flagged on the production wealth list.
        txBondEntries.push({
          type: "bond_coupon",
          turn,
          createdAt: now,
          subjectType: "character",
          subjectId: holder.characterId,
          charId: holder.characterId.toString(),
          amount: localAmountForTx,
          currencyCode: bondCcy,
          counterpartyType: isCorporateBond(bond) ? "corporation" : "government",
          counterpartyId: isCorporateBond(bond) ? bond.corporationId : undefined,
          counterpartyName: bond.issuerName ?? "Bond issuer",
          meta: {
            bondId: String(bond._id),
            units: holder.units,
            couponRate: bond.couponRate,
          },
        });
      } else if (holder.imperialCharacterId) {
        addImperialPayment(holder.imperialCharacterId.toString(), paymentAnchor, bondCcy);
        txBondEntries.push({
          type: "bond_coupon",
          turn,
          createdAt: now,
          subjectType: "character",
          subjectId: holder.imperialCharacterId,
          charId: holder.imperialCharacterId.toString(),
          isImperial: true,
          amount: localAmountForTx,
          currencyCode: bondCcy,
          counterpartyType: isCorporateBond(bond) ? "corporation" : "government",
          counterpartyId: isCorporateBond(bond) ? bond.corporationId : undefined,
          counterpartyName: bond.issuerName ?? "Bond issuer",
          meta: {
            bondId: String(bond._id),
            units: holder.units,
            couponRate: bond.couponRate,
            imperial: true,
          },
        });
      } else if (holder.fundId) {
        const couponAnchor = addFundPayment(holder.fundId.toString(), paymentAnchor);
        // #992 tranche 4: the fund credit lands on cashAnchor (₳), so the row
        // is fund-subject in the fund's own currency with the ₳ value stated
        // outright — never derived from the live FX table. Without a fund doc
        // there is no currency to book in, so the row keeps the legacy shape
        // rather than guessing.
        const couponFundIdStr = holder.fundId.toString();
        const couponFundCcy = fundLedgerCurrency(couponFundIdStr);
        if (couponFundCcy) {
          txBondEntries.push({
            type: "bond_coupon",
            turn,
            createdAt: now,
            subjectType: "fund",
            subjectId: holder.fundId,
            amount: couponAnchor,
            anchorAmount: couponAnchor,
            currencyCode: couponFundCcy,
            counterpartyType: "government",
            counterpartyName: bond.issuerName ?? "Bond issuer",
            meta: {
              bondId: String(bond._id),
              units: holder.units,
              couponRate: bond.couponRate,
              fundId: couponFundIdStr,
              fundCurrency: couponFundCcy,
              unroundedAnchorAmount: paymentAnchor,
              roundingMethod: "cumulative_fund_credit",
            },
          });
        } else {
          txBondEntries.push({
            type: "bond_coupon",
            turn,
            createdAt: now,
            subjectType: "corporation",
            subjectId: holder.fundId,
            amount: localAmountForTx,
            currencyCode: bondCcy,
            counterpartyType: "government",
            counterpartyName: bond.issuerName ?? "Bond issuer",
            meta: {
              bondId: String(bond._id),
              units: holder.units,
              couponRate: bond.couponRate,
              fundId: couponFundIdStr,
            },
          });
        }
      } else if (holder.corporationId) {
        const key = holder.corporationId.toString();
        const holderCorp = corpMap.get(key);
        const holderCurrency = (resolveCorpLiquidCurrencyCode(holderCorp) ?? "USD") as CurrencyCode;
        // Foreign coupon income converts into the corp's home currency — charge
        // the same FX spread players pay, skimmed before crediting.
        const couponSpreadRate = forexEnabled
          ? purchaseSpreadRate(
              bondCcy,
              holderCurrency,
              gameState?.euroMonetaryUnion,
              spreadStrengths
            )
          : 0;
        const couponSpreadAnchor = paymentAnchor * couponSpreadRate;
        const netCouponAnchor = paymentAnchor - couponSpreadAnchor;
        corpPayments.set(key, (corpPayments.get(key) ?? 0) + netCouponAnchor);
        if (couponSpreadAnchor > 0) {
          corpCouponSpreadFees.push({
            fromCurrency: bondCcy,
            toCurrency: holderCurrency,
            fee: localAmountForTx * couponSpreadRate,
          });
        }
        const holderFxRate = fxRateForCorpFromMap(holderCorp, fxByCurrency);
        const holderLocalAmount = anchorToCorpCapital(
          netCouponAnchor,
          resolveCorpLiquidCurrencyCode(holderCorp),
          holderFxRate
        );
        txBondEntries.push({
          type: "bond_coupon",
          turn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: holder.corporationId,
          amount: Math.round(holderLocalAmount * 100) / 100,
          currencyCode: holderCurrency,
          counterpartyType: isCorporateBond(bond) ? "corporation" : "government",
          counterpartyId: isCorporateBond(bond) ? bond.corporationId : undefined,
          counterpartyName: bond.issuerName ?? "Bond issuer",
          meta: {
            bondId: String(bond._id),
            units: holder.units,
            couponRate: bond.couponRate,
            bondCurrency: bondCcy,
            bondAmount: Math.round(localAmountForTx * 100) / 100,
            fxSpreadAnchor: couponSpreadAnchor,
          },
        });
      } else if (holder.nppId) {
        // v3 autonomous NPP bondholder coupon to its separate investment account.
        addNppPayment(holder.nppId.toString(), paymentAnchor, bondCcy, "coupon");
      } else if (holder.bankId) {
        // TreasuryTurn owns this cash leg from its frozen opening-bond plan.
        // This branch records no second bank credit.
      }

      totalCouponsPaid += paymentAnchor;
      couponsPaid++;
    }

    if (bond.publicFloat > 0) {
      addPoolCredit(bondPoolCurrency(bond), "couponsIn", couponPerUnitLocal * bond.publicFloat);
    }

    if (isCorporateBond(bond)) {
      // The coupon on pool-held units is real cost to the issuer and real income
      // to the pool (credited in Phase 6).
      // Track total coupon cost for issuing corp (₳; Phase 2 converts to issuer-local).
      const corpIdStr = bond.corporationId.toString();
      const totalUnits = bond.holders.reduce((sum, h) => sum + h.units, 0) + bond.publicFloat;
      const totalCostAnchor = couponPerUnitAnchor * totalUnits;
      corpCouponCosts.set(corpIdStr, (corpCouponCosts.get(corpIdStr) ?? 0) + totalCostAnchor);
      // Issuer-side ledger row mirrors the holder-side bond_coupon rows above
      // so each bond's coupon flow nets to zero in the ledger (modulo public
      // float). Natcorps are excluded because their coupons are government-
      // covered (no liquidCapital change in Phase 2). Zero-unit bonds (no
      // holders + no public float) skip the row — there's no actual cost.
      if (!natcorpIds.has(corpIdStr) && totalUnits > 0) {
        const issuer = corpMap.get(corpIdStr);
        const issuerCcy = resolveCorpLiquidCurrencyCode(issuer);
        const issuerRate = fxRateForCorpFromMap(issuer, fxByCurrency);
        const issuerLocalCost = anchorToCorpCapital(totalCostAnchor, issuerCcy, issuerRate);
        txBondEntries.push({
          type: "bond_coupon",
          turn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: bond.corporationId,
          amount: -Math.round(issuerLocalCost * 100) / 100,
          // USD fallback when corp lacks both `liquidCurrencyCode` and a
          // recognized `countryId` — avoids writing `currencyCode: undefined`.
          currencyCode: (issuerCcy ?? "USD") as CurrencyCode,
          meta: {
            bondId: String(bond._id),
            units: totalUnits,
            couponRate: bond.couponRate,
            source: "issuer_coupon",
          },
        });
      }
    } else {
      const sovereignCountryId = getBondCountryId(bond);
      const sovereignTotalLocal =
        couponPerUnitLocal *
        (bond.holders.reduce((sum, holder) => sum + holder.units, 0) + bond.publicFloat);
      const existingGovCoupon = govCouponByCountry.get(sovereignCountryId);
      govCouponByCountry.set(sovereignCountryId, {
        total: (existingGovCoupon?.total ?? 0) + sovereignTotalLocal,
        currency: bondCcy,
      });
    }
  }

  // ── Phase 1.5: Pre-compute maturity flows for the unified delta ───────────
  // Pre-fix Phase 5 settled maturity face value AFTER the Phase 3 default
  // check: corp issuers were debited inline (per-bond updateOne) and corp
  // holders were credited via Phase 6's `corpPayments` bulkWrite. That left
  // two ordering bugs in addition to coupon-vs-coupon: (a) a holder corp
  // could be defaulted on its own coupons even though large maturity income
  // was inbound; (b) an issuer never failed the default check on its own
  // maturity face value because the debit happened after the check. Folding
  // both into the per-corp delta computed below restores cause-and-effect.
  for (const bond of activeBonds) {
    if (bond.defaulted) continue;
    if (turn < bond.maturityTurn) continue;

    const bondCcy = resolveBondCurrency(bond);
    const bondFxRate = fxByCurrency.get(bondCcy) ?? 1;
    const faceValueUnitAnchor = corpCapitalToAnchor(BOND_UNIT_FACE_VALUE, bondCcy, bondFxRate);

    const flow: BondMaturityFlow = {
      bond,
      issuerCostAnchor: 0,
      holderCorpCreditsAnchor: new Map(),
    };

    // Holder credits — corp holders only. Char/imperial maturity payouts stay
    // in Phase 5 since they don't participate in the corp default check.
    for (const holder of bond.holders) {
      if (!holder.corporationId) continue;
      // With the funded cash ledger enabled, sovereign maturity income is
      // delivered by its frozen per-bond receipt below. Do not optimistically
      // credit it before that receipt's Treasury debit has landed.
      if (
        config?.treasuryCashLedgerEnabled === true &&
        sovereignMaturityCandidateIds.has(bond._id.toHexString())
      )
        continue;
      const creditAnchor = holder.units * faceValueUnitAnchor;
      if (creditAnchor <= 0) continue;
      const key = holder.corporationId.toString();
      flow.holderCorpCreditsAnchor.set(
        key,
        (flow.holderCorpCreditsAnchor.get(key) ?? 0) + creditAnchor
      );
      corpMaturityIncome.set(key, (corpMaturityIncome.get(key) ?? 0) + creditAnchor);
    }

    // Issuer debit — corporate bonds only. Sovereign maturity is settled
    // separately (settleSovereignBondMaturity in Phase 5) and doesn't touch
    // a corporation's liquidCapital.
    if (isCorporateBond(bond)) {
      const totalUnitsOutstanding =
        bond.holders.reduce((sum, h) => sum + h.units, 0) + bond.publicFloat;
      const totalCostAnchor = totalUnitsOutstanding * faceValueUnitAnchor;
      flow.issuerCostAnchor = totalCostAnchor;
      const issuerKey = bond.corporationId.toString();
      corpMaturityCost.set(issuerKey, (corpMaturityCost.get(issuerKey) ?? 0) + totalCostAnchor);
    }

    bondMaturityFlows.push(flow);
  }

  // ── Phase 2: Apply unified per-corp delta ─────────────────────────────────
  // Net (income − cost) is computed in ₳ then converted to each corp's
  // liquidCapital currency. Natcorps still skip the *coupon* cost portion
  // (government covers bond interest), but they do incur maturity face-value
  // cost — pre-fix Phase 5 had no natcorp gate on the issuer maturity debit
  // and we preserve that. Income is always credited regardless of natcorp.
  const allCorpDeltaIds = new Set<string>([
    ...corpCouponCosts.keys(),
    ...corpPayments.keys(),
    ...corpMaturityCost.keys(),
    ...corpMaturityIncome.keys(),
  ]);
  const corpDeltaOps = [];
  for (const corpIdStr of allCorpDeltaIds) {
    const isNatcorp = natcorpIds.has(corpIdStr);
    // `corp` may be either an issuer (in corpCouponCosts/corpMaturityCost) or
    // a pure holder (only in corpPayments/corpMaturityIncome) — the FX path
    // is the same: convert the net ₳ delta into the corp's liquidCapital
    // currency before $inc.
    const corp = corpMap.get(corpIdStr);

    const couponCostAnchor = isNatcorp ? 0 : (corpCouponCosts.get(corpIdStr) ?? 0);
    const maturityCostAnchor = corpMaturityCost.get(corpIdStr) ?? 0;
    const incomeAnchor =
      (corpPayments.get(corpIdStr) ?? 0) + (corpMaturityIncome.get(corpIdStr) ?? 0);

    const netAnchor = incomeAnchor - couponCostAnchor - maturityCostAnchor;
    if (netAnchor === 0) continue;

    const localDelta = anchorToCorpCapital(
      netAnchor,
      resolveCorpLiquidCurrencyCode(corp),
      fxRateForCorpFromMap(corp, fxByCurrency)
    );
    corpDeltaOps.push({
      updateOne: {
        filter: { _id: new ObjectId(corpIdStr) },
        update: { $inc: { liquidCapital: localDelta }, $set: { updatedAt: now } },
      },
    });
  }
  if (corpDeltaOps.length > 0) {
    await db.collection("corporations").bulkWrite(corpDeltaOps);
  }

  // ── Phase 3: Check for defaults (negative liquidCapital) ──────────────────
  // Re-fetch corporations after Phase 2 deltas. Detection only — credit
  // penalty application is deferred until after Phase 3.5 cascade resolution
  // so newly-cascaded defaults pick up the same penalty.
  //
  // SKIPPED ENTIRELY WHILE CORPORATION ACTIONS ARE PAUSED (ticket #1198).
  // The pause skips `corporationTurn` — sector revenue, operating income,
  // dividends — but deliberately not this phase, because coupons and maturities
  // are contractual and sovereign bondholders should not lose income because an
  // admin paused corporations. Settling those obligations is right. LIQUIDATING
  // a corporation for the cash hole that settlement opens is not: the pause
  // switched the corp's income off, so the shortfall is the pause's doing, not
  // the corp's. Corporation #624 was defaulted at turns 416 and 418 exactly this
  // way, paying a A10.2m coupon per turn against revenue the pause had removed.
  //
  // So coupon and maturity settlement above still runs; only the decision to
  // declare a corp insolvent is held until corporations are live again. A corp
  // that is genuinely insolvent will still be caught on the first unpaused turn.
  // Escrow cover is inside the skip on purpose — it exists only as a pre-default
  // mitigation, so with no default possible there is no reason to move a
  // player's buyback escrow.
  if (corporationActionsPaused && corpIds.length > 0) {
    console.log(
      `[bondTurn] corporation actions paused — skipping default detection and ` +
        `auto-resolution for ${corpIds.length} bond-issuing corp(s). ` +
        `Coupons and maturities still settled.`
    );
  }
  if (!corporationActionsPaused && corpIds.length > 0) {
    const updatedCorps = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpIds.map((id) => new ObjectId(id)) } })
      .project<{ _id: ObjectId; liquidCapital: number; shareEscrowBalance?: number }>({
        _id: 1,
        liquidCapital: 1,
        shareEscrowBalance: 1,
      })
      .toArray();

    // Bonds-only escrow fallback: a corp that went negative on bond obligations
    // may cover the shortfall from a positive buyback escrow before defaulting.
    const negativeNonNatcorp = updatedCorps.filter(
      (corp) => corp.liquidCapital < 0 && !natcorpIds.has(corp._id.toString())
    );
    const stillNegative = await coverBondShortfallsFromEscrow(db, negativeNonNatcorp, now);

    // SOLVENCY GATE. `liquidCapital < 0` is a liquidity snapshot, not
    // insolvency. A corp that has converted cash into plant is short of cash by
    // construction, and saying so is not the same as saying it cannot pay.
    // Ticket #1130 defaulted a corp 16.58 under, holding ₳232k of assets
    // (mostly paid-for construction not yet delivered) against ₳165k of debt,
    // then ran it through a ladder that sold its only sector.
    //
    // The test is whether the corp's assets could cover its debt, valued on the
    // SAME exit basis the restructure planner uses to decide what to sell. That
    // is deliberate: if restructuring could have covered the debt, the corp was
    // never insolvent, only illiquid, and the ladder should not start. A corp
    // whose assets fall short is insolvent and defaults exactly as before.
    //
    // A corp left illiquid still cannot spend what it does not have, so it is
    // under real pressure — it simply is not liquidated over a cash dip.
    //
    // Scope: initial detection only. Cascade defaults (Phase 3.5) are a
    // counterparty genuinely failing to pay, so they are left untouched.
    const solvencyChecked = await filterInsolventCorps(db, stillNegative, {
      corpMap,
      fxByCurrency,
      centralBanks,
      activeBonds,
    });
    for (const idStr of solvencyChecked) {
      defaultedCorps.add(idStr);
    }
  }

  // ── Phase 3.5: Roll back maturity flows for newly-defaulted issuers ───────
  // Mutates `defaultedCorps` with cascade-defaulted holder corps; see
  // rollbackDefaultedIssuerMaturityFlows in ./bondTurnHelpers for the full
  // optimistic-write reversal + cascade semantics.
  steps.mark("couponsAndMaturities");
  await rollbackDefaultedIssuerMaturityFlows({
    db,
    bondMaturityFlows,
    defaultedCorps,
    corpMap,
    natcorpIds,
    fxByCurrency,
    now,
  });

  // ── Phase 3.6: Apply credit penalty to all defaulted corps ────────────────
  // Run once after cascade resolution so initial + cascaded defaults all get
  // the same `bondDefaultCreditPenaltyUntilTurn` treatment.
  const creditPenaltyOps = [];
  for (const corpIdStr of defaultedCorps) {
    const c = corpMap.get(corpIdStr);
    if (!c) continue;
    const nextUntil = turn + BOND_DEFAULT_CREDIT_PENALTY_TURNS;
    const prevUntil = c.bondDefaultCreditPenaltyUntilTurn ?? 0;
    const newUntil = Math.max(prevUntil, nextUntil);
    if (newUntil > prevUntil) {
      creditPenaltyOps.push({
        updateOne: {
          filter: { _id: new ObjectId(corpIdStr) },
          update: { $set: { bondDefaultCreditPenaltyUntilTurn: newUntil, updatedAt: now } },
        },
      });
      c.bondDefaultCreditPenaltyUntilTurn = newUntil;
    }
  }
  if (creditPenaltyOps.length > 0) {
    await db.collection<Corporation>("corporations").bulkWrite(creditPenaltyOps);
  }

  // ── Phase 4: Update market prices and handle maturity/default ─────────────
  let bondsMatured = 0;
  let bondsDefaulted = 0;
  const newlyDefaultedIssuerCorpIds = new Set<string>();

  for (const bond of activeBonds) {
    const corpIdStr = bond.corporationId.toString();
    const corp = isCorporateBond(bond) ? corpMap.get(corpIdStr) : undefined;
    const isDefaulted = isCorporateBond(bond)
      ? defaultedCorps.has(corpIdStr) || bond.defaulted
      : false;
    const isMatured = turn >= bond.maturityTurn;

    if (isDefaulted && !bond.defaulted) {
      // Mark as defaulted
      bondOps.push({
        updateOne: {
          filter: { _id: bond._id },
          update: {
            $set: {
              defaulted: true,
              defaultedAtTurn: turn,
              marketPrice: 0.1,
              updatedAt: now,
            },
          },
        },
      });
      bondsDefaulted++;
      const issuerCorpIdStr = bond.corporationId?.toString();
      if (issuerCorpIdStr) {
        newlyDefaultedIssuerCorpIds.add(issuerCorpIdStr);
      }
      continue;
    }

    if (isMatured && !bond.defaulted) {
      // A journaled bank treasury buy/sale has already reserved units out of
      // publicFloat or a bank lot. Treasury recovery runs later in BankingTurn;
      // redeeming this snapshot first would clear the pending inventory before
      // its funded cash leg can settle. Keep the bond live and retry maturity
      // on the next turn after the durable trade receipt resolves.
      if (bond.holders?.some((holder) => holder.bankTreasuryTradeId)) continue;
      // Auto-redeem at maturity: Phase 5 (below) returns face value to every
      // holder from the in-memory `bond.holders` snapshot captured here, then
      // we clear the holdings so the redeemed position does NOT linger. Before
      // this, a matured bond kept its `holders` array populated: the position
      // stayed visible in holder-based views (sovereign holdings, wealth list)
      // while being excluded from portfolio `bondValue` (which filters
      // `matured: false`) — the phantom-holding split reported in issue #2974.
      // Clearing `holders` + `publicFloat` and stamping `redeemedAtTurn` makes
      // the redemption clean and idempotent (the bond leaves `activeBonds`
      // next turn via the `matured: false` filter, so it is never paid twice).
      maturedBonds.push(bond);
      if (
        config?.treasuryCashLedgerEnabled === true &&
        sovereignMaturityCandidateIds.has(bond._id.toHexString())
      ) {
        // The per-bond receipt applies retirement last, after cash and holder
        // legs. Never queue an eager bulk retirement for this path.
        continue;
      }
      bondOps.push({
        updateOne: {
          filter: { _id: bond._id },
          update: {
            $set: {
              matured: true,
              redeemedAtTurn: turn,
              marketPrice: 1.0,
              publicFloat: 0,
              holders: [],
              updatedAt: now,
            },
          },
        },
      });
      bondsMatured++;
      continue;
    }

    // Update market price based on current rates
    if (!bond.defaulted) {
      const countryId = isCorporateBond(bond)
        ? corp
          ? corp.countryId
          : getBondCountryId(bond)
        : getBondCountryId(bond);
      const cb = cbByCountry.get(countryId);
      const primeRate = cb?.primeRate ?? 2.75;

      let currentRate = primeRate;
      if (isCorporateBond(bond)) {
        // Get corp's current credit rating for effective rate
        const corpBonds = activeBonds.filter(
          (candidate) =>
            isCorporateBond(candidate) &&
            candidate.corporationId.toString() === corpIdStr &&
            !candidate.matured &&
            !candidate.defaulted
        );

        // Credit math runs in ₳. Every input (liquidCapital, sharePrice × shares,
        // totalDebt, annualInterest) must be normalized to the same unit or the
        // debt/equity and interest-coverage ratios compare incoherent currencies.
        // Post-v0.2.6: bond.totalIssued is in bond.currencyCode; corp.sharePrice
        // and corp.liquidCapital are in corp.liquidCurrencyCode. Resolve each per
        // entity (bonds may straddle currencies in edge cases) and anchor-normalize.
        let totalDebt = 0;
        let annualInterest = 0;
        for (const candidate of corpBonds) {
          const bondCcy = (candidate.currencyCode ??
            (candidate.countryId && candidate.countryId in COUNTRY_CURRENCY_MAP
              ? COUNTRY_CURRENCY_MAP[candidate.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
              : undefined)) as CurrencyCode | undefined;
          const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
          totalDebt += corpCapitalToAnchor(candidate.totalIssued, bondCcy, bondRate);
          annualInterest += corpCapitalToAnchor(
            (candidate.couponRate / 100) * candidate.totalIssued,
            bondCcy,
            bondRate
          );
        }

        const corpData = corpMap.get(corpIdStr);
        const corpCode = corpData ? resolveCorpLiquidCurrencyCode(corpData) : undefined;
        const corpRate = corpData ? fxRateForCorpFromMap(corpData, fxByCurrency) : 1;
        const corpLiquidAnchor = corpData
          ? corpCapitalToAnchor(corpData.liquidCapital, corpCode, corpRate)
          : 0;
        const sharePriceAnchor = corpData
          ? corpCapitalToAnchor(corpData.sharePrice, corpCode, corpRate)
          : 0;
        const totalEquity = corpData
          ? corpLiquidAnchor + sharePriceAnchor * (corpData.totalShares ?? 10_000_000) * 0.1
          : 1;

        const penaltyActive =
          corpData != null &&
          corpData.bondDefaultCreditPenaltyUntilTurn != null &&
          turn < corpData.bondDefaultCreditPenaltyUntilTurn;

        const creditResult = calculateCreditScore(
          corpLiquidAnchor,
          totalDebt,
          0, // We don't have per-turn income here, use 0 for conservative estimate
          annualInterest,
          totalEquity,
          {
            bondDefaultCreditPenaltyActive: !!penaltyActive,
            nearTermLiquidityScore:
              corporateBondMaturityLiquidity({
                bonds: corpBonds,
                liquidCapitalAnchor: corpLiquidAnchor,
                incomePerTurn: 0,
                annualCouponObligations: annualInterest,
                currentTurn: turn,
                fxByCurrency,
              }).liquidityScore ?? undefined,
          }
        );
        currentRate = getBondCouponRate(primeRate, creditResult.rating);
      }

      const turnsRemaining = bond.maturityTurn - turn;

      if (
        isCorporateBond(bond) &&
        turnsRemaining > 0 &&
        CORP_BOND_DUE_SOON_REMINDER_TURNS.includes(turnsRemaining) &&
        !natcorpIds.has(corpIdStr)
      ) {
        const issuer = corpMap.get(corpIdStr);
        if (issuer?.userId) {
          const weeksLabel = turnsRemaining === 1 ? "1 week" : `${turnsRemaining} weeks`;
          notifications.push({
            userId: issuer.userId,
            type: "corp_bond_due_soon",
            title: "Corporate bond nearing maturity",
            message: `${issuer.name}: principal repayment is due in about ${weeksLabel} (turn ${bond.maturityTurn}). Plan liquidity so cash on hand can cover the maturity.`,
            metadata: {
              bondId: bond._id.toString(),
              corporationId: bond.corporationId.toString(),
              ...(issuer.sequentialId != null
                ? { corporationSequentialId: issuer.sequentialId }
                : {}),
              maturityTurn: bond.maturityTurn,
              turnsRemaining,
            },
          });
        }
      }

      const newPrice = applyQePriceSupport(
        calculateBondMarketPrice(bond.couponRate, currentRate, turnsRemaining, false),
        bond.qeSupportRatio ?? 0
      );

      bondOps.push({
        updateOne: {
          filter: { _id: bond._id },
          update: { $set: { marketPrice: newPrice, updatedAt: now } },
        },
      });
    }
  }

  for (const issuerCorpId of newlyDefaultedIssuerCorpIds) {
    await fireBondDefaultPulse(db, issuerCorpId);
  }

  // ── Phase 5: Settle matured bonds ─────────────────────────────────────────
  // Sovereign maturities settle first, in bounded lanes. Each one is a chain of
  // dependent journal round trips (freeze, fund, pay), and running them bond by
  // bond made a ladder maturity turn take ~20 s. The loop below emits their
  // ledger rows in the original bond order.
  const dueSovereignBonds = maturedBonds.filter(
    (bond) =>
      config?.treasuryCashLedgerEnabled === true &&
      sovereignMaturityCandidateIds.has(bond._id.toHexString()) &&
      bond.countryId
  );
  const budgetsWithBankClaims = new Set<string>(
    dueSovereignBonds.length > 0
      ? (
          await db
            .collection<FederalBudget>("federalBudget")
            .find(
              {
                _id: {
                  $in: [
                    ...new Set(
                      dueSovereignBonds.map((bond) => getNationalBudgetId(bond.countryId!))
                    ),
                  ],
                },
                "bankSovereignClaims.0": { $exists: true },
              },
              { projection: { _id: 1 } }
            )
            .toArray()
        ).map((budget) => String(budget._id))
      : []
  );
  const lock = new KeyedQueue();
  const settleDueSovereignBond = (bond: Bond): Promise<PartialTxEntry[] | null> => {
    if (!bond.countryId) return Promise.resolve(null);
    const countryId = bond.countryId;
    const bondCcy = resolveBondCurrency(bond);
    const budgetId = getNationalBudgetId(countryId);
    const treasuryValuation = treasuryAnchorValuation({
      countryId: countryId,
      currencyCode: bondCcy,
      preset: gameState?.preset ?? DEFAULT_SEED_PRESET,
      observedRate: authoritativeRates?.get(bondCcy),
    });
    if (!treasuryValuation || !(treasuryValuation.anchorRate > 0)) return Promise.resolve(null);

    const bankUnits = (bond.holders ?? []).reduce(
      (sum, holder) =>
        sum +
        (holder.bankId && Number.isSafeInteger(holder.charteredTurn)
          ? Math.max(0, holder.units)
          : 0),
      0
    );
    const bankAmountLocal = roundSavingsAmount(bankUnits * BOND_UNIT_FACE_VALUE, bondCcy);
    const totalUnits =
      (bond.holders ?? []).reduce((sum, holder) => sum + Math.max(0, holder.units), 0) +
      Math.max(0, bond.publicFloat) +
      Math.max(0, bond.centralBankHoldings ?? 0);
    const totalRepaymentLocal = totalUnits * BOND_UNIT_FACE_VALUE;
    const nonBankRepaymentLocal = Math.max(0, totalRepaymentLocal - bankAmountLocal);

    const holderLegs: Array<{
      collection: string;
      filter: Record<string, unknown>;
      path: string;
      amount: number;
      currencyCode: CurrencyCode;
      localPerAnchor: number;
      note: string;
    }> = [];
    const maturityEntries: PartialTxEntry[] = [];
    const addHolderLeg = (
      collection: string,
      id: ObjectId | string,
      path: string,
      amount: number,
      currencyCode: CurrencyCode,
      localPerAnchor: number,
      note: string
    ) => {
      if (!(amount > 0)) return;
      holderLegs.push({
        collection,
        filter: { _id: id },
        path,
        amount,
        currencyCode,
        localPerAnchor,
        note,
      });
    };
    const bondFxRate = fxByCurrency.get(bondCcy) ?? 1;
    for (const holder of bond.holders ?? []) {
      if (!(holder.units > 0) || holder.bankId) continue;
      const faceAnchor =
        holder.units * corpCapitalToAnchor(BOND_UNIT_FACE_VALUE, bondCcy, bondFxRate);
      if (holder.characterId) {
        const personalPath = Object.keys(buildPersonalBalanceInc(1, bondCcy, forexEnabled))[0]!;
        addHolderLeg(
          "characters",
          holder.characterId,
          personalPath,
          holder.units * BOND_UNIT_FACE_VALUE,
          bondCcy,
          bondFxRate,
          "Pay matured sovereign bond to character"
        );
        maturityEntries.push({
          type: "bond_maturity",
          turn,
          createdAt: now,
          subjectType: "character",
          subjectId: holder.characterId,
          charId: holder.characterId.toHexString(),
          amount: holder.units * BOND_UNIT_FACE_VALUE,
          currencyCode: bondCcy,
          meta: {
            bondId: bond._id.toHexString(),
            units: holder.units,
            couponRate: bond.couponRate,
          },
        });
      } else if (holder.imperialCharacterId) {
        const personalPath = Object.keys(buildPersonalBalanceInc(1, bondCcy, forexEnabled))[0]!;
        addHolderLeg(
          "imperialCharacters",
          holder.imperialCharacterId,
          personalPath,
          holder.units * BOND_UNIT_FACE_VALUE,
          bondCcy,
          bondFxRate,
          "Pay matured sovereign bond to imperial character"
        );
        maturityEntries.push({
          type: "bond_maturity",
          turn,
          createdAt: now,
          subjectType: "character",
          subjectId: holder.imperialCharacterId,
          charId: holder.imperialCharacterId.toHexString(),
          isImperial: true,
          amount: holder.units * BOND_UNIT_FACE_VALUE,
          currencyCode: bondCcy,
          meta: {
            bondId: bond._id.toHexString(),
            units: holder.units,
            couponRate: bond.couponRate,
            imperial: true,
          },
        });
      } else if (holder.corporationId) {
        const holderCorp = corpMap.get(holder.corporationId.toHexString());
        const holderCurrency = (resolveCorpLiquidCurrencyCode(holderCorp) ?? "USD") as CurrencyCode;
        const holderFxRate = fxRateForCorpFromMap(holderCorp, fxByCurrency);
        const localAmount = anchorToCorpCapital(faceAnchor, holderCurrency, holderFxRate);
        addHolderLeg(
          "corporations",
          holder.corporationId,
          "liquidCapital",
          localAmount,
          holderCurrency,
          holderFxRate,
          "Pay matured sovereign bond to corporation"
        );
        maturityEntries.push({
          type: "bond_maturity",
          turn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: holder.corporationId,
          amount: localAmount,
          currencyCode: holderCurrency,
          meta: {
            bondId: bond._id.toHexString(),
            units: holder.units,
            couponRate: bond.couponRate,
          },
        });
      } else if (holder.fundId) {
        addHolderLeg(
          "indexFunds",
          holder.fundId,
          "cashAnchor",
          faceAnchor,
          "USD",
          1,
          "Pay matured sovereign bond to investment fund"
        );
        maturityEntries.push({
          type: "bond_maturity",
          turn,
          createdAt: now,
          subjectType: "fund",
          subjectId: holder.fundId,
          amount: faceAnchor,
          anchorAmount: faceAnchor,
          currencyCode: fundLedgerCurrency(holder.fundId.toHexString()) ?? "USD",
          meta: {
            bondId: bond._id.toHexString(),
            units: holder.units,
            couponRate: bond.couponRate,
          },
        });
      } else if (holder.nppId) {
        addHolderLeg(
          "npps",
          holder.nppId,
          "nppInvestmentCashAnchor",
          faceAnchor,
          "USD",
          1,
          "Pay matured sovereign bond to NPP investment account"
        );
      }
    }
    if (bond.publicFloat > 0) {
      addHolderLeg(
        "bondMarketPools",
        bondPoolCurrency(bond),
        "cashLocal",
        bond.publicFloat * BOND_UNIT_FACE_VALUE,
        bondCcy,
        bondFxRate,
        "Redeem public sovereign bond float to its funded pool"
      );
    }
    if ((bond.centralBankHoldings ?? 0) > 0) {
      addHolderLeg(
        "centralBanks",
        countryId,
        "reserveBalance",
        (bond.centralBankHoldings ?? 0) * BOND_UNIT_FACE_VALUE,
        bondCcy,
        bondFxRate,
        "Redeem central-bank sovereign holdings to reserves"
      );
    }

    // Every document this maturity writes. Bonds of one country share its
    // Treasury, and a holder can sit on several countries' bonds; the queue
    // runs those in bond order while unrelated countries settle at once.
    const keys = [
      `federalBudget:${budgetId}`,
      `bonds:${bond._id.toHexString()}`,
      ...holderLegs.map((leg) => `${leg.collection}:${String(leg.filter._id)}`),
    ];
    // Bank claims settle the whole budget's claim book against bank escrows
    // and the insurance funds, so any bond that may touch them takes one
    // shared key.
    if (bankUnits > 0 || budgetsWithBankClaims.has(budgetId)) keys.push("bankSovereignClaims");
    return lock.run(keys, async () => {
      // Lock the bond-owned due quote before creating or paying bank claims.
      // A short Treasury can leave those claims pending across turns, so the
      // holder snapshot must already be immutable during that interval.
      await freezeFundedSovereignBondMaturityQuote(db, {
        bond,
        dueTurn: bond.maturityTurn,
        currencyCode: bondCcy,
        treasuryLocalPerAnchor: treasuryValuation.anchorRate,
        nonBankRepaymentLocal,
        holderLegs,
        now,
      });

      const newClaims = await addBankMaturityClaims(db, {
        budgetId,
        countryId: countryId,
        currencyCode: bondCcy,
        turn,
        bond,
        anchorRate: treasuryValuation.anchorRate,
        treasuryCashLedgerEnabled: true,
      });
      let budgetWithClaims = await db
        .collection<FederalBudget>("federalBudget")
        .findOne(
          { _id: budgetId },
          { projection: { _id: 1, countryId: 1, bankSovereignClaims: 1 } }
        );
      if (budgetWithClaims?.bankSovereignClaims?.length) {
        const dueClaims = budgetWithClaims.bankSovereignClaims.filter(
          (claim) => claim.kind === "maturity" && claim.bondId === bond._id.toHexString()
        );
        if (dueClaims.length > 0) {
          await settleBankSovereignClaims(db, budgetWithClaims, turn);
          budgetWithClaims = await db
            .collection<FederalBudget>("federalBudget")
            .findOne(
              { _id: budgetId },
              { projection: { _id: 1, countryId: 1, bankSovereignClaims: 1 } }
            );
          if (
            budgetWithClaims?.bankSovereignClaims?.some(
              (claim) => claim.kind === "maturity" && claim.bondId === bond._id.toHexString()
            )
          )
            return null;
        }
      }
      // Claims returned by this attempt or removed by an earlier completed
      // receipt both represent bank lots already paid from funded Treasury cash.
      void newClaims;

      let fundedSettlement = await settleFundedSovereignBondMaturity(db, {
        bond,
        turn,
        dueTurn: bond.maturityTurn,
        currencyCode: bondCcy,
        treasuryLocalPerAnchor: treasuryValuation.anchorRate,
        nonBankRepaymentLocal,
        holderLegs,
        now,
      });
      if (
        fundedSettlement?.status === "partial" ||
        (fundedSettlement?.status === "replayed" && fundedSettlement.error)
      )
        fundedSettlement = await resumeSettlement(db, fundedSettlement.key);
      if (
        !fundedSettlement ||
        (fundedSettlement.status !== "applied" &&
          !(fundedSettlement.status === "replayed" && !fundedSettlement.error))
      )
        return null;

      // A forced rollover moved the pool's face to a replacement bond, so that
      // face was never paid out of Treasury cash.
      const paidLocal = nonBankRepaymentLocal - (await readForcedRolloverFaceLocal(db, bond));

      return [
        ...maturityEntries,
        {
          type: "gov_bond_maturity_payment",
          turn,
          createdAt: now,
          subjectType: "government",
          countryId: countryId,
          amount: -paidLocal,
          currencyCode: bondCcy,
          anchorAmount: -paidLocal / treasuryValuation.anchorRate,
          meta: {
            bondId: bond._id.toHexString(),
            units: paidLocal / BOND_UNIT_FACE_VALUE,
            couponRate: bond.couponRate,
            treasuryCashMovement: true,
            ...treasuryValuation,
          },
        },
      ];
    });
  };
  const settledSovereign = new Map<string, PartialTxEntry[] | null>();
  await runInLanes(
    interleaveByKey(dueSovereignBonds, (bond) => bond.countryId ?? ""),
    SOVEREIGN_MATURITY_LANES,
    async (bond) => {
      settledSovereign.set(bond._id.toHexString(), await settleDueSovereignBond(bond));
    }
  );

  for (const bond of maturedBonds) {
    if (
      config?.treasuryCashLedgerEnabled === true &&
      sovereignMaturityCandidateIds.has(bond._id.toHexString()) &&
      bond.countryId
    ) {
      const entries = settledSovereign.get(bond._id.toHexString());
      if (entries) {
        txBondEntries.push(...entries);
        bondsMatured++;
      }
      continue;
    }
    // `units × BOND_UNIT_FACE_VALUE` produces LOCAL (bond.currencyCode per
    // Task-18B). Normalize LOCAL → ₳ once per bond so both holder payouts
    // (addCharPayment re-multiplies by the bond's own FX) and issuer repayment
    // (anchorToCorpCapital expects ₳) are fed in the unit they contract for.
    const bondCcy = resolveBondCurrency(bond);
    const bondFxRate = fxByCurrency.get(bondCcy) ?? 1;
    const faceValueUnitAnchor = corpCapitalToAnchor(BOND_UNIT_FACE_VALUE, bondCcy, bondFxRate);

    // Pool-held units are redeemed at face like every other holding. The
    // corporate issuer was debited for them in Phase 2; the sovereign budget
    // retires them in settleSovereignBondMaturity below.
    if (bond.publicFloat > 0) {
      addPoolCredit(
        bondPoolCurrency(bond),
        "maturitiesIn",
        bond.publicFloat * BOND_UNIT_FACE_VALUE
      );
    }

    // Return face value to each holder
    for (const holder of bond.holders) {
      const faceValueReturnAnchor = holder.units * faceValueUnitAnchor;

      if (holder.characterId) {
        addCharPayment(holder.characterId.toString(), faceValueReturnAnchor, bondCcy);
        const fxRate = fxByCurrency.get(bondCcy) ?? 1;
        const localAmount = faceValueReturnAnchor * (fxRate > 0 ? fxRate : 1);
        txBondEntries.push({
          type: "bond_maturity",
          turn,
          createdAt: now,
          subjectType: "character",
          subjectId: holder.characterId,
          charId: holder.characterId.toString(),
          amount: localAmount,
          currencyCode: bondCcy,
          meta: { bondId: String(bond._id), units: holder.units, couponRate: bond.couponRate },
        });
      } else if (holder.imperialCharacterId) {
        addImperialPayment(holder.imperialCharacterId.toString(), faceValueReturnAnchor, bondCcy);
        const fxRate = fxByCurrency.get(bondCcy) ?? 1;
        const localAmount = faceValueReturnAnchor * (fxRate > 0 ? fxRate : 1);
        txBondEntries.push({
          type: "bond_maturity",
          turn,
          createdAt: now,
          subjectType: "character",
          subjectId: holder.imperialCharacterId,
          charId: holder.imperialCharacterId.toString(),
          isImperial: true,
          amount: localAmount,
          currencyCode: bondCcy,
          meta: {
            bondId: String(bond._id),
            units: holder.units,
            couponRate: bond.couponRate,
            imperial: true,
          },
        });
      } else if (holder.fundId) {
        const maturityAnchor = addFundPayment(holder.fundId.toString(), faceValueReturnAnchor);
        // #992 tranche 4: same fund-subject treatment as the coupon leg above.
        const maturityFundIdStr = holder.fundId.toString();
        const maturityFundCcy = fundLedgerCurrency(maturityFundIdStr);
        if (maturityFundCcy) {
          txBondEntries.push({
            type: "bond_maturity",
            turn,
            createdAt: now,
            subjectType: "fund",
            subjectId: holder.fundId,
            amount: maturityAnchor,
            anchorAmount: maturityAnchor,
            currencyCode: maturityFundCcy,
            meta: {
              bondId: String(bond._id),
              units: holder.units,
              couponRate: bond.couponRate,
              fundId: maturityFundIdStr,
              fundCurrency: maturityFundCcy,
              unroundedAnchorAmount: faceValueReturnAnchor,
              roundingMethod: "cumulative_fund_credit",
            },
          });
        } else {
          const fxRate = fxByCurrency.get(bondCcy) ?? 1;
          const localAmount = faceValueReturnAnchor * (fxRate > 0 ? fxRate : 1);
          txBondEntries.push({
            type: "bond_maturity",
            turn,
            createdAt: now,
            subjectType: "corporation",
            subjectId: holder.fundId,
            amount: localAmount,
            currencyCode: bondCcy,
            meta: {
              bondId: String(bond._id),
              units: holder.units,
              couponRate: bond.couponRate,
              fundId: maturityFundIdStr,
            },
          });
        }
      } else if (holder.corporationId) {
        // Corp-holder maturity credit was applied in Phase 1.5 / Phase 2 so it
        // could enter the default check; we only emit the ledger row here.
        const key = holder.corporationId.toString();
        const bondLocalAmount = faceValueReturnAnchor * (bondFxRate > 0 ? bondFxRate : 1);
        const holderCorp = corpMap.get(key);
        const holderCurrency = (resolveCorpLiquidCurrencyCode(holderCorp) ?? "USD") as CurrencyCode;
        const holderFxRate = fxRateForCorpFromMap(holderCorp, fxByCurrency);
        const holderLocalAmount = anchorToCorpCapital(
          faceValueReturnAnchor,
          resolveCorpLiquidCurrencyCode(holderCorp),
          holderFxRate
        );
        txBondEntries.push({
          type: "bond_maturity",
          turn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: holder.corporationId,
          amount: Math.round(holderLocalAmount * 100) / 100,
          currencyCode: holderCurrency,
          meta: {
            bondId: String(bond._id),
            units: holder.units,
            couponRate: bond.couponRate,
            bondCurrency: bondCcy,
            bondAmount: Math.round(bondLocalAmount * 100) / 100,
          },
        });
      } else if (holder.nppId) {
        // v3 autonomous NPP bondholder maturity face-value return.
        addNppPayment(holder.nppId.toString(), faceValueReturnAnchor, bondCcy, "maturity");
      }
    }

    if (isCorporateBond(bond)) {
      const totalUnitsOutstanding =
        bond.holders.reduce((sum, h) => sum + h.units, 0) + bond.publicFloat;
      const totalRepaymentAnchor = totalUnitsOutstanding * faceValueUnitAnchor;
      const issuer = corpMap.get(bond.corporationId.toString());
      const repaymentLocal = anchorToCorpCapital(
        totalRepaymentAnchor,
        resolveCorpLiquidCurrencyCode(issuer),
        fxRateForCorpFromMap(issuer, fxByCurrency)
      );
      // Issuer was already debited in Phase 2 via the unified delta; the
      // ledger row + notification still belong here for double-entry symmetry
      // with the holder rows below.

      // Issuer-side ledger row mirrors the holder-side rows above: every
      // corp-bond maturity is now double-entry visible. Pre-fix the issuer's
      // liquidCapital decrement was silent, so wealth-list reconciliation and
      // the suspect-flag scan undercounted issuer outflows by face × units.
      txBondEntries.push({
        type: "bond_maturity",
        turn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: bond.corporationId,
        amount: -Math.round(repaymentLocal * 100) / 100,
        // USD fallback when corp lacks both `liquidCurrencyCode` and a
        // recognized `countryId` — avoids `currencyCode: undefined`.
        currencyCode: (resolveCorpLiquidCurrencyCode(issuer) ?? "USD") as CurrencyCode,
        meta: {
          bondId: String(bond._id),
          units: totalUnitsOutstanding,
          couponRate: bond.couponRate,
          source: "issuer_repayment",
        },
      });

      if (!natcorpIds.has(bond.corporationId.toString()) && issuer?.userId) {
        const currency = resolveCorpLiquidCurrencyCode(issuer);
        const amountLabel = Math.round(repaymentLocal).toLocaleString("en-US");
        notifications.push({
          userId: issuer.userId,
          type: "corp_bond_repaid",
          title: "Corporate bond matured",
          message: `${issuer.name}: principal was repaid this turn (about ${amountLabel} ${currency} debited from cash on hand). Charts use end-of-turn balances, so the drop matches bond settlement.`,
          metadata: {
            bondId: bond._id.toString(),
            corporationId: bond.corporationId.toString(),
            ...(issuer.sequentialId != null
              ? { corporationSequentialId: issuer.sequentialId }
              : {}),
            repaymentAnchor: totalRepaymentAnchor,
            repaymentLocal: Math.round(repaymentLocal * 100) / 100,
            currency,
          },
        });
      }
    } else if (bond.countryId) {
      const sovereignTotalUnits =
        bond.holders.reduce((sum, h) => sum + h.units, 0) +
        bond.publicFloat +
        (bond.centralBankHoldings ?? 0);
      // BOND_UNIT_FACE_VALUE is the per-unit face in the bond's LOCAL currency
      // (post-Task-18B), so `units * BOND_UNIT_FACE_VALUE` is already in
      // bondCcy — do NOT FX-convert here. Compare to the corporate-bond branch
      // above which uses `repaymentLocal` (already issuer-local-converted).
      const sovereignRepaymentLocal = sovereignTotalUnits * BOND_UNIT_FACE_VALUE;
      // Use the authoritative treasury snapshot valuation, including historical
      // budget-only rates. Validate before the cash operation lands.
      const valuation = poolLedgerContext
        ? treasuryAnchorValuation({
            countryId: bond.countryId,
            currencyCode: bondCcy,
            preset: gameState?.preset ?? DEFAULT_SEED_PRESET,
            observedRate: authoritativeRates?.get(bondCcy),
          })
        : undefined;
      const budgetId = getNationalBudgetId(bond.countryId);
      const bankMaturityClaims = await addBankMaturityClaims(db, {
        budgetId,
        countryId: bond.countryId,
        currencyCode: bondCcy,
        turn,
        bond,
        anchorRate: valuation?.anchorRate,
        ledgerShadow: poolLedgerContext !== null,
        treasuryCashLedgerEnabled: config?.treasuryCashLedgerEnabled === true,
      });
      const bankRepaymentLocal = bankMaturityClaims.reduce(
        (sum, claim) => sum + claim.amountLocal,
        0
      );
      const settlement = await settleSovereignBondMaturity(
        db,
        bond,
        sovereignRepaymentLocal,
        bankRepaymentLocal
      );
      // Missing or concurrently removed budgets do not create phantom cash history.
      if (!settlement || settlement.amountLocal === 0) continue;
      let bankMaturityPaidLocal = 0;
      if (bankMaturityClaims.length > 0) {
        const budgetWithClaims = await db
          .collection<FederalBudget>("federalBudget")
          .findOne({ _id: budgetId }, { projection: { countryId: 1, bankSovereignClaims: 1 } });
        if (budgetWithClaims?.bankSovereignClaims?.length) {
          const paid = await settleBankSovereignClaims(db, budgetWithClaims, turn);
          bankMaturityPaidLocal = bankMaturityClaims
            .filter((claim) => paid.paidClaimIds.includes(claim.id))
            .reduce((sum, claim) => sum + claim.amountLocal, 0);
        }
      }
      const treasuryCashPaidLocal =
        settlement.amountLocal - bankRepaymentLocal + bankMaturityPaidLocal;
      sovereignMaturityCashPaidByCountry.set(
        bond.countryId,
        (sovereignMaturityCashPaidByCountry.get(bond.countryId) ?? 0) + treasuryCashPaidLocal
      );
      sovereignDebtFaceRetiredByCountry.set(
        bond.countryId,
        (sovereignDebtFaceRetiredByCountry.get(bond.countryId) ?? 0) +
          sovereignBondOutstanding({
            issuerType: "sovereign",
            matured: false,
            defaulted: false,
            totalIssued: bond.totalIssued,
            restructureHaircutPercent: bond.restructureHaircutPercent ?? null,
          })
      );
      txBondEntries.push({
        type: "gov_bond_maturity_payment",
        turn,
        createdAt: now,
        subjectType: "government",
        countryId: bond.countryId,
        amount: -treasuryCashPaidLocal,
        currencyCode: settlement.currencyCode,
        ...(valuation ? { anchorAmount: -treasuryCashPaidLocal / valuation.anchorRate } : {}),
        meta: {
          bondId: String(bond._id),
          units: treasuryCashPaidLocal / BOND_UNIT_FACE_VALUE,
          couponRate: bond.couponRate,
          treasuryCashMovement: true,
          ...(valuation ?? {}),
        },
      });
    }
  }

  // ── Phase 6: Apply all bulk writes ────────────────────────────────────────
  if (bondOps.length > 0) {
    await db.collection("bonds").bulkWrite(bondOps);
  }

  await withBondPoolLedgerBatch(db, poolLedgerContext, async (batch) => {
    for (const [currency, credit] of poolCreditsLocal) {
      await creditBondPool(db, currency, credit.couponsIn, "couponsIn", now, {
        ledgerContext: batch,
      });
      await creditBondPool(db, currency, credit.maturitiesIn, "maturitiesIn", now, {
        ledgerContext: batch,
      });
    }
  });

  if (fundPaymentsAnchor.size > 0) {
    const fundPaymentOps = [...fundPaymentsAnchor]
      .filter(([, amountAnchor]) => amountAnchor > 0)
      .map(([fundIdStr, amountAnchor]) => ({
        updateOne: {
          filter: { _id: new ObjectId(fundIdStr) },
          update: {
            $inc: { cashAnchor: Math.round(amountAnchor * 100) / 100 },
            $set: { updatedAt: now },
          },
        },
      }));
    if (fundPaymentOps.length > 0) {
      await db.collection("indexFunds").bulkWrite(fundPaymentOps);
    }
  }

  // v3: credit autonomous NPP bondholders (coupons + maturity returns) to their
  // personal forex account (nppInvestmentCashAnchor, ₳) — investment returns,
  // NOT campaign funds. Isolated bulkWrite — no LoC garnish / national
  // accounting (mirrors the NPP investment-account isolation).
  if (nppPaymentsAnchor.size > 0) {
    await payNppBondReturns(db, nppReturnKinds, turn, now);
  }

  // Pay character coupon income (in the bond's issuing country currency).
  // First, garnish income for distressed LOC borrowers — redirected coupons
  // never touch their wallet, going straight to LOC arrears/principal.
  if (charPayments.size > 0) {
    await garnishLocFromIncome(db, charPayments, turn, "bond_coupon");
  }
  if (charPayments.size > 0) {
    const charOps: AnyBulkWriteOperation<Character>[] = [];
    for (const [charIdStr, currencyAmounts] of charPayments) {
      for (const [currency, amount] of currencyAmounts) {
        charOps.push(
          buildPersonalBalanceBulkOp(
            new ObjectId(charIdStr),
            amount,
            currency,
            forexEnabled
          ) as AnyBulkWriteOperation<Character>
        );
      }
    }
    if (charOps.length > 0) await db.collection<Character>("characters").bulkWrite(charOps);

    // Auto-convert bond income (coupons + maturity returns) to each holder's
    // home currency. One trade per (character, foreign currency) aggregating all
    // bond payments received in that currency this turn — contributes to forex
    // volume pressure. Gated on forexEnabled.
    if (forexEnabled) {
      const couponCharIds = [...charPayments.keys()].map((id) => new ObjectId(id));
      const couponChars = await db
        .collection<Character>("characters")
        .find({ _id: { $in: couponCharIds } })
        .toArray();
      const charById = new Map(couponChars.map((c) => [c._id.toString(), c]));

      for (const [charIdStr, currencyAmounts] of charPayments) {
        const char = charById.get(charIdStr);
        if (!char) continue;
        const homeCurrency = getHomeCurrency(char);
        for (const [currency, amount] of currencyAmounts) {
          if (currency === homeCurrency || amount <= 0) continue;
          await executeMarketMakerTrade(db, {
            characterId: char._id,
            countryId: char.countryId as CountryId,
            fromCurrency: currency,
            toCurrency: homeCurrency,
            amount,
            turn,
            source: "auto_coupon",
            quoteContext,
          });
        }
      }
    }
  }

  // Pay imperial character coupon/maturity income
  if (imperialPayments.size > 0) {
    const imperialOps: AnyBulkWriteOperation<ImperialCharacter>[] = [];
    for (const [imperialIdStr, currencyAmounts] of imperialPayments) {
      for (const [currency, amount] of currencyAmounts) {
        imperialOps.push(
          buildPersonalBalanceBulkOp(
            new ObjectId(imperialIdStr),
            amount,
            currency,
            forexEnabled
          ) as AnyBulkWriteOperation<ImperialCharacter>
        );
      }
    }
    await db.collection<ImperialCharacter>("imperialCharacters").bulkWrite(imperialOps);
  }

  // Corporate holder coupon income + maturity face-value returns were already
  // applied in Phase 2 (the unified per-corp delta) so they could enter the
  steps.mark("defaultsAndRollback");
  // Phase 3 default check. Newly-defaulted issuers' maturity flows are rolled
  // back in Phase 3.5 — by here the corp ledger is fully settled.

  // ── Phase 7: Snapshot bond price history ───────────────────────────────────
  const bondHistorySnapshots = await snapshotBondHistory({
    db,
    activeBonds,
    fxByCurrency,
    turn,
    now,
  });

  // Emit bond_coupon / bond_maturity for character holders + gov_coupon_payment
  await emitBondTurnLedger({ db, txBondEntries, govCouponByCountry, turn, now });

  // Flush bond-issuer notifications (due-soon reminders + maturity confirms)
  // collected during phases 4 and 5. Single insertMany instead of one
  // insertOne per fan-out point.
  await createNotifications(notifications);

  // Route the FX spreads skimmed from corp foreign-coupon income into the CB
  // system (reserve slice → recipient corp's CB; revenue → bond-currency CB),
  // matching how player auto_coupon conversions build reserves.
  await distributeConversionSpreadsBatch(
    db,
    corpCouponSpreadFees.map(({ fromCurrency, toCurrency, fee }) => ({
      fromCurrency,
      toCurrency,
      fee: Math.round(fee),
    }))
  );

  // ── Phase 7: Auto-resolve lingering corporate defaults ─────────────────────
  // See autoResolveLingeringDefaults in ./bondTurnAutoResolve for the
  // refinance → restructure → stand-for-dissolution resolution order. Flushes
  // its own CEO notifications before returning.
  //
  // Also skipped while corporation actions are paused (#1198), and for a
  // sharper reason than Phase 3. This phase can SELL a corporation's sectors,
  // and it justifies that by saying the CEO "has already had at least one turn"
  // to act in the crisis modal. During a pause they have had no such turn: all
  // four cure routes (cash, refinance, restructure, dissolve) are gated on
  // `requireCorporationActionsEnabled` and return an error. Counting paused
  // turns against the CEO's response window, then force-selling their assets
  // for missing a deadline they were locked out of, is not a defensible
  // outcome. The clock resumes when corporations do.
  const { bondsAutoRestructured, bondsAutoRefinanced } = corporationActionsPaused
    ? { bondsAutoRestructured: 0, bondsAutoRefinanced: 0 }
    : await autoResolveLingeringDefaults({ db, turn, now });
  const sovereignFlows = captureSovereignCashProceeds
    ? sovereignIssuanceFlowsByCountry({
        atParIssues,
        placements: [...placement.sovereignFaceByCountry].map(([countryId, row]) => ({
          countryId,
          face: row.face,
          cashPaid: row.cashPaid,
        })),
      })
    : null;

  steps.mark("snapshotsLedgerNotify");
  return {
    bondsProcessed: activeBonds.length,
    couponsPaid,
    bondsMatured,
    bondsDefaulted,
    totalCouponsPaid: Math.round(totalCouponsPaid * 100) / 100,
    bondHistorySnapshots,
    bondsAutoRestructured,
    bondsAutoRefinanced,
    ...(sovereignFlows
      ? {
          sovereignCashProceedsByCountry: Object.fromEntries(
            Object.entries(sovereignFlows).map(([countryId, flow]) => [countryId, flow.cash])
          ),
          sovereignDebtFaceIssuedByCountry: Object.fromEntries(
            Object.entries(sovereignFlows).map(([countryId, flow]) => [countryId, flow.face])
          ),
          sovereignCouponPaidByCountry: Object.fromEntries(
            [...govCouponByCountry].map(([countryId, row]) => [countryId, row.total])
          ),
          sovereignMaturityCashPaidByCountry: Object.fromEntries(
            sovereignMaturityCashPaidByCountry
          ),
          sovereignDebtFaceRetiredByCountry: Object.fromEntries(sovereignDebtFaceRetiredByCountry),
        }
      : {}),
  };
}
