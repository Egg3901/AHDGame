/**
 * Combined policy pressure per v2 metric board: funded law programs plus
 * active Cabinet initiatives, in normalized favorable points. The metrics
 * route computes the same figures per board for display; this loader does it
 * for every active board at once so the turn can apply the pressure to
 * metrics without a live owner (see rules/policyDrift).
 */
import type { Db } from "mongodb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { StateBudget } from "@/lib/db/types/budget";
import type { ResetCabinetActionState } from "@/lib/resetCabinet/rules/actionState";
import {
  combineActiveActionEffects,
  mergeApplicableActionEffects,
} from "@/lib/resetCabinet/rules/actions";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import type { ResetLawProgramDocument } from "@/lib/resetLegislation/program";
import {
  combineLawProgramEffects,
  type LawProgramDelivery,
} from "@/lib/resetLegislation/rules/programEffects";
import type { ResetMetricSnapshot } from "./rules/snapshot";

/** Combined law and Cabinet pressure is bounded so the opening still anchors the board. */
export const MAX_COMBINED_POLICY_PRESSURE = 1.2;

/** Whether a Cabinet action scope reaches a board (national actions reach every board). */
export function cabinetActionApplies(
  scope: string,
  boardScope: "national" | "regional",
  regionId?: string
): boolean {
  if (scope === "Nat") return true;
  if (scope === "Vet") return boardScope === "regional";
  return (
    boardScope === "regional" &&
    ((scope === "NI" && regionId === "NIR") ||
      (scope === "SCT" && regionId === "SCO") ||
      (scope === "WAL" && regionId === "WAL"))
  );
}

type ProgramRow = Pick<
  ResetLawProgramDocument,
  | "_id"
  | "country"
  | "scope"
  | "regionId"
  | "familyId"
  | "primaryMetricEffects"
  | "fundingAccountId"
>;

function nationalDelivery(
  programs: readonly ProgramRow[],
  accounts: readonly Pick<
    ResetDepartmentAccountSnapshot,
    "_id" | "lastProgramDelivery" | "externallySettled"
  >[]
): LawProgramDelivery[] {
  return programs.map((program) => {
    const account = accounts.find((candidate) => candidate._id === program.fundingAccountId);
    return {
      familyId: program.familyId,
      implementationFactor:
        account?.lastProgramDelivery?.[program.familyId]?.implementationFactor ??
        (account?.externallySettled ? 1 : 0),
    };
  });
}

function regionalDelivery(
  programs: readonly ProgramRow[],
  settlements: Record<string, { implementationFactor?: number }> | undefined
): LawProgramDelivery[] {
  return programs.map((program) => ({
    familyId: program.familyId,
    implementationFactor: settlements?.[program._id]?.implementationFactor ?? 1,
  }));
}

/**
 * Pressure per metric id for each board id. National programs reach every
 * board of their country (their metrics are observed regionally and rolled
 * up); regional programs reach only their own region.
 */
export async function loadResetPolicyPressure(
  db: Db,
  input: { worldId: string; boards: readonly ResetMetricSnapshot[]; turn: number }
): Promise<Map<string, Record<string, number>>> {
  const { worldId, boards, turn } = input;
  const out = new Map<string, Record<string, number>>();
  if (boards.length === 0) return out;
  const countryIds = [...new Set(boards.map((board) => board.countryId))];
  const usRegionIds = boards
    .filter((board) => board.countryId === COUNTRY_CONFIGS.US.id && board.regionId)
    .map((board) => board.regionId!);
  const otherRegionIds = boards
    .filter((board) => board.countryId !== COUNTRY_CONFIGS.US.id && board.regionId)
    .map((board) => board.regionId!);

  const [programs, accounts, regionalBudgets, stateBudgets, actionStates] = await Promise.all([
    db
      .collection<ResetLawProgramDocument>("resetLawPrograms")
      .find(
        { worldId, country: { $in: countryIds } },
        {
          projection: {
            _id: 1,
            country: 1,
            scope: 1,
            regionId: 1,
            familyId: 1,
            primaryMetricEffects: 1,
            fundingAccountId: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
      .find(
        { worldId, countryId: { $in: countryIds } },
        { projection: { _id: 1, countryId: 1, lastProgramDelivery: 1, externallySettled: 1 } }
      )
      .toArray(),
    otherRegionIds.length > 0
      ? db
          .collection<RegionalBudget>("regionalBudgets")
          .find(
            { _id: { $in: otherRegionIds }, countryId: { $in: countryIds } },
            { projection: { _id: 1, countryId: 1, programSettlements: 1 } }
          )
          .toArray()
      : Promise.resolve([]),
    usRegionIds.length > 0
      ? db
          .collection<StateBudget>("stateBudgets")
          .find(
            { _id: { $in: usRegionIds }, countryId: COUNTRY_CONFIGS.US.id },
            { projection: { _id: 1, countryId: 1, regionalProgramSettlements: 1 } }
          )
          .toArray()
      : Promise.resolve([]),
    db
      .collection<ResetCabinetActionState>("resetCabinetActionStates")
      .find({ _id: { $in: countryIds }, worldId }, { projection: { _id: 1, active: 1 } })
      .toArray(),
  ]);

  const programsByCountry = new Map<string, ProgramRow[]>();
  for (const program of programs) {
    const list = programsByCountry.get(program.country) ?? [];
    list.push(program);
    programsByCountry.set(program.country, list);
  }
  const accountsByCountry = new Map<string, typeof accounts>();
  for (const account of accounts) {
    const list = accountsByCountry.get(account.countryId) ?? [];
    list.push(account);
    accountsByCountry.set(account.countryId, list);
  }
  const regionalSettlements = new Map<string, Record<string, { implementationFactor?: number }>>();
  for (const budget of regionalBudgets) {
    if (budget.programSettlements)
      regionalSettlements.set(String(budget._id), budget.programSettlements);
  }
  for (const budget of stateBudgets) {
    if (budget.regionalProgramSettlements) {
      regionalSettlements.set(String(budget._id), budget.regionalProgramSettlements);
    }
  }
  const activeByCountry = new Map(
    actionStates.map((state) => [String(state._id), state.active ?? []])
  );

  for (const board of boards) {
    const countryPrograms = programsByCountry.get(board.countryId) ?? [];
    const national = countryPrograms.filter((program) => program.scope === "national");
    const effects = combineLawProgramEffects(
      national,
      nationalDelivery(national, accountsByCountry.get(board.countryId) ?? [])
    );
    const points: Record<string, number> = {};
    for (const effect of effects) points[effect.metricId] = effect.favorableNormalizedPoints;
    if (board.scope === "regional" && board.regionId) {
      const regional = countryPrograms.filter(
        (program) => program.scope === "regional" && program.regionId === board.regionId
      );
      for (const effect of combineLawProgramEffects(
        regional,
        regionalDelivery(regional, regionalSettlements.get(board.regionId))
      )) {
        points[effect.metricId] = (points[effect.metricId] ?? 0) + effect.favorableNormalizedPoints;
      }
    }
    const temporary = mergeApplicableActionEffects(
      combineActiveActionEffects(activeByCountry.get(board.countryId) ?? [], turn)
        .filter((effect) => cabinetActionApplies(effect.scope, board.scope, board.regionId))
        .filter((effect) => /^M\d{2}$/.test(effect.target))
    );
    for (const effect of temporary) {
      const id = effect.target.slice(1);
      points[id] = (points[id] ?? 0) + effect.favorableNormalizedPoints;
    }
    for (const id of Object.keys(points)) {
      points[id] = Math.max(
        -MAX_COMBINED_POLICY_PRESSURE,
        Math.min(MAX_COMBINED_POLICY_PRESSURE, Number(points[id]!.toFixed(4)))
      );
      if (points[id] === 0) delete points[id];
    }
    out.set(board._id, points);
  }
  return out;
}
