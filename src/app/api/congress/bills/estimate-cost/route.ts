/**
 * POST /api/congress/bills/estimate-cost
 *
 * Projects the annual budget cost of a DRAFT bill (not yet proposed) so the
 * propose-bill UI can show "Projected annual cost: ¥X (Y% of GDP)" live as the
 * player edits provisions. Read-only — computes, persists nothing.
 *
 * Reuses `validateBudgetImpact`, whose contract already accepts a draft bill.
 * `costAmount` comes back in the country's local currency (same scale as the
 * budget), so the client formats it with that country's currencyCode.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getEnabledCountryIdsFromDb } from "@/lib/countryAccess";
import { validateBudgetImpact } from "@/lib/budget/validation";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Bill } from "@/lib/db/types/legislation";
import type { FederalBudget } from "@/lib/db/types/budget";

const estimateSchema = z.object({
  countryId: z.string().min(1),
  provisions: z
    .array(
      z.object({
        legislationTypeId: z.string().min(1),
        policyOptionId: z.string().optional(),
        effectDirection: z.number().optional(),
      })
    )
    .max(20)
    .default([]),
});

/** federalBudget _id is "federal" for the US, otherwise the countryId. */
function federalBudgetId(countryId: CountryId): string {
  return countryId === COUNTRY_CONFIGS.US.id ? "federal" : countryId;
}

export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, estimateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { countryId: rawCountryId, provisions } = parsed.data;

    const db = await getDb();
    const enabled = await getEnabledCountryIdsFromDb(db);
    if (!enabled.includes(rawCountryId as CountryId)) {
      return NextResponse.json({ error: "Country not enabled" }, { status: 400 });
    }
    const countryId = rawCountryId as CountryId;
    const budgetId = federalBudgetId(countryId);

    const draft: Pick<Bill, "legislationTypeId" | "effectDirection" | "provisions"> = {
      provisions: provisions as Bill["provisions"],
    };
    const result = await validateBudgetImpact(db, draft, "national", { countryId, budgetId });

    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: budgetId }, { projection: { gdp: 1 } });
    const gdp = budget?.gdp ?? 0;
    const pctOfGdp = gdp > 0 ? (result.costAmount / gdp) * 100 : 0;

    return NextResponse.json({
      costAmount: result.costAmount,
      gdp,
      pctOfGdp,
      newTotalSpending: result.newTotalSpending,
      newDebt: result.newDebt ?? null,
      warning: result.warning ?? null,
      currencyCode: COUNTRY_CONFIGS[countryId]?.currencyCode ?? "USD",
    });
  } catch (error) {
    return handleRouteError(error, { request, route: "congress/bills/estimate-cost" });
  }
}
