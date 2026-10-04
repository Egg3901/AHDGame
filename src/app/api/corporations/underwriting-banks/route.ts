import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { listPrimaryUnderwritingBanks } from "@/lib/banking/underwritingOffer";
import { COUNTRY_CURRENCY_MAP, getSeedCurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { isForexEnabled } from "@/lib/currency/featureFlag";

/** Same-currency eligible banks for founding an IPO; flag-off does not read bank corporations. */
export async function GET(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const countryId = new URL(request.url).searchParams.get("countryId")?.toUpperCase();
    if (!countryId || !(countryId in COUNTRY_CURRENCY_MAP)) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const db = await getDb();
    const policy = await loadBankingPolicy(db);
    if (!policy.primaryUnderwriting) {
      return NextResponse.json({ enabled: false, banks: [] });
    }
    const [forexEnabled, gameState] = await Promise.all([
      isForexEnabled(),
      db.collection("gameState").findOne({ _id: "current" }, { projection: { preset: 1 } }),
    ]);
    const currencyCode = forexEnabled
      ? getSeedCurrencyCode(countryId as CountryId, gameState?.preset ?? DEFAULT_SEED_PRESET)
      : "USD";
    const banks = await listPrimaryUnderwritingBanks(db, policy, currencyCode);
    return NextResponse.json({ enabled: true, currencyCode, banks });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/corporations/underwriting-banks" });
  }
}
