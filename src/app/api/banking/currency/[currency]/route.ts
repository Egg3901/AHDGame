import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { ZOD_CURRENCY_ENUM, type CurrencyCode } from "@/lib/constants/currencies";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { isChairOfCurrencyBank } from "@/lib/banking/charter";
import {
  getReserveRequirement,
  RESERVE_REQUIREMENT_MIN,
  RESERVE_REQUIREMENT_MAX,
} from "@/lib/banking/reserves";
import { getInsuredCap } from "@/lib/banking/insurance";
import type { DepositInsuranceFund } from "@/lib/db/types/bank";
import type { GameConfig } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ currency: string }>;
}

// GET /api/banking/currency/[currency] - Reserve requirement + insurance fund for a currency.
// Auth: requireAuth
// Errors: 400, 401, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { currency: raw } = await params;
    const code = raw.toUpperCase();
    if (!(ZOD_CURRENCY_ENUM as readonly string[]).includes(code)) {
      throw badRequest("Invalid currency");
    }
    const currency = code as CurrencyCode;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          privateBankingEnabled: 1,
          bankPropTradingEnabled: 1,
          bankContagionEnabled: 1,
        },
      }
    );
    const privateEnabled = await isPrivateBankingEnabled(config);

    // Reserve + insurance surfaces exist even when the flag is off (read-only freeze).
    const [reserveRatio, insuredCap] = await Promise.all([
      getReserveRequirement(db, currency),
      getInsuredCap(db, currency),
    ]);

    const fund = await db.collection<DepositInsuranceFund>("depositInsuranceFunds").findOne({
      _id: currency,
    });

    const isAdmin = auth.user.isAdmin === true;
    let isChair = false;
    if (auth.user.character) {
      isChair = await isChairOfCurrencyBank(db, auth.user.character._id, currency);
    }

    return NextResponse.json({
      privateBankingEnabled: privateEnabled,
      currency,
      reserveRatio,
      reserveMin: RESERVE_REQUIREMENT_MIN,
      reserveMax: RESERVE_REQUIREMENT_MAX,
      canEditReserve: privateEnabled && (isAdmin || isChair),
      isAdmin,
      isChair,
      insuredCap: fund?.insuredCap ?? insuredCap,
      insuranceFund: fund
        ? {
            balance: fund.balance,
            insuredCap: fund.insuredCap,
            premiumsCollectedLifetime: fund.premiumsCollectedLifetime,
            payoutsLifetime: fund.payoutsLifetime,
            treasuryBackstopLifetime: fund.treasuryBackstopLifetime,
          }
        : {
            balance: 0,
            insuredCap,
            premiumsCollectedLifetime: 0,
            payoutsLifetime: 0,
            treasuryBackstopLifetime: 0,
          },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
