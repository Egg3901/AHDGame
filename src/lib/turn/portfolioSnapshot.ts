import { getDb } from "@/lib/mongodb";
import type {
  Corporation,
  PortfolioHistory,
  Bond,
  Character,
  CorporationPortfolioHistory,
} from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  getTotalPersonalWealth,
  getTotalPersonalLiquidWealth,
  getTotalSavingsWealth,
} from "@/lib/currency/characterFunds";
import { computeLocDebtInternal } from "@/lib/lineOfCredit/netWorth";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import type { ExchangeRate } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { computeCorporationLiabilityValueAnchor } from "@/lib/corporations/netWorth";

/**
 * Snapshot portfolio values for all characters who hold shares and/or bonds.
 * Runs after value-affecting turn phases settle, so the snapshot reflects the
 * end-of-turn state rather than an intraturn partial.
 * Stores gross/net totals and breakdown values (stocks, bonds, cash, LOC debt).
 */
export async function snapshotPortfolioValues(turn: number): Promise<number> {
  const db = await getDb();
  const now = new Date();
  const forexEnabled = await isForexEnabled();

  // Fetch exchange rates for accurate cross-currency wealth conversion
  const exchangeRates = forexEnabled
    ? (Object.fromEntries(
        (await db.collection<ExchangeRate>("exchangeRates").find({}).toArray()).map((r) => [
          r.currencyCode,
          r.rate,
        ])
      ) as Partial<Record<CurrencyCode, number>>)
    : undefined;

  // Fetch all characters for personal wealth lookup
  const characters = await db
    .collection<Character>("characters")
    .find({})
    .project({
      _id: 1,
      cashOnHand: 1,
      savingsOnHand: 1,
      currencyBalances: 1,
      countryId: 1,
      lineOfCredit: 1,
    })
    .toArray();
  const cashOnHandMap = new Map(
    characters.map((c) => {
      const ch = c as Character;
      const id = c._id.toString();
      return [
        id,
        {
          wealth: getTotalPersonalWealth(ch, forexEnabled, exchangeRates),
          liquid: getTotalPersonalLiquidWealth(ch, forexEnabled, exchangeRates),
          savings: getTotalSavingsWealth(ch, forexEnabled, exchangeRates),
          locDebt: computeLocDebtInternal(ch, exchangeRates ?? {}),
        },
      ];
    })
  );

  // Fetch imperial characters for personal wealth
  const imperialCharacters = await db
    .collection<ImperialCharacter>("imperialCharacters")
    .find({})
    .project({ _id: 1, cashOnHand: 1, currencyBalances: 1, countryId: 1 })
    .toArray();
  for (const ic of imperialCharacters) {
    const imp = ic as ImperialCharacter;
    const wealth = getTotalPersonalWealth(imp, forexEnabled, exchangeRates);
    cashOnHandMap.set(ic._id.toString(), {
      wealth,
      liquid: wealth, // Imperial characters have no savings accounts — all wealth is liquid
      savings: 0,
      locDebt: 0,
    });
  }

  const [corporations, bonds, charFxByCurrency] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find({ "shareholders.0": { $exists: true } })
      .project<Corporation>({
        shareholders: 1,
        sharePrice: 1,
        liquidCurrencyCode: 1,
        countryId: 1,
      })
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find({ matured: false, "holders.0": { $exists: true } })
      .project<Bond>({ holders: 1, marketPrice: 1, currencyCode: 1, countryId: 1 })
      .toArray(),
    loadFxRatesByCurrency(db),
  ]);

  // Aggregate per-character: stocks, bonds, and cash
  const portfolioMap = new Map<
    string,
    {
      totalValue: number;
      netValue: number;
      stockValue: number;
      bondValue: number;
      cashValue: number;
      liquidCashValue: number;
      savingsCashValue: number;
      locDebtValue: number;
    }
  >();

  // Initialize all characters with cash value
  for (const [charId, buckets] of cashOnHandMap.entries()) {
    portfolioMap.set(charId, {
      totalValue: buckets.wealth,
      netValue: Math.max(0, buckets.wealth - buckets.locDebt),
      stockValue: 0,
      bondValue: 0,
      cashValue: buckets.wealth,
      liquidCashValue: buckets.liquid,
      savingsCashValue: buckets.savings,
      locDebtValue: buckets.locDebt,
    });
  }

  // Stock and bond values are each stored in their own local currency
  // (v0.2.6); sum each contribution as ₳ so a character's portfolioHistory
  // totals compare apples-to-apples across different asset currencies.
  for (const corp of corporations) {
    const price = corp.sharePrice ?? 0;
    const corpFxRate = fxRateForCorpFromMap(corp, charFxByCurrency);
    for (const sh of corp.shareholders) {
      const charId = sh.characterId?.toString() ?? sh.imperialCharacterId?.toString();
      if (!charId) continue;
      const stockValueLocal = sh.shares * price;
      const stockValue = corpLiquidCapitalToAnchor(stockValueLocal, corp, corpFxRate);
      const existing = portfolioMap.get(charId) ?? {
        totalValue: 0,
        netValue: 0,
        stockValue: 0,
        bondValue: 0,
        cashValue: 0,
        liquidCashValue: 0,
        savingsCashValue: 0,
        locDebtValue: 0,
      };
      portfolioMap.set(charId, {
        totalValue: existing.totalValue + stockValue,
        netValue: existing.netValue + stockValue,
        stockValue: existing.stockValue + stockValue,
        bondValue: existing.bondValue,
        cashValue: existing.cashValue,
        liquidCashValue: existing.liquidCashValue,
        savingsCashValue: existing.savingsCashValue,
        locDebtValue: existing.locDebtValue,
      });
    }
  }

  // Add bond holdings — normalize to ₳ via bond.currencyCode
  for (const bond of bonds) {
    const unitValueLocal = BOND_UNIT_FACE_VALUE * (bond.marketPrice ?? 1.0);
    const bondCcy = (bond.currencyCode ??
      (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined)) as CurrencyCode | undefined;
    const bondRate = bondCcy ? (charFxByCurrency.get(bondCcy) ?? 1) : 1;
    const unitValueAnchor = bondCcy && bondRate > 0 ? unitValueLocal / bondRate : unitValueLocal;
    for (const holder of bond.holders) {
      const charId = holder.characterId?.toString() ?? holder.imperialCharacterId?.toString();
      if (charId) {
        const bondValueAnchor = unitValueAnchor * holder.units;
        const existing = portfolioMap.get(charId) ?? {
          totalValue: 0,
          netValue: 0,
          stockValue: 0,
          bondValue: 0,
          cashValue: 0,
          liquidCashValue: 0,
          savingsCashValue: 0,
          locDebtValue: 0,
        };
        portfolioMap.set(charId, {
          totalValue: existing.totalValue + bondValueAnchor,
          netValue: existing.netValue + bondValueAnchor,
          stockValue: existing.stockValue,
          bondValue: existing.bondValue + bondValueAnchor,
          cashValue: existing.cashValue,
          liquidCashValue: existing.liquidCashValue,
          savingsCashValue: existing.savingsCashValue,
          locDebtValue: existing.locDebtValue,
        });
      }
    }
  }

  if (portfolioMap.size === 0) return 0;

  // Freeze the FX rate map at snapshot time so the portfolio chart can convert
  // each historical anchor value back to local currency at the rate that was
  // actually in effect — re-applying current rates produces phantom volatility
  // when ₳/local floats (the Antonelli/Aurora "missing $6bn" report).
  const exchangeRatesSnapshot = fxMapToRecord(charFxByCurrency);

  const { ObjectId } = await import("mongodb");
  const docs: Omit<PortfolioHistory, "_id">[] = Array.from(portfolioMap.entries()).map(
    ([charId, values]) => ({
      characterId: new ObjectId(charId),
      turn,
      totalValue: Math.round(values.totalValue * 100) / 100,
      netValue: Math.round(values.netValue * 100) / 100,
      stockValue: Math.round(values.stockValue * 100) / 100,
      bondValue: Math.round(values.bondValue * 100) / 100,
      cashValue: Math.round(values.cashValue * 100) / 100,
      liquidCashValue: Math.round(values.liquidCashValue * 100) / 100,
      savingsCashValue: Math.round(values.savingsCashValue * 100) / 100,
      locDebtValue: Math.round(values.locDebtValue * 100) / 100,
      exchangeRatesSnapshot,
      createdAt: now,
    })
  );

  await db.collection("portfolioHistory").insertMany(docs as PortfolioHistory[]);
  return docs.length;
}

function fxMapToRecord(
  map: ReadonlyMap<CurrencyCode, number>
): Partial<Record<CurrencyCode, number>> {
  const out: Partial<Record<CurrencyCode, number>> = {};
  for (const [code, rate] of map) {
    if (Number.isFinite(rate) && rate > 0) out[code] = rate;
  }
  return out;
}

/**
 * Snapshot portfolio values for all corporations.
 * Runs after value-affecting turn phases settle, so historical values are
 * frozen after coupon, FX, LOC, and rate changes have landed.
 * Stores gross assets, liabilities, and debt-adjusted net worth.
 */
export async function snapshotCorporationPortfolioValues(turn: number): Promise<number> {
  const db = await getDb();
  const now = new Date();

  // Every corp gets a snapshot so that corps holding only liquidCapital (no
  // stocks/bonds) still have Net Worth history. Previously this query scoped
  // to corps with shareholder rows, which silently dropped cash-only corps
  // from the chart entirely.
  const [allCorps, heldCorps, bonds, fxByCurrency] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find({})
      .project<Corporation>({
        _id: 1,
        liquidCapital: 1,
        liquidCurrencyCode: 1,
        countryId: 1,
        imfBailoutActive: 1,
        imfBailoutImfCorporationId: 1,
        imfFacilityPrincipalOutstanding: 1,
      })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({ "shareholders.corporationId": { $exists: true } })
      .project<Corporation>({
        _id: 1,
        shareholders: 1,
        sharePrice: 1,
        liquidCurrencyCode: 1,
        countryId: 1,
      })
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find({ matured: false, "holders.corporationId": { $exists: true } })
      .project<Bond>({ holders: 1, marketPrice: 1, currencyCode: 1, countryId: 1 })
      .toArray(),
    loadFxRatesByCurrency(db),
  ]);

  // All portfolio aggregates land in ₳ (anchor). sharePrice, bond face values,
  // and liquidCapital are each stored in their own local currency (v0.2.6) —
  // summing without normalization would add ¥ to £ to $ as if identical units.
  const portfolioMap = new Map<
    string,
    {
      totalValue: number;
      netValue: number;
      stockValue: number;
      bondValue: number;
      cashValue: number;
      liabilityValue: number;
    }
  >();

  const imfReceivableByLender = new Map<string, number>();
  for (const corp of allCorps) {
    if (!corp.imfBailoutActive || !corp.imfBailoutImfCorporationId) continue;
    const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    const principalAnchor = corpLiquidCapitalToAnchor(
      corp.imfFacilityPrincipalOutstanding ?? 0,
      corp,
      fxRate
    );
    const lenderId = corp.imfBailoutImfCorporationId.toString();
    imfReceivableByLender.set(
      lenderId,
      (imfReceivableByLender.get(lenderId) ?? 0) + principalAnchor
    );
  }

  // Seed every corp with its anchor-normalized liquidCapital so the Net Worth
  // snapshot captures cash-only corps, not just ones with investment rows.
  for (const corp of allCorps) {
    const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    const cashAnchor = corpLiquidCapitalToAnchor(corp.liquidCapital ?? 0, corp, fxRate);
    const imfReceivableAnchor = imfReceivableByLender.get(corp._id.toString()) ?? 0;
    const liabilityAnchor = computeCorporationLiabilityValueAnchor(corp, bonds, fxByCurrency);
    portfolioMap.set(corp._id.toString(), {
      totalValue: cashAnchor + imfReceivableAnchor,
      netValue: cashAnchor + imfReceivableAnchor - liabilityAnchor,
      stockValue: 0,
      bondValue: imfReceivableAnchor,
      cashValue: cashAnchor,
      liabilityValue: liabilityAnchor,
    });
  }

  // Add stock holdings (where a corp holds shares in another corp)
  for (const corp of heldCorps) {
    const price = corp.sharePrice ?? 0;
    if (price <= 0) continue;
    const heldFxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    for (const sh of corp.shareholders) {
      if (sh.corporationId) {
        const holderCorpId = sh.corporationId.toString();
        const stockValueLocal = sh.shares * price;
        const stockValueAnchor = corpLiquidCapitalToAnchor(stockValueLocal, corp, heldFxRate);
        const existing = portfolioMap.get(holderCorpId) ?? {
          totalValue: 0,
          netValue: 0,
          stockValue: 0,
          bondValue: 0,
          cashValue: 0,
          liabilityValue: 0,
        };
        portfolioMap.set(holderCorpId, {
          totalValue: existing.totalValue + stockValueAnchor,
          netValue: existing.netValue + stockValueAnchor,
          stockValue: existing.stockValue + stockValueAnchor,
          bondValue: existing.bondValue,
          cashValue: existing.cashValue,
          liabilityValue: existing.liabilityValue,
        });
      }
    }
  }

  // Add bond holdings (where a corp holds bonds)
  for (const bond of bonds) {
    const unitValueLocal = BOND_UNIT_FACE_VALUE * (bond.marketPrice ?? 1.0);
    const bondCcy = (bond.currencyCode ??
      (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined)) as CurrencyCode | undefined;
    const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
    const unitValueAnchor = bondCcy && bondRate > 0 ? unitValueLocal / bondRate : unitValueLocal;
    for (const holder of bond.holders) {
      if (holder.corporationId) {
        const holderCorpId = holder.corporationId.toString();
        const bondValueAnchor = unitValueAnchor * holder.units;
        const existing = portfolioMap.get(holderCorpId) ?? {
          totalValue: 0,
          netValue: 0,
          stockValue: 0,
          bondValue: 0,
          cashValue: 0,
          liabilityValue: 0,
        };
        portfolioMap.set(holderCorpId, {
          totalValue: existing.totalValue + bondValueAnchor,
          netValue: existing.netValue + bondValueAnchor,
          stockValue: existing.stockValue,
          bondValue: existing.bondValue + bondValueAnchor,
          cashValue: existing.cashValue,
          liabilityValue: existing.liabilityValue,
        });
      }
    }
  }

  if (portfolioMap.size === 0) return 0;

  // See PortfolioHistory.exchangeRatesSnapshot — same purpose for the corp chart.
  const exchangeRatesSnapshot = fxMapToRecord(fxByCurrency);

  const { ObjectId } = await import("mongodb");
  const docs: Omit<CorporationPortfolioHistory, "_id">[] = Array.from(portfolioMap.entries()).map(
    ([corpId, values]) => ({
      corporationId: new ObjectId(corpId),
      turn,
      totalValue: Math.round(values.totalValue * 100) / 100,
      netValue: Math.round(values.netValue * 100) / 100,
      stockValue: Math.round(values.stockValue * 100) / 100,
      bondValue: Math.round(values.bondValue * 100) / 100,
      cashValue: Math.round(values.cashValue * 100) / 100,
      liabilityValue: Math.round(values.liabilityValue * 100) / 100,
      exchangeRatesSnapshot,
      createdAt: now,
    })
  );

  await db
    .collection<CorporationPortfolioHistory>("corporationPortfolioHistory")
    .insertMany(docs as CorporationPortfolioHistory[]);
  return docs.length;
}
