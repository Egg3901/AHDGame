// GET /api/country/[code]/region/[id]/budget — Return the budget breakdown for a region/state
// Auth: requireAuth
// Errors: 401, 404
//
// **Currency (v0.2.6):** State/regional budgets inherit their parent country's
// currency. Response includes `currencyCode` (resolved from countryId) so the
// client can format every money field without re-deriving. Same code applies
// to the regional branch (UK councils, JP prefectures).
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getCountryConfig, isParliamentarySystem, type CountryId } from "@/lib/constants/countries";
import type { StateBudget, EnactedLaw } from "@/lib/db/types/budget";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { LegislationType } from "@/lib/db/types/legislation";
import type { State } from "@/lib/db/types";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { normalizeStateSpending, SECTOR_SUBSIDIES_SPENDING_KEY } from "@/lib/budget/spending";
import { computeRegionalSpendingByCategory } from "@/lib/budget/regionalSpending";
import { buildRegionalRevenueShape } from "@/lib/budget/regionalRevenueShape";
import { calculateFiscalYear } from "@/lib/budget/fiscalYear";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    const config = getCountryConfig(countryId);
    if (!config) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    const stateId = id;
    const db = await getDb();

    // Parliamentary countries use the regionalBudgets collection
    if (isParliamentarySystem(config)) {
      return serveRegionalBudget(db, stateId, countryId, config.centralGovernmentLabel);
    }

    // Presidential countries (US) use stateBudgets
    return serveStateBudget(db, stateId, countryId, config.centralGovernmentLabel);
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Tax type IDs excluded from spending calculations per country */
const TAX_TYPE_IDS_BY_COUNTRY: Record<string, Set<string>> = {
  UK: new Set(["uk_council_tax", "uk_business_rates"]),
  JP: new Set(["jp_resident_tax", "jp_fixed_asset_tax"]),
  DE: new Set(["de_income_tax_rate", "de_vat_rate"]),
};

/** Serve parliamentary-style regional budget from the regionalBudgets collection */
async function serveRegionalBudget(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>,
  stateId: string,
  countryId: CountryId,
  grantLabel: string
) {
  const gameState = await db
    .collection("gameState")
    .findOne({ _id: "current" } as Record<string, unknown>, {
      projection: { currentTurn: 1, currentYear: 1 },
    });
  const liveFiscalYear = calculateFiscalYear(
    (gameState as { currentYear?: number } | null)?.currentYear ?? 2020,
    (gameState as { currentTurn?: number } | null)?.currentTurn ?? 1
  );

  const regionalBudget = await db
    .collection<RegionalBudget>("regionalBudgets")
    .findOne({ _id: stateId, countryId });

  if (!regionalBudget) {
    let fallbackStateBudget = await db.collection<StateBudget>("stateBudgets").findOne({
      _id: stateId,
      countryId,
    });
    if (!fallbackStateBudget) {
      const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
      if (state) {
        const { generateStateBudgets } = await import("@/lib/seeds/reference/budgets");
        fallbackStateBudget =
          generateStateBudgets([
            {
              id: state._id,
              population: state.population,
              gdp: state.gdp,
              countryId: state.countryId,
            },
          ])[0] ?? null;
      }
    }
    if (!fallbackStateBudget) {
      return NextResponse.json({ error: "Regional budget not found" }, { status: 404 });
    }

    const enactedLaws = await db
      .collection<EnactedLaw>("enactedLaws")
      .find({ scope: "state", stateId, countryId, repealedAt: { $exists: false } })
      .toArray();

    return NextResponse.json({
      budget: {
        ...fallbackStateBudget,
        fiscalYear: liveFiscalYear,
        spending: normalizeStateSpending(fallbackStateBudget.spending),
      },
      enactedLaws,
      grantBreakdown: [
        {
          program: grantLabel,
          amount: fallbackStateBudget.revenue.federalGrants ?? 0,
        },
      ],
      currencyCode: resolveCountryCurrencyCode({ countryId }),
    });
  }

  // Fetch state for the region's fiscal base (population + GDP)
  const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
  const population = state?.population ?? 0;

  // Compute spending by category from enacted regional policies
  const taxTypeIds = TAX_TYPE_IDS_BY_COUNTRY[countryId] ?? new Set();
  const regionPolicies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId, scope: "state" })
    .toArray();

  const spendingPolicies = regionPolicies.filter((p) => !taxTypeIds.has(p.legislationTypeId));

  // Fetch legislation types to look up policyDomain and annualCostPerCapita
  // (legacy policies only — v2 laws price through the shared cost engine).
  const legTypeIds = spendingPolicies.map((p) => p.legislationTypeId);
  const legTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find({ _id: { $in: legTypeIds } })
    .toArray();

  const byCategory = computeRegionalSpendingByCategory({
    policies: spendingPolicies,
    legTypes,
    countryId,
    regionGdp: (state?.gdp ?? 0) * 1_000_000,
    regionPopulation: population,
  });
  byCategory[SECTOR_SUBSIDIES_SPENDING_KEY] = regionalBudget.subsidyCosts ?? 0;

  const spendingTotal = Object.values(byCategory).reduce((sum, v) => sum + v, 0);

  // Per-country revenue view of the shared regionalBudgets document.
  const { revenue, grantAmount } = buildRegionalRevenueShape(regionalBudget);

  const budget = {
    _id: stateId,
    stateId,
    fiscalYear: liveFiscalYear,
    revenue,
    taxRates: {},
    taxBases: {},
    spending: {
      byCategory,
      total: spendingTotal,
    },
    balance: regionalBudget.surplus,
    surplus: regionalBudget.surplus,
    stateGdp: 0,
    updatedAt: regionalBudget.updatedAt,
  };

  // Fetch enacted regional laws
  const enactedLaws = await db
    .collection<EnactedLaw>("enactedLaws")
    .find({ scope: "state", stateId, countryId, repealedAt: { $exists: false } })
    .toArray();

  const grantBreakdown = [{ program: grantLabel, amount: grantAmount }];

  return NextResponse.json({
    budget,
    enactedLaws,
    grantBreakdown,
    currencyCode: resolveCountryCurrencyCode({ countryId }),
  });
}

/** Serve US-style state budget from the stateBudgets collection */
async function serveStateBudget(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>,
  stateId: string,
  countryId: CountryId,
  grantLabel: string
) {
  const stateBudget = await db
    .collection<StateBudget>("stateBudgets")
    .findOne({ _id: stateId, countryId });
  if (!stateBudget) {
    return NextResponse.json({ error: "State budget not found" }, { status: 404 });
  }

  const enactedLaws = await db
    .collection<EnactedLaw>("enactedLaws")
    .find({ scope: "state", stateId, repealedAt: { $exists: false } })
    .toArray();

  const grantBreakdown = [
    { program: "Medicaid", amount: stateBudget.revenue.federalGrants * 0.55 },
    { program: "Highway Fund", amount: stateBudget.revenue.federalGrants * 0.19 },
    { program: "Education", amount: stateBudget.revenue.federalGrants * 0.15 },
    { program: "SNAP", amount: stateBudget.revenue.federalGrants * 0.11 },
  ];
  const spending = normalizeStateSpending(stateBudget.spending);
  const balance = stateBudget.revenue.total - spending.total;

  return NextResponse.json({
    budget: {
      ...stateBudget,
      spending,
      surplus: balance,
      balance,
    },
    enactedLaws,
    grantBreakdown,
    grantLabel,
    currencyCode: resolveCountryCurrencyCode({ countryId }),
  });
}
