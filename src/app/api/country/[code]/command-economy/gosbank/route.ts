// POST /api/country/[code]/command-economy/gosbank
// Command Economy v2 (P2) — the Gosbank Chair sets state-credit policy:
// credit aggressiveness, budget softness, and an optional explicit per-sector
// directed-credit weighting. Writes economicFactors.gosbankDirective (the P1
// seam the turn engine already honors: directive > NPP stance > default).
// Auth: the Gosbank seat holder or the head of government. Errors: 401/403/404/429.
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { forbidden, handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types/budget";
import { commandEconomySoeSectors } from "@/lib/constants/commandEconomy";
import {
  CREDIT_AGGRESSIVENESS_RANGE,
  BUDGET_SOFTNESS_RANGE,
  clampRange,
} from "@/lib/constants/commandEconomyOffices";
import { canOperateGosbank } from "@/lib/economy/commandEconomyAuth";
import { resolveWriteContext } from "@/lib/economy/queries/commandEconomyWriteContext";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  creditAggressiveness: z.number().min(0).max(1).optional(),
  budgetSoftness: z.number().min(0).max(1).optional(),
  /** Per-sector relative weighting; empty/omitted → automatic allocation. */
  sectorCredit: z.record(z.string(), z.number().min(0).max(1_000_000)).optional(),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const setup = await resolveWriteContext(code);
    if (!setup.ok) return setup.response;
    const { db, countryId, characterId, roles, currentTurn } = setup.ctx;

    if (!canOperateGosbank(roles)) {
      return NextResponse.json(
        forbidden(
          "Only the Gosbank chair or the head of government can set state credit policy."
        ).toJson(),
        { status: 403 }
      );
    }

    const rate = checkRateLimit(String(characterId), 20, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    // Keep only the country's real SOE sectors; clamp each weight non-negative.
    const validSectors = new Set<string>(commandEconomySoeSectors(countryId));
    let sectorCredit: Record<string, number> | undefined;
    if (parsed.data.sectorCredit) {
      const cleaned: Record<string, number> = {};
      for (const [sector, weight] of Object.entries(parsed.data.sectorCredit)) {
        if (validSectors.has(sector) && Number.isFinite(weight) && weight >= 0) {
          cleaned[sector] = weight;
        }
      }
      sectorCredit = Object.keys(cleaned).length > 0 ? cleaned : undefined;
    }

    const set: Record<string, unknown> = {
      "economicFactors.gosbankDirective.setOnTurn": currentTurn,
      "economicFactors.gosbankDirective.setByCharacterId": String(characterId),
    };
    if (parsed.data.creditAggressiveness != null) {
      set["economicFactors.gosbankDirective.creditAggressiveness"] = clampRange(
        parsed.data.creditAggressiveness,
        CREDIT_AGGRESSIVENESS_RANGE
      );
    }
    if (parsed.data.budgetSoftness != null) {
      set["economicFactors.gosbankDirective.budgetSoftness"] = clampRange(
        parsed.data.budgetSoftness,
        BUDGET_SOFTNESS_RANGE
      );
    }
    const unset: Record<string, ""> = {};
    if (sectorCredit) {
      set["economicFactors.gosbankDirective.sectorCredit"] = sectorCredit;
    } else if (parsed.data.sectorCredit) {
      // An explicit empty map clears the override back to automatic allocation.
      unset["economicFactors.gosbankDirective.sectorCredit"] = "";
    }

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;

    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }, update);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
