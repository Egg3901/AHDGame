import { NextResponse } from "next/server";
import { findMergedRegionMetrics, findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { State, StateApprovalHistory, GameState } from "@/lib/db/types";
import type { StateDemographics } from "@/lib/db/types/demographics";
import { resolveGameYear } from "@/lib/era/era";
import { getActiveAddressApprovalModifiers } from "@/lib/governorOffice/address/activeAddressModifiers";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import {
  BASE_APPROVAL,
  calculateStateApproval,
  computeStateApprovalBase,
  computeNationalAveragesFromMetrics,
  buildFlatMetrics,
} from "@/lib/utils/governmentApproval";
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";
import { computeStateTickRates } from "@/lib/api/stateTickRates";
import { marginEffectForModifier } from "@/lib/states/conditions/marginEffects";
import {
  NATIONAL_SCOPE,
  NATIONAL_SCOPE_IDS,
  getNationalDocId,
} from "@/lib/constants/nationalScope";

// GET /api/country/[code]/region/[id]/metrics — Return all state metrics including government approval and tick rates
// Auth: public
// Errors: 400, 404
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    // Accept region codes (e.g. "PA", "LON", "ON") or national scope IDs
    const isNational = NATIONAL_SCOPE_IDS.has(stateId);

    const db = await getDb();

    const hasSubNationalChamber =
      getCountryConfig(countryId).subNationalChamber?.regionalModel === true;

    // state, metrics, and (for regional-model countries like UK) budget are independent — fetch in parallel
    const [state, metrics, budgetDoc] = await Promise.all([
      isNational
        ? Promise.resolve(null)
        : db.collection<State>("states").findOne({ _id: stateId, countryId }),
      // SP5: merged two-store view.
      isNational
        ? findMergedRegionMetrics(db, { _id: stateId })
        : findMergedRegionMetrics(db, { _id: stateId, countryId }),
      hasSubNationalChamber
        ? db.collection<RegionalBudget>("regionalBudgets").findOne({ _id: stateId, countryId })
        : Promise.resolve(null),
    ]);

    if (!isNational && !state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }
    if (!metrics) {
      return NextResponse.json({ error: "Metrics not found for this state" }, { status: 404 });
    }

    // Determine countryId: from params for real states, from NATIONAL_SCOPE for national IDs
    const resolvedCountryId: CountryId = state ? state.countryId : NATIONAL_SCOPE[stateId];

    // nationalDoc, tickRates, approval history, and game clock are independent — fetch in parallel
    const nationalDocId = getNationalDocId(resolvedCountryId);
    const [nationalDoc, tickRates, approvalHistoryDoc, gameStateDoc, countryMetricsRaw] =
      await Promise.all([
        nationalDocId ? findMergedRegionMetrics(db, { _id: nationalDocId }) : Promise.resolve(null),
        isNational ? Promise.resolve({}) : computeStateTickRates(db, stateId, resolvedCountryId),
        db.collection<StateApprovalHistory>("stateApprovalHistory").findOne({ _id: stateId }),
        db.collection<GameState>("gameState").findOne({ _id: "current" }),
        findMergedRegionMetricsMany(db, { countryId: resolvedCountryId }),
      ]);

    // Approval is scored relative to the SIMPLE MEAN of the country's states —
    // the same baseline the region page hero and the per-turn snapshot use — so
    // the tab header's approval matches the hero (not the precomputed national doc).
    const approvalAverages = computeNationalAveragesFromMetrics(
      countryMetricsRaw.filter((m) => !NATIONAL_SCOPE_IDS.has(String(m._id)))
    );

    // National-doc averages drive the metric cards' "vs national" comparison so
    // they agree with the National Metrics page (which shows that same doc).
    // Cold start: the national rollup doc only exists after the first turn —
    // fall back to the simple country mean so fresh worlds still compare.
    const nationalAverages: Record<string, Record<string, number>> = nationalDoc
      ? buildFlatMetrics(nationalDoc)
      : approvalAverages;

    const flat = buildFlatMetrics(metrics);
    // Include active State-of-the-State address approval modifiers so this matches
    // the region page hero's approval (and the per-turn snapshot), which both
    // factor them in. Without this the metrics tab showed a slightly different %.
    const currentTurn = gameStateDoc?.currentTurn ?? 0;
    const preset = gameStateDoc?.preset ?? null;
    // Live year for era-aware scoring; null while the flag is off (legacy path).
    const year = gameStateDoc?.eraSystemEnabled ? resolveGameYear(gameStateDoc) : null;
    const addressModifiers = await getActiveAddressApprovalModifiers(
      db,
      resolvedCountryId,
      stateId,
      currentTurn
    );
    // P6d: this region's demographic groups, so the displayed approval matches
    // the electorate-weighted value the per-turn snapshot stores.
    const demographicsDoc = await db
      .collection<StateDemographics>("stateDemographics")
      .findOne({ _id: stateId, countryId: resolvedCountryId }, { projection: { groups: 1 } });
    const regionGroups = Object.values(demographicsDoc?.groups ?? {});
    const weighting = regionGroups.length > 0 ? { groups: regionGroups } : undefined;
    // SP4: playable countries score from the hybrid political base.
    let baseOverride: number | undefined;
    if (isPoliticalApprovalCountry(resolvedCountryId)) {
      const bases = await loadPoliticalApprovalBases(db, resolvedCountryId);
      baseOverride = bases?.byRegion.get(stateId) ?? BASE_APPROVAL;
    }
    const governmentApprovalBase =
      baseOverride ??
      computeStateApprovalBase(metrics, approvalAverages, weighting, preset ?? undefined);
    const governmentApproval = calculateStateApproval(
      metrics,
      approvalAverages,
      addressModifiers,
      weighting,
      preset,
      year,
      baseOverride
    );
    const governmentApprovalModifiers = [
      ...evaluateModifiers(flat, { preset, countryId: resolvedCountryId, year }).map((m) => ({
        ...m,
        marginEffect:
          m.marginEffect ?? (m.source === "address" ? 0 : marginEffectForModifier(m.effect, m.id)),
      })),
      ...addressModifiers.map((m) => ({
        ...m,
        marginEffect:
          m.marginEffect ?? (m.source === "address" ? 0 : marginEffectForModifier(m.effect, m.id)),
      })),
    ];

    // Shape regional budget data for parliamentary countries. Keep the shared
    // UK keys for legacy consumers, but surface JP/DE revenue fields too so
    // country-specific pages can render the correct breakdown without another
    // fetch.
    const budget = budgetDoc
      ? {
          councilTaxRevenue: budgetDoc.councilTaxRevenue,
          businessRatesRevenue: budgetDoc.businessRatesRevenue,
          westminsterGrant: budgetDoc.westminsterGrant,
          residentTaxRevenue: budgetDoc.residentTaxRevenue ?? null,
          fixedAssetTaxRevenue: budgetDoc.fixedAssetTaxRevenue ?? null,
          nationalGrant: budgetDoc.nationalGrant ?? null,
          incomeTaxShare: budgetDoc.incomeTaxShare ?? null,
          vatShare: budgetDoc.vatShare ?? null,
          federalEqualizationGrant: budgetDoc.federalEqualizationGrant ?? null,
          tradeTaxRevenue: budgetDoc.tradeTaxRevenue ?? null,
          eitShare: budgetDoc.eitShare ?? null,
          centralTransferGrant: budgetDoc.centralTransferGrant ?? null,
          resourceTaxRevenue: budgetDoc.resourceTaxRevenue ?? null,
          businessTaxRevenue: budgetDoc.businessTaxRevenue ?? null,
          totalBudget: budgetDoc.totalBudget,
          enactedBillCosts: budgetDoc.enactedBillCosts,
          surplus: budgetDoc.surplus,
          isOverBudget: budgetDoc.isOverBudget,
          turnsOverBudget: budgetDoc.turnsOverBudget,
        }
      : null;

    return NextResponse.json(
      {
        stateId,
        stateName: state?.name ?? stateId,
        // Region-level economic STOCKS (states doc) the rate metrics can't carry:
        // GDP level (millions), the cyclical output gap, capital stock, population.
        // null for national-scope synthetic docs (no states row). Consumed by the
        // Metrics tab's GdpDecompositionCard (P1d-3).
        economyStock: state
          ? {
              gdp: state.gdp ?? null,
              outputGap: state.outputGap ?? null,
              capitalStock: state.capitalStock ?? null,
              population: state.population ?? null,
            }
          : null,
        metrics,
        nationalAverages,
        governmentApproval,
        governmentApprovalBase,
        governmentApprovalModifiers,
        approvalHistory: approvalHistoryDoc?.history ?? [],
        tickRates,
        budget,
      },
      {
        headers: {
          // cache policy: game-state — stateMetrics updated every turn; short CDN TTL
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
