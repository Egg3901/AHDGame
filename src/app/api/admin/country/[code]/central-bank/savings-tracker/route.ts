// GET /api/admin/country/[code]/central-bank/savings-tracker — Admin list of savings accounts in this CB currency
// Auth: requireAdmin
// Errors: 403, 404

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { Character } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  getLifetimeInterestEarnedInCurrency,
  getPersonalBalance,
  getSavingsBalance,
} from "@/lib/currency/characterFunds";

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId])
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    if (!FOREX_ACTIVE_COUNTRIES.includes(countryId)) {
      return NextResponse.json(
        { error: "High-yield savings are not available for this country." },
        { status: 404 }
      );
    }

    const forexEnabled = await isForexEnabled();
    if (!forexEnabled) {
      return NextResponse.json(
        { error: "Forex savings require the forex system." },
        { status: 404 }
      );
    }

    const db = await getDb();
    const nationalCurrency = COUNTRY_CURRENCY_MAP[countryId] as CurrencyCode;

    const chars = await db
      .collection<Character>("characters")
      .find({
        userId: { $exists: true },
        [`savingsAccountsOpened.${nationalCurrency}`]: true,
      })
      .project({
        _id: 1,
        name: 1,
        sequentialId: 1,
        avatarUrl: 1,
        currencyBalances: 1,
        savingsAccountsOpened: 1,
      })
      .toArray();

    const accounts = chars.map((char) => {
      const full = char as Character;
      const savingsBalance = getSavingsBalance(full, nationalCurrency, true);
      const walletBalance = getPersonalBalance(full, nationalCurrency, true);
      const lifetimeInterest = getLifetimeInterestEarnedInCurrency(full, nationalCurrency, true);
      const pendingInterest =
        full.currencyBalances?.pendingSavingsInterest?.[nationalCurrency] ?? 0;
      return {
        characterId: char._id.toHexString(),
        sequentialId: char.sequentialId,
        name: char.name,
        avatarUrl: char.avatarUrl,
        savingsBalanceFace: savingsBalance,
        walletBalanceFace: walletBalance,
        pendingInterestFace: pendingInterest,
        lifetimeInterestEarnedFace: lifetimeInterest,
      };
    });

    accounts.sort((a, b) => b.savingsBalanceFace - a.savingsBalanceFace);

    return NextResponse.json({
      countryId,
      currencyCode: nationalCurrency,
      accounts,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
