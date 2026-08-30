import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryForexCurrency } from "@/lib/publicApi/forex";
import { parseBoundedInt } from "@/lib/publicApi/params";
import { publicError } from "@/lib/publicApi/errors";
import {
  FOREX_ACTIVE_CURRENCIES,
  type CurrencyCode,
} from "@/lib/constants/currencies";

// GET /api/public/v1/forex/[currency]?history=N
export async function GET(
  request: Request,
  { params }: { params: Promise<{ currency: string }> }
) {
  try {
    const guard = await publicApiGuard(request, "forex-detail");
    if (!guard.ok) return guard.response;
    const { currency: rawCurrency } = await params;
    const currency = rawCurrency.toUpperCase() as CurrencyCode;
    if (!FOREX_ACTIVE_CURRENCIES.includes(currency)) {
      return publicError("BAD_REQUEST", "Invalid or inactive currency code", 400);
    }
    const parsed = parseBoundedInt(new URL(request.url).searchParams.get("history"), {
      name: "history",
      defaultValue: 48,
      min: 1,
      max: 240,
    });
    if (!parsed.ok) return publicError("BAD_REQUEST", parsed.message, 400);
    const result = await queryForexCurrency(await getDb(), currency, parsed.value);
    if (!result) return publicError("NOT_FOUND", "Currency not found", 404);
    return NextResponse.json({ ok: true, found: true, currency: result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
