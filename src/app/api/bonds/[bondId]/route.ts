import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { verifyAuth } from "@/lib/auth"; // Optional auth — uses verifyAuth() (userId only needed)
import { handleRouteError } from "@/lib/api/errors";
import type { Bond, Corporation, BondHistory, User } from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { bulkFetchCharacterNames } from "@/lib/db/characterLookup";
import { BOND_UNIT_FACE_VALUE, BOND_MATURITY_LABELS } from "@/lib/db/types/bond";
import { loadBondQuote } from "@/lib/bonds/marketPool";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import { getGameState } from "@/lib/gameState";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getBondIssuerDisplayName, isCorporateBond } from "@/lib/bonds/sovereign";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getTotalPersonalLiquidWealth } from "@/lib/currency/characterFunds";
import {
  corpCapitalToAnchor,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { calculateBondYieldToMaturityPercent } from "@/lib/constants/bonds";
import { isBankPropTradingEnabled } from "@/lib/banking/featureFlag";

interface RouteParams {
  params: Promise<{ bondId: string }>;
}

/**
 * GET /api/bonds/[bondId]
 * Get full details for a single bond, including holders with names and price history.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { bondId } = await params;
    const db = await getDb();

    let bond: Bond | null = null;
    if (ObjectId.isValid(bondId)) {
      bond = await db.collection<Bond>("bonds").findOne({ _id: new ObjectId(bondId) });
    }
    if (!bond) {
      return NextResponse.json({ error: "Bond not found" }, { status: 404 });
    }

    const [gameState, corporation, user] = await Promise.all([
      getGameState(),
      isCorporateBond(bond)
        ? db.collection<Corporation>("corporations").findOne({
            _id: bond.corporationId,
          })
        : Promise.resolve(null),
      verifyAuth(),
    ]);
    const currentTurn = gameState?.currentTurn ?? 1;

    let isCeo = false;
    let myCharacterId: string | null = null;
    let myCashOnHand = 0;
    let myBondUnits = 0;
    let myCorporation: {
      id: string;
      name: string;
      liquidCapital: number;
      liquidCapitalLocal: number;
      liquidCurrencyCode?: CurrencyCode | null;
      bondUnits: number;
    } | null = null;
    let currencyBalances: { personal: Record<string, number> } | null = null;
    let homeCurrency: string | null = null;
    let autoConvertEnabled = true;
    let investmentBank: {
      id: string;
      name: string;
      liquidCapital: number;
      liquidCapitalLocal: number;
      liquidCurrencyCode?: CurrencyCode | null;
      bondUnits: number;
    } | null = null;

    if (user) {
      if (corporation) {
        isCeo = corporation.userId != null && corporation.userId.toString() === user.userId;
      }
      const [forexEnabled, bankPropTradingEnabled, userDoc] = await Promise.all([
        isForexEnabled(),
        isBankPropTradingEnabled(),
        db.collection<User>("users").findOne({ _id: new ObjectId(user.userId) }),
      ]);
      // Load exchange rates so multi-currency wealth converts correctly. Without
      // these, getTotalPersonalWealth falls back to home-currency only and a
      // player with foreign holdings sees a deflated "Your cash" total.
      const exchangeRates: Partial<Record<CurrencyCode, number>> | undefined = forexEnabled
        ? await loadFxRatesRecord(db)
        : undefined;
      const isImperialMode =
        userDoc?.activeCharacterType === "imperial" && !!userDoc?.activeImperialCharacterId;

      if (isImperialMode) {
        // Imperial character path
        const imperial = await db
          .collection<ImperialCharacter>("imperialCharacters")
          .findOne({ _id: userDoc!.activeImperialCharacterId!, userId: new ObjectId(user.userId) });
        if (imperial) {
          myCharacterId = imperial._id.toString();
          myCashOnHand = getTotalPersonalLiquidWealth(imperial, forexEnabled, exchangeRates);
          if (forexEnabled && imperial.currencyBalances) {
            currencyBalances = imperial.currencyBalances as { personal: Record<string, number> };
            homeCurrency = COUNTRY_CURRENCY_MAP[imperial.countryId as CountryId] ?? "USD";
            autoConvertEnabled = imperial.autoConvertEnabled ?? true;
          }
          const myHolding = bond.holders.find(
            (h) => h.imperialCharacterId?.toString() === imperial._id.toString()
          );
          myBondUnits = myHolding?.units ?? 0;

          // Find corporation where imperial character is CEO
          const myCorp = await db.collection<Corporation>("corporations").findOne({
            ceoId: imperial._id,
            ceoType: "imperial",
            ceoVacant: { $ne: true },
          });
          if (myCorp) {
            const corpHolding = bond.holders.find(
              (h) => h.corporationId?.toString() === myCorp._id.toString()
            );
            const corpCode = resolveCorpLiquidCurrencyCode(myCorp);
            const corpFxRate =
              forexEnabled && exchangeRates && corpCode ? (exchangeRates[corpCode] ?? 1.0) : 1.0;
            myCorporation = {
              id: myCorp._id.toString(),
              name: myCorp.name,
              liquidCapital:
                corpFxRate > 0 ? myCorp.liquidCapital / corpFxRate : myCorp.liquidCapital,
              liquidCapitalLocal: myCorp.liquidCapital,
              liquidCurrencyCode: corpCode ?? null,
              bondUnits: corpHolding?.units ?? 0,
            };
            if (
              bankPropTradingEnabled &&
              myCorp.bankCharter?.status === "active" &&
              (myCorp.bankCharter.type === "investment" || myCorp.bankCharter.type === "universal")
            ) {
              investmentBank = {
                id: myCorp._id.toString(),
                name: myCorp.name,
                liquidCapital:
                  corpFxRate > 0 ? myCorp.liquidCapital / corpFxRate : myCorp.liquidCapital,
                liquidCapitalLocal: myCorp.liquidCapital,
                liquidCurrencyCode: corpCode ?? null,
                bondUnits:
                  myCorp.bankCharter.propBook
                    ?.filter((p) => p.asset === "bond" && p.ref === bond._id.toString())
                    .reduce((sum, p) => sum + p.units, 0) ?? 0,
              };
            }
          }
        }
      } else {
        // Regular character path
        const characterQuery = userDoc?.activeCharacterId
          ? { _id: userDoc.activeCharacterId, userId: new ObjectId(user.userId) }
          : { userId: new ObjectId(user.userId) };
        const character = await db.collection<Character>("characters").findOne(characterQuery);
        if (character) {
          myCharacterId = character._id.toString();
          myCashOnHand = getTotalPersonalLiquidWealth(character, forexEnabled, exchangeRates);
          if (forexEnabled && character.currencyBalances) {
            currencyBalances = character.currencyBalances as { personal: Record<string, number> };
            homeCurrency = COUNTRY_CURRENCY_MAP[character.countryId as CountryId] ?? "USD";
            autoConvertEnabled = character.autoConvertEnabled ?? true;
          }
          const myHolding = bond.holders.find(
            (h) => h.characterId?.toString() === character._id.toString()
          );
          myBondUnits = myHolding?.units ?? 0;

          // Find corporation where user is CEO (for corporate bond purchases)
          const myCorp = await db.collection<Corporation>("corporations").findOne({
            ceoId: character._id,
            ceoVacant: { $ne: true },
          });
          if (myCorp) {
            const corpHolding = bond.holders.find(
              (h) => h.corporationId?.toString() === myCorp._id.toString()
            );
            const corpCode = resolveCorpLiquidCurrencyCode(myCorp);
            const corpFxRate =
              forexEnabled && exchangeRates && corpCode ? (exchangeRates[corpCode] ?? 1.0) : 1.0;
            myCorporation = {
              id: myCorp._id.toString(),
              name: myCorp.name,
              liquidCapital:
                corpFxRate > 0 ? myCorp.liquidCapital / corpFxRate : myCorp.liquidCapital,
              liquidCapitalLocal: myCorp.liquidCapital,
              liquidCurrencyCode: corpCode ?? null,
              bondUnits: corpHolding?.units ?? 0,
            };
            if (
              bankPropTradingEnabled &&
              myCorp.bankCharter?.status === "active" &&
              (myCorp.bankCharter.type === "investment" || myCorp.bankCharter.type === "universal")
            ) {
              investmentBank = {
                id: myCorp._id.toString(),
                name: myCorp.name,
                liquidCapital:
                  corpFxRate > 0 ? myCorp.liquidCapital / corpFxRate : myCorp.liquidCapital,
                liquidCapitalLocal: myCorp.liquidCapital,
                liquidCurrencyCode: corpCode ?? null,
                bondUnits:
                  myCorp.bankCharter.propBook
                    ?.filter((p) => p.asset === "bond" && p.ref === bond._id.toString())
                    .reduce((sum, p) => sum + p.units, 0) ?? 0,
              };
            }
          }
        }
      }
    }

    // Resolve holder names
    const characterIds = bond.holders.filter((h) => h.characterId).map((h) => h.characterId!);
    const imperialIds = bond.holders
      .filter((h) => h.imperialCharacterId)
      .map((h) => h.imperialCharacterId!);
    const corporationIds = bond.holders.filter((h) => h.corporationId).map((h) => h.corporationId!);

    const [charMap, imperialChars, holderCorps] = await Promise.all([
      bulkFetchCharacterNames(db, characterIds, { includeAvatar: true }),
      imperialIds.length > 0
        ? db
            .collection<ImperialCharacter>("imperialCharacters")
            .find({ _id: { $in: imperialIds } })
            .project<Pick<ImperialCharacter, "_id" | "name" | "avatarUrl" | "sequentialId">>({
              _id: 1,
              name: 1,
              avatarUrl: 1,
              sequentialId: 1,
            })
            .toArray()
        : [],
      corporationIds.length > 0
        ? db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: corporationIds } })
            .project<
              Pick<Corporation, "_id" | "name"> & { logoUrl?: string; sequentialId?: number }
            >({
              _id: 1,
              name: 1,
              logoUrl: 1,
              sequentialId: 1,
            })
            .toArray()
        : [],
    ]);

    const imperialMap = new Map(imperialChars.map((c) => [c._id.toString(), c]));
    const corpHolderMap = new Map(holderCorps.map((c) => [c._id.toString(), c]));

    const totalUnits = Math.floor(bond.totalIssued / BOND_UNIT_FACE_VALUE);
    const heldUnits = bond.holders.reduce((sum, h) => sum + h.units, 0);

    // Holder values are computed from BOND_UNIT_FACE_VALUE × marketPrice, both of
    // which are denominated in the bond's own currencyCode. Normalize to ₳ so
    // foreign-currency bonds (JPY ~100×, GBP) don't display wildly wrong holder
    // values. See the Bond.currencyCode docstring for the governing convention.
    const bondCcy = (bond.currencyCode ?? undefined) as CurrencyCode | undefined;
    const holderFxRates =
      bondCcy && (await isForexEnabled()) ? await loadFxRatesRecord(db) : undefined;
    const bondFxRate = bondCcy ? (holderFxRates?.[bondCcy] ?? 1) : 1;
    const holderValueAnchor = (units: number) =>
      Math.round(
        corpCapitalToAnchor(units * BOND_UNIT_FACE_VALUE * bond.marketPrice, bondCcy, bondFxRate) *
          100
      ) / 100;

    const holders = bond.holders.map((h) => {
      if (h.characterId) {
        const char = charMap.get(h.characterId.toString());
        return {
          type: "character" as const,
          id: h.characterId.toString(),
          name: char?.name ?? "Unknown",
          avatarUrl: char?.avatarUrl,
          sequentialId: char?.sequentialId,
          units: h.units,
          percentage: totalUnits > 0 ? (h.units / totalUnits) * 100 : 0,
          value: holderValueAnchor(h.units),
        };
      } else if (h.imperialCharacterId) {
        const ic = imperialMap.get(h.imperialCharacterId.toString());
        return {
          type: "character" as const,
          id: h.imperialCharacterId.toString(),
          name: ic?.name ?? "Unknown",
          avatarUrl: ic?.avatarUrl,
          sequentialId: ic?.sequentialId,
          units: h.units,
          percentage: totalUnits > 0 ? (h.units / totalUnits) * 100 : 0,
          value: holderValueAnchor(h.units),
        };
      } else if (h.corporationId) {
        const corp = corpHolderMap.get(h.corporationId.toString());
        return {
          type: "corporation" as const,
          id: h.corporationId.toString(),
          name: corp?.name ?? "Unknown",
          logoUrl: corp?.logoUrl,
          sequentialId: corp?.sequentialId,
          units: h.units,
          percentage: totalUnits > 0 ? (h.units / totalUnits) * 100 : 0,
          value: holderValueAnchor(h.units),
        };
      } else {
        // Defensive: holder with no identifiable owner — skip rendering
        return null;
      }
    });

    // Filter out null holders (defensive: entries with no owner ID) and sort by units descending
    const validHolders = holders.filter((h): h is NonNullable<typeof h> => h !== null);
    validHolders.sort((a, b) => b.units - a.units);

    // Get price history
    const priceHistory = await db
      .collection<BondHistory>("bondHistory")
      .find({ bondId: bond._id })
      .sort({ turn: 1 })
      .project({ _id: 0, turn: 1, marketPrice: 1, totalInterestPaid: 1 })
      .toArray();

    const turnsRemaining = Math.max(0, bond.maturityTurn - currentTurn);

    // Calculate annual coupon payment per unit
    const annualCouponPerUnit = (bond.couponRate / 100) * BOND_UNIT_FACE_VALUE;
    const perTurnCoupon = annualCouponPerUnit / TURNS_PER_YEAR;

    // Total interest paid = cumulative from history, or calculate from turns elapsed
    const turnsElapsed = currentTurn - bond.issuedAtTurn;
    const latestHistory = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1] : null;
    const totalInterestPaid = latestHistory?.totalInterestPaid ?? 0;

    const quote = await loadBondQuote(db, bond);

    return NextResponse.json({
      bond: {
        _id: bond._id.toString(),
        corporationId: bond.corporationId?.toString() ?? null,
        issuerType: bond.issuerType ?? "corporation",
        countryId: bond.countryId ?? null,
        // Bond's currency (Task 18B). Corporate bonds carry the issuer's
        // liquidCurrencyCode; sovereigns carry the country's currency.
        // Pre-stamp bonds fall through to countryId-derived default client-side.
        currencyCode: bond.currencyCode ?? null,
        corporationName: getBondIssuerDisplayName(bond, corporation?.name),
        corporationSequentialId: corporation?.sequentialId,
        corporationLogoUrl: corporation?.logoUrl,
        corporationBrandColor: corporation?.brandColor,
        faceValue: BOND_UNIT_FACE_VALUE,
        pricePerUnit: Math.round(BOND_UNIT_FACE_VALUE * bond.marketPrice * 100) / 100,
        couponRate: bond.couponRate,
        maturityTurns: bond.maturityTurns,
        maturityLabel:
          BOND_MATURITY_LABELS[bond.maturityTurns as BondMaturityTurns] ??
          `${bond.maturityTurns} turns`,
        issuedAtTurn: bond.issuedAtTurn,
        maturityTurn: bond.maturityTurn ?? bond.issuedAtTurn + bond.maturityTurns,
        turnsRemaining,
        turnsElapsed,
        marketPrice: bond.marketPrice,
        totalIssued: bond.totalIssued,
        totalUnits,
        publicFloat: bond.publicFloat,
        heldUnits,
        publicFloatPercentage: totalUnits > 0 ? (bond.publicFloat / totalUnits) * 100 : 0,
        // The market pool's live quote. Buys settle at the ask, sells at the
        // bid, and the pool can only buy `marketDepthUnits` right now.
        bidPricePerUnit: quote.bidPerUnit,
        askPricePerUnit: quote.askPerUnit,
        marketDepthUnits: quote.depthUnitsAtBid,
        defaulted: bond.defaulted,
        defaultedAtTurn: bond.defaultedAtTurn,
        defaultCure: bond.defaultCure ?? null,
        matured: bond.matured,
        annualCouponPerUnit,
        perTurnCoupon,
        totalInterestPaid,
        currentTurn,
        yieldToMaturity: calculateBondYieldToMaturityPercent(
          bond.couponRate,
          bond.marketPrice,
          turnsRemaining
        ),
      },
      holders: validHolders,
      priceHistory,
      user: {
        isCeo,
        myCharacterId,
        myCashOnHand,
        myBondUnits,
        myCorporation,
        investmentBank,
        ...(currencyBalances ? { currencyBalances, homeCurrency, autoConvertEnabled } : {}),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
