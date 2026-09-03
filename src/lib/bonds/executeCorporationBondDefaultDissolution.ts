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
import { bondPoolCurrency, creditBondPool, debitBondPoolUpTo } from "@/lib/bonds/marketPool";
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
import { payFundShareholderRows } from "@/lib/corporations/payFundShareholders";
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
 * Full bond-default dissolution: pay bondholders and shareholders from LC + sector NPV,
 * delete bonds/sectors/corporation, cancel orders. Shared by CEO dissolve and admin force-liquidate.
 */
export async function executeCorporationBondDefaultDissolution(
  db: Db,
  corporation: Corporation,
  options: { requireDefaultedBonds: boolean }
): Promise<CorporationDissolutionResult> {
  if (corporation.countryOwnerId) {
    throw badRequest("National corporations cannot be dissolved here");
  }

  const bonds = await db
    .collection<Bond>("bonds")
    .find({ corporationId: corporation._id, matured: false })
    .toArray();

  if (options.requireDefaultedBonds && !bonds.some((b) => b.defaulted)) {
    throw badRequest("Bond default dissolution requires at least one defaulted bond");
  }

  const now = new Date();
  const currentTurn = await getCurrentTurn(db);
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
    // share of the recovery pool was being burned before.
    if (bond.publicFloat > 0) {
      const floatFaceAnchor = corpCapitalToAnchor(
        bond.publicFloat * BOND_UNIT_FACE_VALUE,
        bondCcy,
        bondRate
      );
      const poolPayAnchor = Math.round(ratio * floatFaceAnchor * 100) / 100;
      if (poolPayAnchor > 0) {
        await creditBondPool(
          db,
          bondPoolCurrency(bond),
          poolPayAnchor * (bondRate > 0 ? bondRate : 1),
          "recoveriesIn",
          now
        );
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
    const forexEnabled = await isForexEnabled();
    const charIds = [...charAll].map((id) => new ObjectId(id));
    const charDocs = await db
      .collection<Character>("characters")
      .find({ _id: { $in: charIds } })
      .project<Pick<Character, "_id" | "countryId">>({ _id: 1, countryId: 1 })
      .toArray();
    const charCurrencyMap = new Map(
      charDocs.map((c) => [c._id.toString(), getHomeCurrency(c as Character)])
    );

    const charOps = [...charAll].map((charIdStr) => {
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

      return {
        updateOne: {
          filter: { _id: new ObjectId(charIdStr) },
          update: {
            $inc: buildPersonalBalanceInc(amt, currency, forexEnabled),
            $set: { updatedAt: now },
          },
        },
      };
    });
    await db.collection<Character>("characters").bulkWrite(charOps);
  }

  // Merge imperial bond + share payouts and write to imperialCharacters
  if (imperialAll.size > 0) {
    const forexEnabled = await isForexEnabled();
    const imperialIds = [...imperialAll].map((id) => new ObjectId(id));
    const imperialDocs = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .find({ _id: { $in: imperialIds } })
      .project<Pick<ImperialCharacter, "_id" | "countryId">>({ _id: 1, countryId: 1 })
      .toArray();
    const imperialCurrencyMap = new Map(
      imperialDocs.map((c) => [c._id.toString(), getHomeCurrency(c as ImperialCharacter)])
    );

    const imperialOps = [...imperialAll].map((imperialIdStr) => {
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

      return {
        updateOne: {
          filter: { _id: new ObjectId(imperialIdStr) },
          update: {
            $inc: buildPersonalBalanceInc(amt, currency, forexEnabled),
            $set: { updatedAt: now },
          },
        },
      };
    });
    await db.collection("imperialCharacters").bulkWrite(imperialOps);
  }

  if (corpBondPay.size > 0) {
    const creditorIds = [...corpBondPay.keys()].map((id) => new ObjectId(id));
    const creditorDocs = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: creditorIds } })
      .toArray();
    const creditorMap = new Map(creditorDocs.map((c) => [c._id.toString(), c]));
    const corpOps = [...corpBondPay.entries()].map(([corpIdStr, amt]) => {
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

      return {
        updateOne: {
          filter: { _id: new ObjectId(corpIdStr) },
          update: {
            $inc: { liquidCapital: amtInCapital },
            $set: { updatedAt: now },
          },
        },
      };
    });
    await db.collection<Corporation>("corporations").bulkWrite(corpOps);
  }

  // Bug #0540 fix: pro-rata payout to CORPORATE EQUITY shareholders. Before this,
  // their share of the pool was silently dropped (allocateShareholderPool
  // skipped corp rows while still counting their shares in the denominator).
  if (allocation.corporationRows.length > 0) {
    const equityOps = allocation.corporationRows
      .filter((row) => row.payout > 0)
      .map((row) => {
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

        return {
          updateOne: {
            filter: { _id: new ObjectId(row.corporationId) },
            update: {
              $inc: { liquidCapital: amtInCapital },
              $set: { updatedAt: now },
            },
          },
        };
      });
    if (equityOps.length > 0) {
      await db.collection<Corporation>("corporations").bulkWrite(equityOps);
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
    await db
      .collection<CentralBank>("centralBanks")
      .updateOne({ _id: cbId }, { $inc: { reserveBalance: floatLocal }, $set: { updatedAt: now } });

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
  // holders via payFundShareholderRows, but this bond-default path never did:
  // allocateShareholderPool counted fund shares in the payout denominator while
  // paying the fund nothing and leaving its holding in place. The corp is then
  // deleted below, so every fund that held a bankrupt corp kept a dangling
  // holding marked at stale value forever (the "ghost" holdings dominating the
  // index-fund book). Pay the fund its ₳ pool slice and drop the holding, exactly
  // as the other two whole-corp payout flows do.
  if (allocation.fundRows.length > 0) {
    await payFundShareholderRows(db, allocation.fundRows, refreshedCorporation._id, now);
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

  const bondIds = bonds.map((b) => b._id);
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

  const totalPayoutToPeople = [...charAll].reduce(
    (s, id) => s + (charBondPay.get(id) ?? 0) + (charSharePay.get(id) ?? 0),
    0
  );

  logWireEvent(
    "corporation_dissolved",
    wireHeadlineCorpDissolved(refreshedCorporation.name, Math.round(totalPayoutToPeople))
  );

  return {
    bondRecoveryPool,
    shareholderPool,
    shareholderPayouts: shareholderRows,
    corporateShareholderPayouts: allocation.corporationRows,
    publicFloatPayout: allocation.publicFloatRow,
    totalPayoutToPeople,
  };
}
