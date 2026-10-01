import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { primaryMetrics } from "@/lib/resetMetrics/catalog";
import { readResetMetricBoard } from "@/lib/resetMetrics/readBoard";
import type { ResetCabinetActionState } from "@/lib/resetCabinet/rules/actionState";
import {
  combineActiveActionEffects,
  mergeApplicableActionEffects,
} from "@/lib/resetCabinet/rules/actions";
import type { ResetLawProgramDocument } from "@/lib/resetLegislation/program";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { combineLawProgramEffects } from "@/lib/resetLegislation/rules/programEffects";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { StateBudget } from "@/lib/db/types/budget";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

function actionApplies(scope: string, boardScope: "national" | "regional", regionId?: string) {
  if (scope === "Nat") return true;
  if (scope === "Vet") return boardScope === "regional";
  return (
    boardScope === "regional" &&
    ((scope === "NI" && regionId === "NIR") ||
      (scope === "SCT" && regionId === "SCO") ||
      (scope === "WAL" && regionId === "WAL"))
  );
}

/** V2 primary board. V1 countries keep their existing metrics API unchanged. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase();
    if (countryId !== "US" && countryId !== "UK" && countryId !== "JP") {
      return NextResponse.json(
        { error: "V2 metrics are not available for this country" },
        { status: 404 }
      );
    }
    const regionId = new URL(request.url).searchParams.get("region") ?? undefined;
    const db = await getDb();
    const board = await readResetMetricBoard(db, countryId, regionId);
    if (board.status === "not_enabled") {
      return NextResponse.json({ error: "V2 metrics are not enabled" }, { status: 409 });
    }
    if (board.status !== "ready") {
      return NextResponse.json(
        { error: "V2 metrics board is unavailable", reason: board.status },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    const [actionState, programs, departmentAccounts, regionalBudget] = await Promise.all([
      db
        .collection<ResetCabinetActionState>("resetCabinetActionStates")
        .findOne(
          { _id: countryId as "US" | "UK" | "JP", worldId: board.board.worldId },
          { projection: { active: 1 } }
        ),
      db
        .collection<ResetLawProgramDocument>("resetLawPrograms")
        .find(
          {
            worldId: board.board.worldId,
            country: countryId,
            scope: board.board.scope,
            ...(board.board.regionId ? { regionId: board.board.regionId } : {}),
          },
          { projection: { familyId: 1, primaryMetricEffects: 1, fundingAccountId: 1 } }
        )
        .toArray(),
      board.board.scope === "national"
        ? db
            .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
            .find(
              { worldId: board.board.worldId, countryId },
              { projection: { lastProgramDelivery: 1, externallySettled: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
      board.board.scope === "regional" && board.board.regionId
        ? countryId === COUNTRY_CONFIGS.US.id
          ? db
              .collection<StateBudget>("stateBudgets")
              .findOne(
                { _id: board.board.regionId, countryId: COUNTRY_CONFIGS.US.id },
                { projection: { regionalProgramSettlements: 1 } }
              )
          : db
              .collection<RegionalBudget>("regionalBudgets")
              .findOne(
                { _id: board.board.regionId, countryId },
                { projection: { programSettlements: 1 } }
              )
        : Promise.resolve(null),
    ]);
    const temporaryEffects = new Map(
      mergeApplicableActionEffects(
        combineActiveActionEffects(actionState?.active ?? [], board.board.asOfTurn)
          .filter((effect) => actionApplies(effect.scope, board.board.scope, board.board.regionId))
          .filter((effect) => /^M\d{2}$/.test(effect.target))
      ).map((effect) => [effect.target.slice(1), effect])
    );
    const delivery =
      board.board.scope === "regional"
        ? programs.map((program) => {
            const settlements =
              countryId === COUNTRY_CONFIGS.US.id
                ? (regionalBudget as StateBudget | null)?.regionalProgramSettlements
                : (regionalBudget as RegionalBudget | null)?.programSettlements;
            return {
              familyId: program.familyId,
              implementationFactor: settlements?.[program._id]?.implementationFactor ?? 1,
            };
          })
        : programs.map((program) => {
            const account = departmentAccounts.find(
              (candidate) => candidate._id === program.fundingAccountId
            );
            return {
              familyId: program.familyId,
              implementationFactor:
                account?.lastProgramDelivery[program.familyId]?.implementationFactor ??
                (account?.externallySettled ? 1 : 0),
            };
          });
    const legislativeEffects = new Map(
      combineLawProgramEffects(programs, delivery).map((effect) => [effect.metricId, effect])
    );
    return NextResponse.json(
      {
        version: "v2",
        countryId,
        scope: board.board.scope,
        regionId: board.board.regionId ?? null,
        asOfTurn: board.board.asOfTurn,
        metrics: primaryMetrics
          .filter((metric) =>
            board.board.scope === "national"
              ? metric.aggregation === "national"
              : metric.aggregation !== "national"
          )
          .map((definition) => {
            const temporary = temporaryEffects.get(definition.id);
            const legislative = legislativeEffects.get(definition.id);
            return {
              ...definition,
              observation: board.board.observations[definition.id],
              temporaryActionEffect: temporary
                ? {
                    favorableNormalizedPoints: temporary.favorableNormalizedPoints,
                    contributingActions: temporary.contributingActions,
                  }
                : null,
              legislativeEffect: legislative ?? null,
            };
          }),
      },
      { headers: { "Cache-Control": "no-store, no-transform" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
