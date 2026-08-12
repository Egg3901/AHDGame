import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { updateCorporationSettingsSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import {
  TYPE_SWITCH_COOLDOWN_TURNS,
  TYPE_SWITCH_PENALTY_TURNS,
  CEO_SALARY_MAX_REVENUE_MULTIPLE,
  type CorporationType,
} from "@/lib/constants/corporations";
import { migrateUnlockedTechOnPrimaryTypeSwitch } from "@/lib/corporations/techTree/migrateUnlocksOnTypeSwitch";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { Corporation } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/settings
 * Update corporation settings (marketing budget, description). CEO only.
 */
export async function updateCorporationSettings(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, updateCorporationSettingsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // Only CEO can modify settings
    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (
      corporation.imfBailoutActive &&
      parsed.data.ceoSalary !== undefined &&
      parsed.data.ceoSalary > 0
    ) {
      return NextResponse.json(
        { error: "CEO salary is suspended while IMF restructuring is active." },
        { status: 400 }
      );
    }

    const {
      marketingBudget,
      logisticsBudget,
      rdBudget,
      ceoSalary,
      shareBuybackMode,
      escrowFundingPerTurn,
      description,
      brandColor,
      headerImageUrl,
      secondaryType,
      primaryType,
    } = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    // Enforce 150% overhead cap: combined marketing + logistics + R&D + CEO salary ≤ 1.5× daily revenue.
    // Only checked when at least one budget field is being set and the corp has sectors.
    const hasBudgetUpdate =
      marketingBudget !== undefined ||
      logisticsBudget !== undefined ||
      rdBudget !== undefined ||
      ceoSalary !== undefined;
    if (hasBudgetUpdate) {
      const sectors = await db
        .collection("corporateSectors")
        .find({ corporationId: corporation._id }, { projection: { revenue: 1 } })
        .toArray();
      const totalDailyRevenue = sectors.reduce(
        (sum, s) => sum + ((s as { revenue?: number }).revenue ?? 0),
        0
      );
      // Bug #0728: CEO salary alone cannot exceed 1.25x daily gross revenue. Unlike
      // the 150% combined-overhead cap below, this runs even when revenue is 0 — a
      // zero-revenue shell may not set any positive salary, which closes the
      // bond-mint → salary drain. Gross revenue excludes bond proceeds (these land
      // in liquidCapital) and bond coupon income (a separate line).
      if (ceoSalary !== undefined) {
        const maxCeoSalary = totalDailyRevenue * CEO_SALARY_MAX_REVENUE_MULTIPLE;
        if (ceoSalary > maxCeoSalary) {
          return NextResponse.json(
            {
              error: `CEO salary cannot exceed 1.25× daily gross revenue ($${Math.round(maxCeoSalary).toLocaleString()}/day). Increase revenue first.`,
            },
            { status: 400 }
          );
        }
      }
      if (totalDailyRevenue > 0) {
        const effectiveMarketing = marketingBudget ?? corporation.marketingBudget;
        const effectiveLogistics = logisticsBudget ?? corporation.logisticsBudget ?? 0;
        const effectiveRd = rdBudget ?? corporation.rdBudget ?? 0;
        const effectiveSalary = ceoSalary ?? corporation.ceoSalary ?? 0;
        const combined = effectiveMarketing + effectiveLogistics + effectiveRd + effectiveSalary;
        if (combined > totalDailyRevenue * 1.5) {
          return NextResponse.json(
            {
              error: `Combined operating budgets cannot exceed 150% of daily revenue ($${Math.round(totalDailyRevenue * 1.5).toLocaleString()}/day).`,
            },
            { status: 400 }
          );
        }
      }
    }

    if (marketingBudget !== undefined) {
      updates.marketingBudget = marketingBudget;
    }
    if (logisticsBudget !== undefined) {
      updates.logisticsBudget = logisticsBudget;
    }
    if (rdBudget !== undefined) {
      updates.rdBudget = rdBudget;
    }
    if (ceoSalary !== undefined) {
      updates.ceoSalary = ceoSalary;
    }
    if (shareBuybackMode !== undefined) {
      updates.shareBuybackMode = shareBuybackMode;
    }
    if (escrowFundingPerTurn !== undefined) {
      updates.escrowFundingPerTurn = escrowFundingPerTurn;
    }
    if (description !== undefined) {
      updates.description = description;
    }
    if (brandColor !== undefined) {
      updates.brandColor = brandColor;
    }
    if (headerImageUrl !== undefined) {
      updates.headerImageUrl = headerImageUrl;
    }

    // Type switching (primary or secondary) — enforce cooldown and apply penalty
    const isTypeChange =
      (primaryType !== undefined && primaryType !== corporation.type) ||
      (secondaryType !== undefined && secondaryType !== (corporation.secondaryType ?? null));

    let techUnset: Record<string, ""> | undefined;
    let techInc: Record<string, number> | undefined;

    if (isTypeChange) {
      const gameState = await getGameState();
      const currentTurn = gameState?.currentTurn ?? 0;

      // Enforce cooldown
      const cooldownUntil = corporation.typeSwitchCooldownUntilTurn ?? 0;
      if (currentTurn < cooldownUntil) {
        const remaining = cooldownUntil - currentTurn;
        return NextResponse.json(
          { error: `Type switch on cooldown. ${remaining} turns remaining.` },
          { status: 400 }
        );
      }

      if (primaryType !== undefined) {
        // Use the incoming secondaryType if provided (including null = removing it),
        // otherwise fall back to the existing value. Don't use ?? here — null is intentional.
        const effectiveSecondary =
          secondaryType !== undefined ? secondaryType : (corporation.secondaryType ?? null);
        if (effectiveSecondary !== null && primaryType === effectiveSecondary) {
          return NextResponse.json(
            { error: "Primary type cannot be the same as secondary type" },
            { status: 400 }
          );
        }
        updates.type = primaryType;

        // Sector research is primary-type-specific: drop it on switch (no remap,
        // no refund). Corporate-lane unlocks + new-type past-decade baseline keep
        // (ticket #1040).
        if (primaryType !== corporation.type) {
          const startingYear = gameState?.startingYear ?? STARTING_YEAR;
          const currentYear =
            gameState?.currentYear ?? startingYear + Math.floor((currentTurn - 1) / TURNS_PER_YEAR);
          const migration = migrateUnlockedTechOnPrimaryTypeSwitch(
            corporation.unlockedTechNodeIds,
            corporation.type as CorporationType,
            primaryType as CorporationType,
            currentYear,
            corporation.techDecadeLane
          );
          updates.unlockedTechNodeIds = migration.unlockedTechNodeIds;
          if (migration.clearDecadeLaneIds.length > 0) {
            techUnset = {};
            for (const decadeId of migration.clearDecadeLaneIds) {
              techUnset[`techDecadeLane.${decadeId}`] = "";
              techUnset[`techDecadeChosenTurn.${decadeId}`] = "";
            }
          }
          const mkt = Math.min(
            migration.strengthGrantReversal.marketingStrength,
            corporation.marketingStrength ?? 0
          );
          const logi = Math.min(
            migration.strengthGrantReversal.logisticsStrength,
            corporation.logisticsStrength ?? 0
          );
          if (mkt > 0 || logi > 0) {
            techInc = {};
            if (mkt > 0) techInc.marketingStrength = -mkt;
            if (logi > 0) techInc.logisticsStrength = -logi;
          }
        }
      }

      if (secondaryType !== undefined) {
        const effectivePrimary = (primaryType ?? corporation.type) as string;
        if (secondaryType === effectivePrimary) {
          return NextResponse.json(
            { error: "Secondary type cannot be the same as primary type" },
            { status: 400 }
          );
        }
        updates.secondaryType = secondaryType;
      }

      // Set penalty start turn and cooldown
      updates.typeSwitchTurn = currentTurn;
      updates.typeSwitchCooldownUntilTurn =
        currentTurn + TYPE_SWITCH_PENALTY_TURNS + TYPE_SWITCH_COOLDOWN_TURNS;
    } else {
      // No actual type change — still allow setting same values without triggering penalty
      if (secondaryType !== undefined) {
        updates.secondaryType = secondaryType;
      }
      if (primaryType !== undefined) {
        updates.type = primaryType;
      }
    }

    const updateDoc: Record<string, unknown> = { $set: updates };
    if (techUnset && Object.keys(techUnset).length > 0) updateDoc.$unset = techUnset;
    if (techInc && Object.keys(techInc).length > 0) updateDoc.$inc = techInc;

    await db.collection<Corporation>("corporations").updateOne({ _id: corporation._id }, updateDoc);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
