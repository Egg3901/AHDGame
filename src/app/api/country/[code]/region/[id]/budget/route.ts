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

/** Display labels for policy domains */
const DOMAIN_LABELS: Record<string, string> = {
  healthcare: "Healthcare",
  education: "Education",
  infrastructure: "Infrastructure",
  publicSafety: "Public Safety",
  environment: "Environment",
  social: "Social Services",
  governance: "Governance",
  economic: "Economic Development",
  defense: "Defense",
  immigration: "Immigration",
  agriculture: "Agriculture",
  foreign_policy: "Foreign Policy",
  technology: "Technology",
  law_justice: "Law & Justice",
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

  // Fetch state and region population for per-capita cost calculation
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
  const legTypeIds = spendingPolicies.map((p) => p.legislationTypeId);
  const legTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find({ _id: { $in: legTypeIds } })
    .toArray();
  const legTypeMap = new Map(legTypes.map((lt) => [lt._id, lt]));

  const byCategory: Record<string, number> = {};
  for (const policy of spendingPolicies) {
    const lt = legTypeMap.get(policy.legislationTypeId);
    if (!lt?.policyOptions) continue;
    const option = lt.policyOptions.find((o) => o.id === policy.policyOptionId);
    const costPerCapita = option?.annualCostPerCapita ?? 0;
    const totalCost = costPerCapita * population;
    if (totalCost <= 0) continue;
    const category = DOMAIN_LABELS[lt.policyDomain ?? ""] ?? lt.policyDomain ?? "Other";
    byCategory[category] = (byCategory[category] ?? 0) + totalCost;
  }
  byCategory[SECTOR_SUBSIDIES_SPENDING_KEY] = regionalBudget.subsidyCosts ?? 0;

  const spendingTotal = Object.values(byCategory).reduce((sum, v) => sum + v, 0);

  // Build revenue breakdown based on country — each parliamentary country has
  // its own revenue model, but they all persist into the shared regionalBudgets
  // collection so downstream UI can stay on one route.
  const hasJPRevenue = regionalBudget.residentTaxRevenue != null;
  const hasDERevenue = regionalBudget.incomeTaxShare != null || regionalBudget.vatShare != null;
  const hasCNRevenue =
    regionalBudget.eitShare != null || regionalBudget.centralTransferGrant != null;
  const revenue = hasJPRevenue
    ? {
        residentTax: regionalBudget.residentTaxRevenue ?? 0,
        fixedAssetTax: regionalBudget.fixedAssetTaxRevenue ?? 0,
        federalGrants: regionalBudget.nationalGrant ?? 0,
        total: regionalBudget.totalBudget,
      }
    : hasDERevenue
      ? {
          incomeTaxShare: regionalBudget.incomeTaxShare ?? 0,
          vatShare: regionalBudget.vatShare ?? 0,
          tradeTaxRevenue: regionalBudget.tradeTaxRevenue ?? 0,
          federalGrants: regionalBudget.federalEqualizationGrant ?? 0,
          total: regionalBudget.totalBudget,
        }
      : hasCNRevenue
        ? {
            eitShare: regionalBudget.eitShare ?? 0,
            centralTransferGrant: regionalBudget.centralTransferGrant ?? 0,
            resourceTaxRevenue: regionalBudget.resourceTaxRevenue ?? 0,
            businessTaxRevenue: regionalBudget.businessTaxRevenue ?? 0,
            total: regionalBudget.totalBudget,
          }
        : {
            councilTax: regionalBudget.councilTaxRevenue,
            businessRates: regionalBudget.businessRatesRevenue,
            federalGrants: regionalBudget.westminsterGrant,
            total:
              regionalBudget.councilTaxRevenue +
              regionalBudget.businessRatesRevenue +
              regionalBudget.westminsterGrant,
          };

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

  const grantAmount = hasJPRevenue
    ? (regionalBudget.nationalGrant ?? 0)
    : hasDERevenue
      ? (regionalBudget.federalEqualizationGrant ?? 0)
      : hasCNRevenue
        ? (regionalBudget.centralTransferGrant ?? 0)
        : regionalBudget.westminsterGrant;
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
