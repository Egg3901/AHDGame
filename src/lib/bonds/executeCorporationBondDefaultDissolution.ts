import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Bond, Character, Corporation, CorporateSector, CentralBank } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc, getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { bondPoolCurrency, debitBondPoolUpTo } from "@/lib/bonds/marketPool";
import {
  applyBondDissolutionSpend,
  buildBondDissolutionFingerprint,
  getBondDissolutionCompletedOutcome,
  resumeBondDissolutionByKey,
  type BondDissolutionFundCredit,
  type BondDissolutionHolderCredit,
  type BondDissolutionOutcome,
  type BondDissolutionPoolCredit,
} from "@/lib/bonds/bondDissolutionSpend";
import {
  allocateShareholderPool,
  buildPrimeRateMap,
  computeSectorNpvSum,
  previewDissolveSettlement,
  type ShareholderPayoutRow,
  type CorporateShareholderPayoutRow,
  type PublicFloatPayoutRow,
} from "@/lib/bonds/corporateBondDefault";
import { getBankId } from "@/lib/centralBank/helpers";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { getGameState } from "@/lib/gameState";
import { sumSectorBookValueAnchor } from "@/lib/corporations/sectorProfitBasis";
import { writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";
import {
  cleanupShareMarketActivityForCorporations,
  cleanupShareMarketActivityForCorporationTargets,
} from "@/lib/corporations/cleanupShareMarketActivity";
import { logWireEvent, wireHeadlineCorpDissolved } from "@/lib/wireEvent";
import { badRequest } from "@/lib/api/errors";
import { releaseCorporationHeldSharesToFloat } from "@/lib/corporations/releaseHeldSharesToFloat";
import { distributeCrossEquityInKind } from "@/lib/corporations/distributeCrossEquityInKind";
import { restoreSectorsToUnowned } from "@/lib/corporations/restoreSectorsToUnowned";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

export interface CorporationDissolutionResult {
  bondRecoveryPool: number;
  shareholderPool: number;
  shareholderPayouts: ShareholderPayoutRow[];
  /** Pro-rata payouts to corporate equity shareholders (credited to liquidCapital). */
  corporateShareholderPayouts: CorporateShareholderPayoutRow[];
  /** Pro-rata payout for the publicFloat slice (credited to the country's central bank reserve). */
  publicFloatPayout: PublicFloatPayoutRow | null;
  totalPayoutToPeople: number;
}

/**
 * Deterministic stable key for a shareholder-vote dissolution (issue #1672).
 * Votes apply once, so the vote id alone identifies the event; a retry of the
 * same vote (turn re-drive, route retry) resumes the stored plan instead of
 * paying again. Distinct votes never share a key.
 */
export function bondDissolutionKeyForVote(voteId: ObjectId): string {
  return `bond-dissolution:vote:${voteId.toHexString()}`;
}

/**
 * Deterministic stable key for the character-deletion cascade (issue #1672).
 * The corp is deleted by the flow, so one key per corp can never cover two
 * genuine events; a repeated cascade for the same corp replays instead of
 * duplicating value.
 */
export function bondDissolutionKeyForCascade(corpId: ObjectId): string {
  return `bond-dissolution:cascade:${corpId.toHexString()}`;
}

/**
 * Deterministic stable key for the NPP-insolvency turn dissolution
 * (issue #1672). Deliberately STABLE ACROSS TURNS (no turn component, unlike
 * the refinance/restructure per-turn keys): a crash mid-dissolution leaves
 * the corp in place for next turn's scan, and a new key there would pay every
 * holder a second time. The same key resumes the stored plan at exactly the
 * attempted amounts; the corp's deletion ends the key's life, so it can never
 * cover a second genuine event.
 */
export function bondDissolutionKeyForNpp(corpId: ObjectId): string {
  return `bond-dissolution:npp:${corpId.toHexString()}`;
}

/**
 * Map a stored dissolution outcome back onto the executor result contract.
 * The stored shape is exactly the route/executor result plus corp identity,
 * so the resume path rebuilds it verbatim.
 */
function outcomeToResult(outcome: BondDissolutionOutcome): CorporationDissolutionResult {
  return {
    bondRecoveryPool: outcome.bondRecoveryPool,
    shareholderPool: outcome.shareholderPool,
    shareholderPayouts: outcome.shareholderPayouts.map((row) => ({ ...row })),
    corporateShareholderPayouts: outcome.corporateShareholderPayouts.map((row) => ({ ...row })),
    publicFloatPayout: outcome.publicFloatPayout ? { ...outcome.publicFloatPayout } : null,
    totalPayoutToPeople: outcome.totalPayoutToPeople,
  };
}

/**
 * Full bond-default dissolution: pay bondholders and shareholders from LC + sector NPV,
 * delete bonds/sectors/corporation, cancel orders. Shared by CEO dissolve and admin force-liquidate.
 *
 * Crash-safe settlement (issue #1672): the per-bond market-pool recovery
 * shares plus one resumable credit per character / imperial / corp-creditor /
 * corp-equity / central-bank / index-fund payee run as exactly-once money
 * flow via {@link applyBondDissolutionSpend}. The caller-owned pre-phase
 * (creditor-bond liquidation into liquidCapital, in-kind cross-equity
 * distribution, settlement snapshot) runs BEFORE the flow and stays outside
 * it; the financial-tx audit rows stay post-commit best effort; the terminal
 * ownership cleanup (bond/history deletes, sector restore, share release,
 * corp delete) re-runs as a naturally idempotent pass.
 */
export async function executeCorporationBondDefaultDissolution(
  db: Db,
  corporation: Corporation,
  options: {
    requireDefaultedBonds: boolean;
    /**
     * Idempotency key for the crash-safe money-flow run (issue #1672): the
     * CEO/admin routes forward the client's `Idempotency-Key` header, the
     * vote/cascade/NPP callers pass their deterministic per-event keys.
     * Omit to mint one (crash-safe within the attempt, but a retry mints a
     * new key and is treated as a new attempt).
     */
    idempotencyKey?: string;
    /** Inject the timestamp (routes/tests); defaults to now. */
    now?: Date;
    /** Inject the turn (callers/tests); defaults to the live current turn. */
    currentTurn?: number;
  }
): Promise<CorporationDissolutionResult> {
  if (corporation.countryOwnerId) {
    throw badRequest("National corporations cannot be dissolved here");
  }

  const now = options.now ?? new Date();

  const bonds = await db
    .collection<Bond>("bonds")
    .find({ corporationId: corporation._id, matured: false })
    .toArray();

  if (options.requireDefaultedBonds && !bonds.some((b) => b.defaulted)) {
    // Empty-remainder recovery (issue #1672): a crash after the terminal
    // cleanup started leaves no bonds behind with an `in_progress` receipt,
    // so the next retry under the same key rebuilds an empty live set.
    // Resuming the stored plan finishes it and reports the stored outcome
    // instead of stranding paid holders behind a refusal. Without a key (or
    // with nothing resumable under it) the historical refusal stands;
    // terminal/conflicting receipts keep their error semantics via throw.
    if (options.idempotencyKey !== undefined) {
      const resumed = await resumeBondDissolutionByKey(
        db,
        options.idempotencyKey,
        corporation._id
      );
      if (resumed) {
        const sectors = await db
          .collection<CorporateSector>("corporateSectors")
          .find({ corporationId: corporation._id })
          .toArray();
        await runDissolutionCleanup(
          db,
          corporation,
          sectors,
          bonds.map((b) => b._id),
          now
        );
        return outcomeToResult(resumed.outcome);
      }
    }
    throw badRequest("Bond default dissolution requires at least one defaulted bond");
  }

  const currentTurn = options.currentTurn ?? (await getCurrentTurn(db));
  const forexEnabled = await isForexEnabled();

  const fxByCurrency = await loadFxRatesByCurrency(db);

  await cleanupShareMarketActivityForCorporations(db, [corporation._id], now, forexEnabled);
  await cleanupShareMarketActivityForCorporationTargets(db, [corporation._id], now, forexEnabled);

  // Cash out any non-matured bonds the dissolving corp held as a creditor.
  // These are assets on the corp's balance sheet that must roll into liquidCapital
  // before the settlement snapshot so shareholders receive their full book value.
  const heldCreditorBonds = await db
    .collection<Bond>("bonds")
    .find({ "holders.corporationId": corporation._id, matured: false })
    .toArray();

  const corpFxRateEarly = fxRateForCorpFromMap(corporation, fxByCurrency);
  let assetLiquidationInc = 0;

  // Sell non-matured bonds held as a creditor to the market pool at the
  // current price, for whatever the pool can pay. Pre-pool this credited face
  // value from nowhere.
  if (heldCreditorBonds.length > 0) {
    for (const bond of heldCreditorBonds) {
      const h = bond.holders.find(
        (holder) => holder.corporationId?.toString() === corporation._id.toString()
      );
      if (!h || h.units <= 0) continue;
      const bondCcy = (bond.currencyCode ?? undefined) as CurrencyCode | undefined;
      const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
      const paidLocal = await debitBondPoolUpTo(
        db,
        bondPoolCurrency(bond),
        h.units * BOND_UNIT_FACE_VALUE * (bond.marketPrice ?? 1),
        "estateOut",
        now
      );
      const paidAnchor = corpCapitalToAnchor(paidLocal, bondCcy, bondRate);
      assetLiquidationInc += anchorToCorpLiquidCapital(paidAnchor, corporation, corpFxRateEarly);

      // Return the liquidated units to the issuer's public float so the
      // issuer's debt stays consistent (publicFloat + holderUnits ==
      // totalIssued/face). Pre-fix the $pull dropped the holder without
      // restoring float, orphaning the units on the surviving issuer.
      await db.collection<Bond>("bonds").updateOne(
        { _id: bond._id },
        {
          $pull: { holders: { corporationId: corporation._id } },
          $inc: { publicFloat: h.units },
          $set: { updatedAt: now },
        }
      );
    }
  }

  // Cross-corp equity holdings are distributed IN-KIND, pro-rata, to the
  // dissolving corp's shareholders — NOT cashed out at market price. The old
  // code credited `shares × issuer.sharePrice` into liquidCapital (no
  // counterparty debit), minting pumpable value straight into the settlement
  // pool — the dominant route the money-laundering ring used.
  await distributeCrossEquityInKind(db, corporation, now);

  if (assetLiquidationInc > 0) {
    await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corporation._id },
        { $inc: { liquidCapital: assetLiquidationInc }, $set: { updatedAt: now } }
      );
  }

  const refreshedCorporation =
    (await db.collection<Corporation>("corporations").findOne({ _id: corporation._id })) ??
    corporation;

  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: refreshedCorporation._id })
    .toArray();
  const centralBanks = await db.collection<CentralBank>("centralBanks").find({}).toArray();
  const primeMap = buildPrimeRateMap(centralBanks);
  // D11: under plants the settlement basis is replacement-cost book, not NPV.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  // Only read the year on the path that prices capacity — the legacy NPV path
  // must not take a dependency (or an extra query) it never had.
  const dissolveGameState = plantsEnabled ? await getGameState(db) : null;
  const sectorNpv = computeSectorNpvSum(sectors, primeMap, refreshedCorporation, fxByCurrency, {
    plantsEnabled,
  });
  const sectorBookAnchor = plantsEnabled
    ? sumSectorBookValueAnchor(
        sectors,
        dissolveGameState?.currentYear,
        await loadWorldEraUnitScale(db)
      )
    : 0;
  const corpFxRate = fxRateForCorpFromMap(refreshedCorporation, fxByCurrency);
  // Share-buyback escrow nets into the cash component of the liquidation waterfall:
  // a positive reserve is real corp cash that boosts recoveries; a negative balance
  // (buyback debt) reduces it. Both fields are corp-local, so add before the anchor
  // conversion. previewDissolveSettlement floors the cash term at 0, so a debt
  // beyond liquidCapital is borne by equity (no clawback). The corp is deleted at
  // the end of this routine, so the escrow field is terminal.
  const liquidCapitalAnchor = corpLiquidCapitalToAnchor(
    refreshedCorporation.liquidCapital + (refreshedCorporation.shareEscrowBalance ?? 0),
    refreshedCorporation,
    corpFxRate
  );

  const dissolvePreview = previewDissolveSettlement(
    refreshedCorporation,
    sectorNpv,
    bonds,
    liquidCapitalAnchor,
    fxByCurrency,
    { plantsEnabled, sectorBookAnchor }
  );
  const { bondRecoveryPool, shareholderPool, totalBondClaims } = dissolvePreview;

  // Fetch names for character, imperial, and corporate equity shareholders.
  // Bug #0540: corporate shareholders were previously excluded from payouts;
  // we now distribute to all three buckets plus the publicFloat slice.
  const regularShareholderIds = (refreshedCorporation.shareholders ?? [])
    .map((s) => s.characterId)
    .filter((id): id is ObjectId => id !== undefined);
  const imperialShareholderIds = (refreshedCorporation.shareholders ?? [])
    .map((s) => s.imperialCharacterId)
    .filter((id): id is ObjectId => id !== undefined);
  const corpShareholderIds = (refreshedCorporation.shareholders ?? [])
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
          .collection<Corporation>("corporations")
          .find(
            { _id: { $in: corpShareholderIds } },
            { projection: { _id: 1, name: 1, liquidCurrencyCode: 1, countryId: 1 } }
          )
          .toArray()
      : [],
  ]);

  const nameById = new Map<string, string>([
    ...shareholderChars.map((c) => [c._id.toString(), c.name] as const),
    ...imperialShareholderChars.map((c) => [c._id.toString(), c.name] as const),
    ...corpShareholderDocs.map((c) => [c._id.toString(), c.name] as const),
  ]);
  const corpShareholderById = new Map(corpShareholderDocs.map((c) => [c._id.toString(), c]));
  const allocation = allocateShareholderPool(refreshedCorporation, shareholderPool, nameById);
  const shareholderRows = allocation.characterRows;
  // Ratio is unitless (₳ / ₳ post-A5 fix). Each bond's per-unit face value is
  // denominated in its own `currencyCode` (LOCAL), so convert face to ₳ before
  // multiplying — otherwise `pay` lands in bond-local and the downstream
  // `anchorToLocal(pay, holder.home)` would treat bond-local as ₳, producing
  // ~(bondFxRate × holderFxRate)× over-payment. For a US holder of a defaulted
  // JP corp's bonds that is ~104× the intended payout.
  const ratio = totalBondClaims > 0 ? bondRecoveryPool / totalBondClaims : 0;

  const charBondPay = new Map<string, number>();
  const imperialBondPay = new Map<string, number>();
  const corpBondPay = new Map<string, number>();

  // Crash-safe settlement (issue #1672): every balance write below runs as
  // one keyed step in `applyBondDissolutionSpend`, so collection order here
  // is the step order there (pools, then holders, then funds).
  const poolCredits: BondDissolutionPoolCredit[] = [];
  const holderCredits: BondDissolutionHolderCredit[] = [];
  const fundCredits: BondDissolutionFundCredit[] = [];

  for (const bond of bonds) {
    const bondCcy = (bond.currencyCode ?? undefined) as CurrencyCode | undefined;
    const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
    for (const h of bond.holders) {
      const faceLocal = h.units * BOND_UNIT_FACE_VALUE;
      const faceAnchor = corpCapitalToAnchor(faceLocal, bondCcy, bondRate);
      const pay = Math.round(ratio * faceAnchor * 100) / 100;
      if (pay <= 0) continue;
      if (h.characterId) {
        const k = h.characterId.toString();
        charBondPay.set(k, (charBondPay.get(k) ?? 0) + pay);
      } else if (h.imperialCharacterId) {
        const k = h.imperialCharacterId.toString();
        imperialBondPay.set(k, (imperialBondPay.get(k) ?? 0) + pay);
      } else if (
        h.corporationId &&
        h.corporationId.toString() !== refreshedCorporation._id.toString()
      ) {
        const k = h.corporationId.toString();
        corpBondPay.set(k, (corpBondPay.get(k) ?? 0) + pay);
      }
    }
    // The market pool is a creditor like any other for the units it holds.
    // `totalBondClaims` already counts them (it sums `totalIssued`), so this
    // share of the recovery pool was being burned before. Collected as a
    // keyed pool credit for the crash-safe spend below (same amounts, same
    // order: pool recoveries ran inside the bond loop, before any holder).
    if (bond.publicFloat > 0) {
      const floatFaceAnchor = corpCapitalToAnchor(
        bond.publicFloat * BOND_UNIT_FACE_VALUE,
        bondCcy,
        bondRate
      );
      const poolPayAnchor = Math.round(ratio * floatFaceAnchor * 100) / 100;
      // `creditBondPool` rounded to cents before the $inc; round here so the
      // keyed credit lands the identical local amount.
      const poolPayLocal = Math.round(poolPayAnchor * (bondRate > 0 ? bondRate : 1) * 100) / 100;
      if (poolPayLocal > 0) {
        poolCredits.push({
          currency: bondPoolCurrency(bond),
          amountLocal: poolPayLocal,
        });
      }
    }
  }

  const charSharePay = new Map<string, number>();
  const imperialSharePay = new Map<string, number>();
  for (const row of shareholderRows) {
    if (row.payout > 0) {
      if (row.isImperial) {
        imperialSharePay.set(row.characterId, row.payout);
      } else {
        charSharePay.set(row.characterId, row.payout);
      }
    }
  }

  const charAll = new Set<string>([...charBondPay.keys(), ...charSharePay.keys()]);
  const imperialAll = new Set<string>([...imperialBondPay.keys(), ...imperialSharePay.keys()]);

  // Payouts are now truly ₳-denominated: ratio is unitless; each bond's face
  // is anchor-normalized per-bond via its own `currencyCode` in the loop above.
  // Pre-forex characters hold a single ₳ `cashOnHand` balance — raw amount is
  // correct. Post-forex characters hold per-currency `currencyBalances.personal.<code>`
  // denominated in local currency — convert ₳ → holder's home currency before $inc,
  // mirroring the corp-to-corp creditor path below (anchorToCorpLiquidCapital).
  const anchorToLocal = (amtAnchor: number, currency: string): number => {
    const rate = fxByCurrency.get(currency as never);
    return Number.isFinite(rate) && rate && rate > 0 ? amtAnchor * rate : amtAnchor;
  };

  // Batch one bond_dissolution_payout tx per bondholder and one
  // corp_dissolution_distribution tx per shareholder, keyed by counterparty
  // back at the defaulting corp so admin queries can pair the two sides.
  const dissolutionTxEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];

  if (charAll.size > 0) {
    const charIds = [...charAll].map((id) => new ObjectId(id));
    const charDocs = await db
      .collection<Character>("characters")
      .find({ _id: { $in: charIds } })
      .project<Pick<Character, "_id" | "countryId">>({ _id: 1, countryId: 1 })
      .toArray();
    const charCurrencyMap = new Map(
      charDocs.map((c) => [c._id.toString(), getHomeCurrency(c as Character)])
    );

    for (const charIdStr of charAll) {
      const bondPayAnchor = charBondPay.get(charIdStr) ?? 0;
      const sharePayAnchor = charSharePay.get(charIdStr) ?? 0;
      const amtAnchor = bondPayAnchor + sharePayAnchor;
      const currency = charCurrencyMap.get(charIdStr) ?? "USD";
      // Only convert for post-forex holders — pre-forex still credits ₳ `cashOnHand`.
      const amt = forexEnabled ? anchorToLocal(amtAnchor, currency) : amtAnchor;

      if (bondPayAnchor > 0) {
        const bondPayLocal = forexEnabled ? anchorToLocal(bondPayAnchor, currency) : bondPayAnchor;
        dissolutionTxEntries.push({
          type: "bond_dissolution_payout",
          turn: currentTurn,
          createdAt: now,
          subjectType: "character",
          subjectId: new ObjectId(charIdStr),
          subjectName: nameById.get(charIdStr) ?? "(holder)",
          amount: Math.round(bondPayLocal * 100) / 100,
          currencyCode: currency,
          counterpartyType: "corporation",
          counterpartyId: refreshedCorporation._id,
          counterpartyName: refreshedCorporation.name,
          meta: { side: "bondholder", bondPayAnchor: Math.round(bondPayAnchor * 100) / 100 },
        });
      }
      if (sharePayAnchor > 0) {
        const sharePayLocal = forexEnabled
          ? anchorToLocal(sharePayAnchor, currency)
          : sharePayAnchor;
        dissolutionTxEntries.push({
          type: "corp_dissolution_distribution",
          turn: currentTurn,
          createdAt: now,
          subjectType: "character",
          subjectId: new ObjectId(charIdStr),
          subjectName: nameById.get(charIdStr) ?? "(holder)",
          amount: Math.round(sharePayLocal * 100) / 100,
          currencyCode: currency,
          counterpartyType: "corporation",
          counterpartyId: refreshedCorporation._id,
          counterpartyName: refreshedCorporation.name,
          meta: { side: "shareholder", sharePayAnchor: Math.round(sharePayAnchor * 100) / 100 },
        });
      }

      // One resumable keyed credit per holder (the $inc shape is exactly
      // the legacy bulkWrite op's, so the landed balance is unchanged).
      if (amt !== 0 && Number.isFinite(amt)) {
        const inc = buildPersonalBalanceInc(amt, currency, forexEnabled);
        holderCredits.push({
          kind: "character",
          holderId: new ObjectId(charIdStr),
          field: Object.keys(inc)[0]!,
          amount: amt,
        });
      }
    }
  }

  // Merge imperial bond + share payouts and write to imperialCharacters
  if (imperialAll.size > 0) {
    const imperialIds = [...imperialAll].map((id) => new ObjectId(id));
    const imperialDocs = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .find({ _id: { $in: imperialIds } })
      .project<Pick<ImperialCharacter, "_id" | "countryId">>({ _id: 1, countryId: 1 })
      .toArray();
    const imperialCurrencyMap = new Map(
      imperialDocs.map((c) => [c._id.toString(), getHomeCurrency(c as ImperialCharacter)])
    );

    for (const imperialIdStr of imperialAll) {
      const bondPayAnchor = imperialBondPay.get(imperialIdStr) ?? 0;
      const sharePayAnchor = imperialSharePay.get(imperialIdStr) ?? 0;
      const amtAnchor = bondPayAnchor + sharePayAnchor;
      const currency = imperialCurrencyMap.get(imperialIdStr) ?? "USD";
      const amt = forexEnabled ? anchorToLocal(amtAnchor, currency) : amtAnchor;

      if (bondPayAnchor > 0) {
        const bondPayLocal = forexEnabled ? anchorToLocal(bondPayAnchor, currency) : bondPayAnchor;
        dissolutionTxEntries.push({
          type: "bond_dissolution_payout",
          turn: currentTurn,
          createdAt: now,
          subjectType: "character",
          subjectId: new ObjectId(imperialIdStr),
          subjectName: nameById.get(imperialIdStr) ?? "(imperial holder)",
          amount: Math.round(bondPayLocal * 100) / 100,
          currencyCode: currency,
          counterpartyType: "corporation",
          counterpartyId: refreshedCorporation._id,
          counterpartyName: refreshedCorporation.name,
          meta: {
            side: "bondholder",
            imperial: true,
            bondPayAnchor: Math.round(bondPayAnchor * 100) / 100,
          },
        });
      }
      if (sharePayAnchor > 0) {
        const sharePayLocal = forexEnabled
          ? anchorToLocal(sharePayAnchor, currency)
          : sharePayAnchor;
        dissolutionTxEntries.push({
          type: "corp_dissolution_distribution",
          turn: currentTurn,
          createdAt: now,
          subjectType: "character",
          subjectId: new ObjectId(imperialIdStr),
          subjectName: nameById.get(imperialIdStr) ?? "(imperial holder)",
          amount: Math.round(sharePayLocal * 100) / 100,
          currencyCode: currency,
          counterpartyType: "corporation",
          counterpartyId: refreshedCorporation._id,
          counterpartyName: refreshedCorporation.name,
          meta: {
            side: "shareholder",
            imperial: true,
            sharePayAnchor: Math.round(sharePayAnchor * 100) / 100,
          },
        });
      }

      if (amt !== 0 && Number.isFinite(amt)) {
        const inc = buildPersonalBalanceInc(amt, currency, forexEnabled);
        holderCredits.push({
          kind: "imperial",
          holderId: new ObjectId(imperialIdStr),
          field: Object.keys(inc)[0]!,
          amount: amt,
        });
      }
    }
  }

  if (corpBondPay.size > 0) {
    const creditorIds = [...corpBondPay.keys()].map((id) => new ObjectId(id));
    const creditorDocs = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: creditorIds } })
      .toArray();
    const creditorMap = new Map(creditorDocs.map((c) => [c._id.toString(), c]));
    for (const [corpIdStr, amt] of corpBondPay.entries()) {
      const creditor = creditorMap.get(corpIdStr);
      const fxRate = fxRateForCorpFromMap(creditor ?? {}, fxByCurrency);
      const amtInCapital = anchorToCorpLiquidCapital(amt, creditor ?? {}, fxRate);

      // bond_dissolution_payout for corp creditors. Currency is the
      // creditor corp's home currency (matches the liquidCapital write).
      const creditorCurrency = (creditor?.liquidCurrencyCode ??
        COUNTRY_CURRENCY_MAP[creditor?.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
        "USD") as CurrencyCode;
      dissolutionTxEntries.push({
        type: "bond_dissolution_payout",
        turn: currentTurn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: new ObjectId(corpIdStr),
        subjectName: creditor?.name ?? "(creditor corp)",
        amount: Math.round(amtInCapital * 100) / 100,
        currencyCode: creditorCurrency,
        counterpartyType: "corporation",
        counterpartyId: refreshedCorporation._id,
        counterpartyName: refreshedCorporation.name,
        meta: {
          side: "bondholder",
          bondPayAnchor: Math.round(amt * 100) / 100,
        },
      });

      if (amtInCapital !== 0 && Number.isFinite(amtInCapital)) {
        holderCredits.push({
          kind: "corp",
          holderId: new ObjectId(corpIdStr),
          field: "liquidCapital",
          amount: amtInCapital,
        });
      }
    }
  }

  // Bug #0540 fix: pro-rata payout to CORPORATE EQUITY shareholders. Before this,
  // their share of the pool was silently dropped (allocateShareholderPool
  // skipped corp rows while still counting their shares in the denominator).
  if (allocation.corporationRows.length > 0) {
    for (const row of allocation.corporationRows.filter((r) => r.payout > 0)) {
        const creditor = corpShareholderById.get(row.corporationId);
        const creditorCurrency = (creditor?.liquidCurrencyCode ??
          COUNTRY_CURRENCY_MAP[creditor?.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
          "USD") as CurrencyCode;
        const creditorFxRate = fxByCurrency.get(creditorCurrency) ?? 1;
        const amtInCapital = anchorToCorpLiquidCapital(row.payout, creditor ?? {}, creditorFxRate);

        dissolutionTxEntries.push({
          type: "corp_dissolution_distribution",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: new ObjectId(row.corporationId),
          subjectName: row.name,
          amount: Math.round(amtInCapital * 100) / 100,
          currencyCode: creditorCurrency,
          counterpartyType: "corporation",
          counterpartyId: refreshedCorporation._id,
          counterpartyName: refreshedCorporation.name,
          meta: {
            side: "shareholder",
            sharePayAnchor: Math.round(row.payout * 100) / 100,
          },
        });

        if (amtInCapital !== 0 && Number.isFinite(amtInCapital)) {
          holderCredits.push({
            kind: "corp",
            holderId: new ObjectId(row.corporationId),
            field: "liquidCapital",
            amount: amtInCapital,
          });
        }
    }
  }

  // Bug #0540 fix: publicFloat slice escheats to the country's central bank
  // reserve. Pre-fix, this allocation was silently destroyed.
  if (allocation.publicFloatRow && allocation.publicFloatRow.payout > 0) {
    const cbId = getBankId(refreshedCorporation.countryId);
    const floatLocal = writeGovBudgetLocal(
      allocation.publicFloatRow.payout,
      refreshedCorporation.liquidCurrencyCode ??
        COUNTRY_CURRENCY_MAP[refreshedCorporation.countryId as keyof typeof COUNTRY_CURRENCY_MAP],
      corpFxRate
    );
    const floatCurrency = (refreshedCorporation.liquidCurrencyCode ??
      COUNTRY_CURRENCY_MAP[refreshedCorporation.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
      "USD") as CurrencyCode;
    if (floatLocal !== 0 && Number.isFinite(floatLocal)) {
      holderCredits.push({
        kind: "centralBank",
        holderId: cbId,
        field: "reserveBalance",
        amount: floatLocal,
      });
    }

    dissolutionTxEntries.push({
      type: "corp_dissolution_distribution",
      turn: currentTurn,
      createdAt: now,
      subjectType: "government",
      countryId: refreshedCorporation.countryId,
      subjectName: `${cbId} central bank reserve`,
      amount: Math.round(floatLocal * 100) / 100,
      currencyCode: floatCurrency,
      counterpartyType: "corporation",
      counterpartyId: refreshedCorporation._id,
      counterpartyName: refreshedCorporation.name,
      meta: {
        side: "publicFloat",
        sharePayAnchor: Math.round(allocation.publicFloatRow.payout * 100) / 100,
        floatShares: allocation.publicFloatRow.shares,
        centralBankId: cbId,
      },
    });
  }

  // #3451 gap fix: index funds are the fourth shareholder bucket. Voluntary
  // dissolution (dissolve route) and nationalization already settle their fund
  // holders via payFundShareholderRows; this bond-default path pays them as
  // keyed fund steps in the crash-safe spend below instead (cash move and
  // stale-holding drop in ONE keyed update, so a crash between them is
  // impossible). Rows at payout 0 keep the `payFundShareholderRows`
  // convention: skipped, exactly as before.
  for (const row of allocation.fundRows) {
    if (row.payout <= 0) continue;
    fundCredits.push({
      fundId: new ObjectId(row.fundId),
      amountAnchor: row.payout,
      dissolvedCorpId: refreshedCorporation._id,
    });
  }

  const totalPayoutToPeople = [...charAll].reduce(
    (s, id) => s + (charBondPay.get(id) ?? 0) + (charSharePay.get(id) ?? 0),
    0
  );

  // Crash-safe settlement (issue #1672): the pool recovery shares plus one
  // resumable credit per holder/fund run as exactly-once money flow. A
  // same-key retry that finds the corp mid-dissolution reconciles the STORED
  // plan (per-step sub-keys skip what already applied); a completed receipt
  // replays its stored outcome with no further money movement. Terminal
  // (`failed`/`compensated`) and cross-dissolution key reuse stay throw
  // (`MoneyFlowTerminalError` / `MoneyFlowKeyConflictError`) for the caller
  // to map; a vanished holder/pool row throws the `BOND_DISSOLUTION_*`
  // error the route maps to the historical 500.
  const outcome: BondDissolutionOutcome = {
    corpIdHex: refreshedCorporation._id.toHexString(),
    corpName: refreshedCorporation.name,
    bondRecoveryPool,
    shareholderPool,
    shareholderPayouts: shareholderRows,
    corporateShareholderPayouts: allocation.corporationRows,
    publicFloatPayout: allocation.publicFloatRow,
    totalPayoutToPeople,
  };
  let replayedResult: CorporationDissolutionResult | null = null;
  if (holderCredits.length + fundCredits.length + poolCredits.length > 0) {
    const fingerprint = buildBondDissolutionFingerprint({
      corpId: refreshedCorporation._id,
      bonds: bonds.map((b) => b._id),
      holders: holderCredits.map((h) => ({
        kind: h.kind,
        holderId: h.holderId,
        amount: h.amount,
      })),
      funds: fundCredits.map((f) => ({ fundId: f.fundId, amount: f.amountAnchor })),
      pools: poolCredits.map((p) => ({ currency: p.currency, amount: p.amountLocal })),
    });
    await applyBondDissolutionSpend(db, {
      corpId: refreshedCorporation._id,
      holders: holderCredits,
      funds: fundCredits,
      poolCredits,
      now,
      outcome,
      fingerprint,
      ...(options.idempotencyKey !== undefined
        ? { idempotencyKey: options.idempotencyKey }
        : {}),
    });
  } else if (options.idempotencyKey !== undefined) {
    // Genuinely nothing to pay (100% haircut with no shareholder pool, or an
    // all-empty wind-down): there is no receipt to claim, but a previous
    // attempt under the same key may hold a stored plan + outcome (amounts
    // moved between attempts). Finish it and report the stored outcome
    // instead of the live zero.
    const resumed = await resumeBondDissolutionByKey(
      db,
      options.idempotencyKey,
      refreshedCorporation._id
    );
    if (resumed) replayedResult = outcomeToResult(resumed.outcome);
  }

  // Emit the bond_default tx for the defaulting corp (subject side) BEFORE
  // we delete the corp doc so admin queries can still resolve it via
  // counterparty=defaulting corp; the recipient tx rows above already carry
  // the corp _id + name. The amount on this row is the gross bondRecoveryPool
  // in the corp's home currency.
  //
  // #3237: only emitted when the corp actually had bonds. This executor is
  // also the generic insolvency wind-down (requireDefaultedBonds: false, used
  // by NPP auto-insolvency and character deletion); a bond-less dissolution
  // has no default event — emitting the row anyway produced a stream of
  // misleading amount-0 "Bond default settlement" ledger entries. The
  // corp_dissolution_distribution / bond_dissolution_payout rows above fully
  // describe a bond-less wind-down. Real defaults still log exactly once per
  // event (the corp doc is deleted at the end of this routine, so it cannot
  // re-emit), including 100%-haircut defaults where the pool is 0 but claims
  // in meta are non-zero.
  const corpHomeCurrency = (refreshedCorporation.liquidCurrencyCode ??
    COUNTRY_CURRENCY_MAP[refreshedCorporation.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
    "USD") as CurrencyCode;
  const bondPoolInCorpCapital = anchorToCorpLiquidCapital(
    bondRecoveryPool,
    refreshedCorporation,
    corpFxRate
  );
  const totalCharShareAnchor = [...charAll].reduce(
    (s, id) => s + (charBondPay.get(id) ?? 0) + (charSharePay.get(id) ?? 0),
    0
  );
  const totalCorpShareAnchor = allocation.corporationRows.reduce((s, r) => s + r.payout, 0);
  const totalFloatShareAnchor = allocation.publicFloatRow?.payout ?? 0;
  const totalSharePayoutAnchor =
    totalCharShareAnchor + totalCorpShareAnchor + totalFloatShareAnchor;

  if (bonds.length > 0) {
    dissolutionTxEntries.push({
      type: "bond_default",
      turn: currentTurn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: refreshedCorporation._id,
      subjectName: refreshedCorporation.name,
      amount: -Math.round(bondPoolInCorpCapital * 100) / 100,
      currencyCode: corpHomeCurrency,
      counterpartyType: "system",
      counterpartyName: "Bond default settlement",
      meta: {
        bondRecoveryPoolAnchor: Math.round(bondRecoveryPool * 100) / 100,
        shareholderPoolAnchor: Math.round(shareholderPool * 100) / 100,
        totalBondClaimsAnchor: Math.round(totalBondClaims * 100) / 100,
        totalPayoutToPeopleAnchor: Math.round(totalCharShareAnchor * 100) / 100,
        totalCorpShareAnchor: Math.round(totalCorpShareAnchor * 100) / 100,
        totalFloatShareAnchor: Math.round(totalFloatShareAnchor * 100) / 100,
        totalSharePayoutAnchor: Math.round(totalSharePayoutAnchor * 100) / 100,
      },
    });
  }

  if (dissolutionTxEntries.length > 0) {
    const thresholds = await loadTxThresholds(db);
    // The transaction batch also emits the shadow-ledger rows. Await it so the
    // end-of-turn snapshot and reconciler cannot race ahead of a dissolution
    // that has already changed and deleted authoritative balance accounts.
    await emitTxBulk(db, dissolutionTxEntries, thresholds);
  }

  await runDissolutionCleanup(
    db,
    refreshedCorporation,
    sectors,
    bonds.map((b) => b._id),
    now
  );

  logWireEvent(
    "corporation_dissolved",
    wireHeadlineCorpDissolved(refreshedCorporation.name, Math.round(totalPayoutToPeople))
  );

  return (
    replayedResult ?? {
      bondRecoveryPool,
      shareholderPool,
      shareholderPayouts: shareholderRows,
      corporateShareholderPayouts: allocation.corporationRows,
      publicFloatPayout: allocation.publicFloatRow,
      totalPayoutToPeople,
    }
  );
}

/**
 * Terminal ownership cleanup after the payout flow settled (issue #1672).
 * Every step is naturally idempotent (deletes, restores, and share releases
 * converge on re-run), so a same-key retry that already paid — or a resume
 * path that finished the stored plan — re-runs this pass instead of
 * strand-checking which half of it survived a crash.
 */
async function runDissolutionCleanup(
  db: Db,
  refreshedCorporation: Corporation,
  sectors: CorporateSector[],
  bondIds: ObjectId[],
  now: Date
): Promise<void> {
  if (bondIds.length > 0) {
    await db.collection("bondHistory").deleteMany({ bondId: { $in: bondIds } });
  }

  await restoreSectorsToUnowned(db, sectors, now);
  await db.collection<Bond>("bonds").deleteMany({ corporationId: refreshedCorporation._id });
  await releaseCorporationHeldSharesToFloat(db, refreshedCorporation._id, now);

  // Stamp tx history before deleting the corp so the bond_default +
  // bond_dissolution_payout rows emitted earlier in this function still
  // resolve a non-orphaned subjectId on admin forensic queries.
  await stampSubjectDeleted(db, refreshedCorporation._id, {
    sequentialId: refreshedCorporation.sequentialId,
    deletedAt: now,
  });

  await db.collection<Corporation>("corporations").deleteOne({ _id: refreshedCorporation._id });
}

/**
 * Route-level replay for a finished dissolution whose corporation is already
 * gone: the corp lookup fails before the executor runs, so the route answers
 * from the completed receipt instead of 404ing a client retry. Returns the
 * stored outcome, or null when there is no completed receipt under the key
 * (the caller keeps its 404). Terminal receipts throw
 * `MoneyFlowTerminalError`, cross-corp key reuse throws
 * `MoneyFlowKeyConflictError`.
 */
export async function getDissolutionCompletedResult(
  db: Db,
  key: string,
  expectedCorpIdHex: string
): Promise<CorporationDissolutionResult | null> {
  const outcome = await getBondDissolutionCompletedOutcome(db, key, expectedCorpIdHex);
  return outcome ? outcomeToResult(outcome) : null;
}
