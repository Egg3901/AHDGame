import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { GameConfig } from "@/lib/db/types";
import { getMarketSystemMode, type MarketSystemMode } from "@/lib/market/featureFlag";
import { MARKET_MODE_INFO, MARKET_MODE_ORDER } from "@/lib/market/modes";
import { getCurrentTurn } from "@/lib/currentTurn";
import {
  economicInterventionPlanSchema,
  validateInterventionActivation,
  type EconomicInterventionPlan,
} from "@/lib/economy/interventionGovernance";

// Enum derived from the canonical order so route validation can never drift
// from the client selector or the engine.
const patchSchema = z.object({
  mode: z.enum(MARKET_MODE_ORDER as [MarketSystemMode, ...MarketSystemMode[]]),
  // Escape hatch for setting a tier whose MARKET_MODE_INFO.live is false. The
  // admin selector disables those options, but `live: false` was UI-ONLY — a
  // direct PATCH (curl, a stale tab, a script) could flip the live world onto
  // an unlaunched tier with nothing to stop it. Explicit opt-in, so enabling a
  // non-live tier is always a deliberate act that shows up in the admin log.
  allowNonLive: z.boolean().optional(),
  // Launch-safety governor (optional): bound + fade-in for the clearing/throughput
  // legs. Tunable live so the flip can be tightened/loosened without a deploy.
  governorCap: z.number().min(0).max(1).optional(),
  governorRampTurns: z.number().int().min(1).max(10_000).optional(),
  // Scarcity price drift (optional): persistent-imbalance price integrator.
  // Flippable live; off resets all multipliers to 1 within one turn.
  scarcityDriftEnabled: z.boolean().optional(),
  stockCoverCapEnabled: z.boolean().optional(),
  // Brand loyalty (Package A). `brandLoyaltyEnabled` turns on per-turn accrual
  // (shadow-safe on its own); `brandLoyaltySliceEnabled` additionally applies
  // the loyal-slice pre-pass in clearing — the A1→A2 gate.
  brandLoyaltyEnabled: z.boolean().optional(),
  brandLoyaltySliceEnabled: z.boolean().optional(),
  // Output quality (four pillars). Computes per-sector quality + corp
  // averageQuality + per-commodity quality propagation. Display-safe.
  sectorQualityEnabled: z.boolean().optional(),
  // Package B: quality → premium pricing coupling (requires sectorQualityEnabled).
  qualityPremiumPricingEnabled: z.boolean().optional(),
  supplyAgreementsEnabled: z.boolean().optional(),
  shortageResponsiveSourcingEnabled: z.boolean().optional(),
  intervention: economicInterventionPlanSchema.optional(),
  indexFundBondLiquidityEnabled: z.boolean().optional(),
  bondLiquidityIntervention: economicInterventionPlanSchema.optional(),
  equityLiquidityFacilityEnabled: z.boolean().optional(),
  equityLiquidityIntervention: economicInterventionPlanSchema.optional(),
  nppMarketCoverageEnabled: z.boolean().optional(),
  marketCoverageIntervention: economicInterventionPlanSchema.optional(),
  demographicsDemandEnabled: z.boolean().optional(),
  nppCorpsAttackable: z.boolean().optional(),
  nppCorporateAttacksEnabled: z.boolean().optional(),
  // Structural extraction-shortage stabilizer (audit t873): lifts per-resource
  // extraction supply via EXTRACTION_OUTPUT_SCALE to neutralize the chronic
  // extractable shortage (manufacturing revenue structurally out-masses
  // extraction revenue in the S/D ratio). Calibration stabilizer, not the
  // durable fix — see src/lib/constants/commodities.ts.
  extractionOutputScaleEnabled: z.boolean().optional(),
  // Command-economy regime (P0 / command-lite). Default off; stamps audit
  // fields when toggled. Tolerance lever is 0 (full repression) → 1 (tolerated).
  commandEconomyEnabled: z.boolean().optional(),
  commandEconomySecondEconomyTolerance: z.number().min(0).max(1).optional(),
});

// GET /api/admin/config/market — Structural market rework mode + feature flags
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          marketSystemMode: 1,
          commodityScarcityDriftEnabled: 1,
          stockCoverCapEnabled: 1,
          brandLoyaltyEnabled: 1,
          brandLoyaltySliceEnabled: 1,
          sectorQualityEnabled: 1,
          qualityPremiumPricingEnabled: 1,
          supplyAgreementsEnabled: 1,
          shortageResponsiveSourcingEnabled: 1,
          indexFundBondLiquidityEnabled: 1,
          equityLiquidityFacilityEnabled: 1,
          nppMarketCoverageEnabled: 1,
          extractionOutputScaleEnabled: 1,
          commandEconomyEnabled: 1,
          commandEconomySecondEconomyTolerance: 1,
        },
      }
    );

    const mode = await getMarketSystemMode();
    return NextResponse.json({
      mode,
      scarcityDriftEnabled: config?.commodityScarcityDriftEnabled === true,
      stockCoverCapEnabled: config?.stockCoverCapEnabled === true,
      brandLoyaltyEnabled: config?.brandLoyaltyEnabled === true,
      brandLoyaltySliceEnabled: config?.brandLoyaltySliceEnabled === true,
      sectorQualityEnabled: config?.sectorQualityEnabled === true,
      qualityPremiumPricingEnabled: config?.qualityPremiumPricingEnabled === true,
      supplyAgreementsEnabled: config?.supplyAgreementsEnabled === true,
      shortageResponsiveSourcingEnabled: config?.shortageResponsiveSourcingEnabled === true,
      indexFundBondLiquidityEnabled: config?.indexFundBondLiquidityEnabled === true,
      equityLiquidityFacilityEnabled: config?.equityLiquidityFacilityEnabled === true,
      nppMarketCoverageEnabled: config?.nppMarketCoverageEnabled === true,
      extractionOutputScaleEnabled: config?.extractionOutputScaleEnabled === true,
      commandEconomyEnabled: config?.commandEconomyEnabled === true,
      commandEconomySecondEconomyTolerance:
        typeof config?.commandEconomySecondEconomyTolerance === "number"
          ? config.commandEconomySecondEconomyTolerance
          : 0.3,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/config/market — Set market system mode
// Auth: requireAdmin
// Errors: 400, 403
//
// Tier 1 ("realization") is live: realized sector revenue is scaled by the
// lagged market price of its outputs. Higher tiers (ledger/clearing/capital/
// plants) are scaffolding until their phases land and read the flag (see
// docs/plans/2026-07-03-market-structural-plan.md). "off" reverts the economy
// to baseline behaviour.
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const {
      mode,
      allowNonLive,
      governorCap,
      governorRampTurns,
      scarcityDriftEnabled,
      stockCoverCapEnabled,
      brandLoyaltyEnabled,
      brandLoyaltySliceEnabled,
      sectorQualityEnabled,
      qualityPremiumPricingEnabled,
      supplyAgreementsEnabled,
      shortageResponsiveSourcingEnabled,
      intervention,
      indexFundBondLiquidityEnabled,
      bondLiquidityIntervention,
      equityLiquidityFacilityEnabled,
      equityLiquidityIntervention,
      nppMarketCoverageEnabled,
      marketCoverageIntervention,
      demographicsDemandEnabled,
      nppCorpsAttackable,
      nppCorporateAttacksEnabled,
      extractionOutputScaleEnabled,
      commandEconomyEnabled,
      commandEconomySecondEconomyTolerance,
    } = parsed.data as {
      mode: MarketSystemMode;
      allowNonLive?: boolean;
      governorCap?: number;
      governorRampTurns?: number;
      scarcityDriftEnabled?: boolean;
      stockCoverCapEnabled?: boolean;
      brandLoyaltyEnabled?: boolean;
      brandLoyaltySliceEnabled?: boolean;
      sectorQualityEnabled?: boolean;
      qualityPremiumPricingEnabled?: boolean;
      supplyAgreementsEnabled?: boolean;
      shortageResponsiveSourcingEnabled?: boolean;
      intervention?: EconomicInterventionPlan;
      indexFundBondLiquidityEnabled?: boolean;
      bondLiquidityIntervention?: EconomicInterventionPlan;
      equityLiquidityFacilityEnabled?: boolean;
      equityLiquidityIntervention?: EconomicInterventionPlan;
      nppMarketCoverageEnabled?: boolean;
      marketCoverageIntervention?: EconomicInterventionPlan;
      demographicsDemandEnabled?: boolean;
      nppCorpsAttackable?: boolean;
      nppCorporateAttacksEnabled?: boolean;
      extractionOutputScaleEnabled?: boolean;
      commandEconomyEnabled?: boolean;
      commandEconomySecondEconomyTolerance?: number;
    };

    // Server-side launch gate. MARKET_MODE_INFO[mode].live is the single source
    // of truth for "has this tier actually shipped"; enforce it here so the API
    // agrees with the selector instead of trusting the client.
    if (MARKET_MODE_INFO[mode].live !== true && allowNonLive !== true) {
      return NextResponse.json(
        {
          error:
            `Market mode "${mode}" is not live yet. ` +
            `Pass allowNonLive: true to set it deliberately.`,
        },
        { status: 400 }
      );
    }

    const db = await getDb();
    const gameConfig = db.collection<GameConfig>("gameConfig");

    const priorMode = await getMarketSystemMode();
    // Stamp the turn, not just the clock. See `marketSystemModeUpdatedTurn` in
    // the GameConfig type for why: the whole soak/rollback vocabulary is
    // turn-indexed, and a wall-clock timestamp cannot be mapped back to a turn
    // on a world whose cadence paused. Read before the write so the recorded
    // turn is the one the world was on when the operator acted.
    const currentTurn = await getCurrentTurn(db);
    if (shortageResponsiveSourcingEnabled === true) {
      if (!intervention) {
        return NextResponse.json(
          { error: "An economic intervention plan is required to enable shortage sourcing." },
          { status: 400 }
        );
      }
      const activationError = validateInterventionActivation(intervention, currentTurn);
      if (activationError) {
        return NextResponse.json({ error: activationError }, { status: 400 });
      }
    }
    if (indexFundBondLiquidityEnabled === true) {
      if (!bondLiquidityIntervention) {
        return NextResponse.json(
          { error: "An economic intervention plan is required to enable bond liquidity." },
          { status: 400 }
        );
      }
      const activationError = validateInterventionActivation(
        bondLiquidityIntervention,
        currentTurn
      );
      if (activationError) {
        return NextResponse.json({ error: activationError }, { status: 400 });
      }
    }
    if (equityLiquidityFacilityEnabled === true) {
      if (!equityLiquidityIntervention) {
        return NextResponse.json(
          { error: "An economic intervention plan is required to enable equity liquidity." },
          { status: 400 }
        );
      }
      const activationError = validateInterventionActivation(
        equityLiquidityIntervention,
        currentTurn
      );
      if (activationError) {
        return NextResponse.json({ error: activationError }, { status: 400 });
      }
    }
    if (nppMarketCoverageEnabled === true) {
      if (!marketCoverageIntervention) {
        return NextResponse.json(
          { error: "An economic intervention plan is required to enable market coverage." },
          { status: 400 }
        );
      }
      const activationError = validateInterventionActivation(
        marketCoverageIntervention,
        currentTurn
      );
      if (activationError) {
        return NextResponse.json({ error: activationError }, { status: 400 });
      }
    }

    const governorSet: Partial<GameConfig> = {};
    if (typeof governorCap === "number") governorSet.marketGovernorCap = governorCap;
    if (typeof governorRampTurns === "number")
      governorSet.marketGovernorRampTurns = governorRampTurns;
    if (typeof scarcityDriftEnabled === "boolean")
      governorSet.commodityScarcityDriftEnabled = scarcityDriftEnabled;
    if (typeof stockCoverCapEnabled === "boolean")
      governorSet.stockCoverCapEnabled = stockCoverCapEnabled;
    if (typeof brandLoyaltyEnabled === "boolean")
      governorSet.brandLoyaltyEnabled = brandLoyaltyEnabled;
    if (typeof brandLoyaltySliceEnabled === "boolean")
      governorSet.brandLoyaltySliceEnabled = brandLoyaltySliceEnabled;
    if (typeof sectorQualityEnabled === "boolean")
      governorSet.sectorQualityEnabled = sectorQualityEnabled;
    if (typeof qualityPremiumPricingEnabled === "boolean")
      governorSet.qualityPremiumPricingEnabled = qualityPremiumPricingEnabled;
    if (typeof supplyAgreementsEnabled === "boolean")
      governorSet.supplyAgreementsEnabled = supplyAgreementsEnabled;
    if (typeof shortageResponsiveSourcingEnabled === "boolean") {
      governorSet.shortageResponsiveSourcingEnabled = shortageResponsiveSourcingEnabled;
      if (shortageResponsiveSourcingEnabled && intervention) {
        governorSet.shortageResponsiveSourcingIntervention = intervention;
      }
    }
    if (typeof indexFundBondLiquidityEnabled === "boolean") {
      governorSet.indexFundBondLiquidityEnabled = indexFundBondLiquidityEnabled;
      if (indexFundBondLiquidityEnabled && bondLiquidityIntervention) {
        governorSet.indexFundBondLiquidityIntervention = bondLiquidityIntervention;
      }
    }
    if (typeof equityLiquidityFacilityEnabled === "boolean") {
      governorSet.equityLiquidityFacilityEnabled = equityLiquidityFacilityEnabled;
      if (equityLiquidityFacilityEnabled && equityLiquidityIntervention) {
        governorSet.equityLiquidityFacilityIntervention = equityLiquidityIntervention;
      }
    }
    if (typeof nppMarketCoverageEnabled === "boolean") {
      governorSet.nppMarketCoverageEnabled = nppMarketCoverageEnabled;
      if (nppMarketCoverageEnabled && marketCoverageIntervention) {
        governorSet.nppMarketCoverageIntervention = marketCoverageIntervention;
      }
    }
    if (typeof demographicsDemandEnabled === "boolean")
      governorSet.demographicsDemandEnabled = demographicsDemandEnabled;
    if (typeof nppCorpsAttackable === "boolean")
      governorSet.nppCorpsAttackable = nppCorpsAttackable;
    if (typeof nppCorporateAttacksEnabled === "boolean")
      governorSet.nppCorporateAttacksEnabled = nppCorporateAttacksEnabled;
    if (typeof extractionOutputScaleEnabled === "boolean")
      governorSet.extractionOutputScaleEnabled = extractionOutputScaleEnabled;
    if (typeof commandEconomyEnabled === "boolean") {
      governorSet.commandEconomyEnabled = commandEconomyEnabled;
      governorSet.commandEconomyEnabledBy = auth.admin.username;
      governorSet.commandEconomyEnabledAt = new Date().toISOString();
    }
    if (typeof commandEconomySecondEconomyTolerance === "number")
      governorSet.commandEconomySecondEconomyTolerance = commandEconomySecondEconomyTolerance;

    await gameConfig.updateOne(
      { _id: "default" },
      {
        $set: {
          marketSystemMode: mode,
          marketSystemModeUpdatedBy: auth.admin.username,
          marketSystemModeUpdatedAt: new Date().toISOString(),
          marketSystemModeUpdatedTurn: currentTurn,
          ...governorSet,
        },
      },
      { upsert: true }
    );

    await createAdminLog({
      category: "system",
      action: mode === "off" ? "market_system_disabled" : "market_system_set",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details:
        mode === "off"
          ? `Market system disabled (was "${priorMode}") at turn ${currentTurn}. Economy reverts to baseline behavior.`
          : `Market system mode set to "${mode}" (was "${priorMode}") at turn ${currentTurn}` +
            (MARKET_MODE_INFO[mode].live !== true ? " [NON-LIVE tier, forced]" : "") +
            ".",
    });

    return NextResponse.json({ success: true, mode, priorMode });
  } catch (error) {
    return handleRouteError(error);
  }
}
