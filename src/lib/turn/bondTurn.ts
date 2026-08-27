import { getDb } from "@/lib/mongodb";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import type { Bond, Corporation, CentralBank, Character, NPP } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  BOND_DEFAULT_CREDIT_PENALTY_TURNS,
  CORP_BOND_DUE_SOON_REMINDER_TURNS,
  calculateBondMarketPrice,
  calculateCreditScore,
  getBondCouponRate,
  perTurnCouponPayment,
} from "@/lib/constants/bonds";
import {
  getBondCountryId,
  isCorporateBond,
  issueScheduledSovereignBondSeries,
  settleSovereignBondMaturity,
} from "@/lib/bonds/sovereign";
import { buildPersonalBalanceBulkOp, getHomeCurrency } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getGameState } from "@/lib/gameState";
import { executeMarketMakerTrade, distributeConversionSpread } from "@/lib/currency/marketMaker";
import { garnishLocFromIncome } from "@/lib/lineOfCredit/garnishment";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP, MARKET_MAKER_SPREAD } from "@/lib/constants/currencies";
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
}

/**
 * Process all active bonds each turn:
 * 1. Pay coupon interest to bond holders (per-turn fraction of annual coupon)
 * 2. Update market prices based on current interest rates and time to maturity
 * 3. Check for defaults (corporation liquidCapital < 0 after coupon payments)
 * 4. Settle matured bonds (return face value to holders)
 */
export async function processBondTurn(turn: number): Promise<BondTurnResult> {
  const db = await getDb();
  const now = new Date();
  const forexEnabled = await isForexEnabled();
  // #1198: gates default DETECTION only, in Phase 3. Coupon and maturity
  // settlement runs regardless — see the comment there for why the two are
  // treated differently.
  const corporationActionsPaused = (await getGameState(db))?.corporationActionsPaused === true;

  await db
    .collection("corporations")
    .updateMany(
      { bondDefaultCreditPenaltyUntilTurn: { $lte: turn } },
      { $unset: { bondDefaultCreditPenaltyUntilTurn: "" }, $set: { updatedAt: now } }
    );

  await issueScheduledSovereignBondSeries(db, turn, now);
  await processSovereignImfFacilityPayments(db, turn);
  await processSovereignRecoveryTurn(db, turn);
  // Auto-repudiate countries whose executive decision window has expired
  // (crisisAutoActionAt <= now AND sovereignCrisisState === "crisisPending").
  // Must run before legislativeTurn so countries resolved here are not double-processed.
  await processCrisisAutoActions(db, Date.now(), turn);
  await processSovereignLegislativeTurn(db, Date.now(), turn);

  const activeBonds = await db.collection<Bond>("bonds").find({ matured: false }).toArray();

  if (activeBonds.length === 0) {
    return {
      bondsProcessed: 0,
      couponsPaid: 0,
      bondsMatured: 0,
      bondsDefaulted: 0,
      totalCouponsPaid: 0,
      bondHistorySnapshots: 0,
      bondsAutoRestructured: 0,
      bondsAutoRefinanced: 0,
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
  const fxByCurrency = await loadFxRatesByCurrency(db);

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
  function addFundPayment(fundIdStr: string, paymentAnchor: number) {
    if (paymentAnchor <= 0) return;
    fundPaymentsAnchor.set(fundIdStr, (fundPaymentsAnchor.get(fundIdStr) ?? 0) + paymentAnchor);
  }
  // v3 autonomous NPP bondholders: coupon/maturity are INVESTMENT returns, so
  // they accumulate in ₳ (anchor) and credit the personal forex account
  // (`nppInvestmentCashAnchor`) — NOT the campaign war chest. No LoC garnish /
  // tx-log / national accounting (mirrors the NPP investment-account isolation).
  const nppPaymentsAnchor = new Map<string, number>(); // nppId -> coupon/maturity (₳)
  function addNppPayment(nppIdStr: string, amountAnchor: number, _bondCurrency: CurrencyCode) {
    if (amountAnchor <= 0) return;
    nppPaymentsAnchor.set(nppIdStr, (nppPaymentsAnchor.get(nppIdStr) ?? 0) + amountAnchor);
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
    if (bond.defaulted) continue;

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
        addFundPayment(holder.fundId.toString(), paymentAnchor);
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
            fundId: holder.fundId.toString(),
          },
        });
      } else if (holder.corporationId) {
        const key = holder.corporationId.toString();
        const holderCorp = corpMap.get(key);
        const holderCurrency = (resolveCorpLiquidCurrencyCode(holderCorp) ?? "USD") as CurrencyCode;
        // Foreign coupon income converts into the corp's home currency — charge
        // the same FX spread players pay, skimmed before crediting.
        const couponSpreadAnchor =
          forexEnabled && bondCcy !== holderCurrency ? paymentAnchor * MARKET_MAKER_SPREAD : 0;
        corpPayments.set(key, (corpPayments.get(key) ?? 0) + (paymentAnchor - couponSpreadAnchor));
        if (couponSpreadAnchor > 0) {
          corpCouponSpreadFees.push({
            fromCurrency: bondCcy,
            toCurrency: holderCurrency,
            fee: localAmountForTx * MARKET_MAKER_SPREAD,
          });
        }
        const holderFxRate = fxRateForCorpFromMap(holderCorp, fxByCurrency);
        const holderLocalAmount = anchorToCorpCapital(
          paymentAnchor,
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
          },
        });
      } else if (holder.nppId) {
        // v3 autonomous NPP bondholder coupon (home-currency only, no tx-log).
        addNppPayment(holder.nppId.toString(), paymentAnchor, bondCcy);
      }

      totalCouponsPaid += paymentAnchor;
      couponsPaid++;
    }

    if (isCorporateBond(bond)) {
      // Also pay coupon to "public float" holders implicitly (AI market maker absorbs)
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
          { bondDefaultCreditPenaltyActive: !!penaltyActive }
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
  for (const bond of maturedBonds) {
    // `units × BOND_UNIT_FACE_VALUE` produces LOCAL (bond.currencyCode per
    // Task-18B). Normalize LOCAL → ₳ once per bond so both holder payouts
    // (addCharPayment re-multiplies by the bond's own FX) and issuer repayment
    // (anchorToCorpCapital expects ₳) are fed in the unit they contract for.
    const bondCcy = resolveBondCurrency(bond);
    const bondFxRate = fxByCurrency.get(bondCcy) ?? 1;
    const faceValueUnitAnchor = corpCapitalToAnchor(BOND_UNIT_FACE_VALUE, bondCcy, bondFxRate);

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
        addFundPayment(holder.fundId.toString(), faceValueReturnAnchor);
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
            fundId: holder.fundId.toString(),
          },
        });
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
        addNppPayment(holder.nppId.toString(), faceValueReturnAnchor, bondCcy);
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
      await settleSovereignBondMaturity(db, bond);
      // Government-side ledger row: pairs with the holder-side bond_maturity
      // rows above so a sovereign bond's principal repayment is double-entry
      // visible. settleSovereignBondMaturity adjusts federal-budget debt but
      // doesn't track the cash event in financialTxLog itself.
      const sovereignTotalUnits =
        bond.holders.reduce((sum, h) => sum + h.units, 0) +
        bond.publicFloat +
        (bond.centralBankHoldings ?? 0);
      // BOND_UNIT_FACE_VALUE is the per-unit face in the bond's LOCAL currency
      // (post-Task-18B), so `units * BOND_UNIT_FACE_VALUE` is already in
      // bondCcy — do NOT FX-convert here. Compare to the corporate-bond branch
      // above which uses `repaymentLocal` (already issuer-local-converted).
      const sovereignRepaymentLocal = sovereignTotalUnits * BOND_UNIT_FACE_VALUE;
      txBondEntries.push({
        type: "gov_bond_maturity_payment",
        turn,
        createdAt: now,
        subjectType: "government",
        countryId: bond.countryId,
        amount: -sovereignRepaymentLocal,
        currencyCode: bondCcy,
        meta: {
          bondId: String(bond._id),
          units: sovereignTotalUnits,
          couponRate: bond.couponRate,
        },
      });
    }
  }

  // ── Phase 6: Apply all bulk writes ────────────────────────────────────────
  if (bondOps.length > 0) {
    await db.collection("bonds").bulkWrite(bondOps);
  }

  if (fundPaymentsAnchor.size > 0) {
    for (const [fundIdStr, amountAnchor] of fundPaymentsAnchor) {
      if (amountAnchor <= 0) continue;
      await db.collection("indexFunds").updateOne(
        { _id: new ObjectId(fundIdStr) },
        {
          $inc: { cashAnchor: Math.round(amountAnchor * 100) / 100 },
          $set: { updatedAt: now },
        }
      );
    }
  }

  // v3: credit autonomous NPP bondholders (coupons + maturity returns) to their
  // personal forex account (nppInvestmentCashAnchor, ₳) — investment returns,
  // NOT campaign funds. Isolated bulkWrite — no LoC garnish / national
  // accounting (mirrors the NPP investment-account isolation).
  if (nppPaymentsAnchor.size > 0) {
    const nppOps = [...nppPaymentsAnchor.entries()].map(([nppIdStr, amountAnchor]) => ({
      updateOne: {
        filter: { _id: new ObjectId(nppIdStr) },
        update: {
          $inc: { nppInvestmentCashAnchor: Math.round(amountAnchor * 100) / 100 },
          $set: { updatedAt: now },
        },
      },
    }));
    if (nppOps.length > 0) await db.collection<NPP>("npps").bulkWrite(nppOps);
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
  for (const { fromCurrency, toCurrency, fee } of corpCouponSpreadFees) {
    await distributeConversionSpread(db, Math.round(fee), fromCurrency, toCurrency);
  }

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

  return {
    bondsProcessed: activeBonds.length,
    couponsPaid,
    bondsMatured,
    bondsDefaulted,
    totalCouponsPaid: Math.round(totalCouponsPaid * 100) / 100,
    bondHistorySnapshots,
    bondsAutoRestructured,
    bondsAutoRefinanced,
  };
}
