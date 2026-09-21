import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

export function isDepartmentProgramSliceEnabledFromState(
  state?: Pick<GameState, "departmentProgramSliceEnabled" | "departmentFinanceEnabled"> | null
): boolean {
  return state?.departmentProgramSliceEnabled === true || state?.departmentFinanceEnabled === true;
}

export function isDepartmentFinanceEnabledFromState(
  state?: Pick<GameState, "departmentFinanceEnabled"> | null
): boolean {
  return state?.departmentFinanceEnabled === true;
}

export function isLawAdministrationEnabledFromState(
  state?: Pick<GameState, "lawAdministrationEnabled"> | null
): boolean {
  return state?.lawAdministrationEnabled === true;
}

export function isRegionalLegislationFinanceEnabledFromState(
  state?: Pick<GameState, "regionalLegislationFinanceEnabled"> | null
): boolean {
  return state?.regionalLegislationFinanceEnabled === true;
}

export async function isDepartmentProgramSliceEnabled(
  preloaded?: Pick<GameState, "departmentProgramSliceEnabled" | "departmentFinanceEnabled"> | null
): Promise<boolean> {
  if (preloaded !== undefined) return isDepartmentProgramSliceEnabledFromState(preloaded);
  const db = await getDb();
  const state = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: { departmentProgramSliceEnabled: 1, departmentFinanceEnabled: 1 },
    }
  );
  return isDepartmentProgramSliceEnabledFromState(state);
}
