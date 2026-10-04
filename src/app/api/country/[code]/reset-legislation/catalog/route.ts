import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";
import { loadReviewedLawCatalog } from "@/lib/resetLegislation/loadReviewedCatalog";
import { resetTaxesFor } from "@/lib/resetLegislation/taxCatalog";
import { eraYearContextFromGameState } from "@/lib/era/context";
import { primaryMetrics } from "@/lib/resetMetrics/catalog";
import { playerMetricDescription } from "@/lib/resetMetrics/presentation";

const querySchema = z
  .object({
    scope: z.enum(["national", "regional"]).default("national"),
    regionId: z.string().min(1).max(24).optional(),
  })
  .refine((query) => (query.scope === "regional") === Boolean(query.regionId), {
    message: "Regional catalogs require a regionId",
  });
const supported = new Set(["US", "UK", "JP"]);

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const country = (await context.params).code.toUpperCase();
    if (!supported.has(country)) {
      return NextResponse.json({ error: "Legislation v2 is not available here" }, { status: 404 });
    }
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      scope: url.searchParams.get("scope") ?? undefined,
      regionId: url.searchParams.get("regionId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
    }
    const db = await getDb();
    const gameState = await db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          resetWorldId: 1,
          currentYear: 1,
          currentTurn: 1,
          startingYear: 1,
          eraSystemEnabled: 1,
          metricsSystemVersion: 1,
          legislationSystemVersion: 1,
          resetVersionSeeds: 1,
        },
      }
    );
    if (
      !gameState?.resetWorldId ||
      resetSystemVersionsForCountry(gameState, RESET_V2_READY, country).legislation !== "v2"
    ) {
      return NextResponse.json({ error: "Legislation v2 is not enabled" }, { status: 409 });
    }
    const year = eraYearContextFromGameState(gameState).year ?? gameState.startingYear ?? 1991;
    const scope = parsed.data.scope;
    const families = await loadReviewedLawCatalog({
      db,
      worldId: gameState.resetWorldId,
      country: country as ResetCountry,
      scope,
      year,
      ...(parsed.data.regionId ? { regionId: parsed.data.regionId } : {}),
    });
    const usedMetricIds = new Set(families.flatMap((family) => family.primaryMetricIds));
    return NextResponse.json({
      country,
      scope,
      year,
      regionId: parsed.data.regionId ?? null,
      balanceNotice:
        "Game-calibrated provisional estimates are used where reviewed historical values are unavailable.",
      families,
      metrics: primaryMetrics
        .filter((metric) => usedMetricIds.has(metric.id))
        .map((metric) => ({
          id: metric.id,
          name: metric.name,
          description: playerMetricDescription(metric),
        })),
      taxes: resetTaxesFor(country as ResetCountry, scope),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
