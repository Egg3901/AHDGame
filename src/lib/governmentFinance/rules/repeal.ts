import type { DepartmentProgramStatus } from "./types";

export function resolveProgramStatus(
  current: DepartmentProgramStatus,
  turn: number,
  repealTurn: number | undefined,
  encumbered: number
): DepartmentProgramStatus {
  if (current === "closed") return "closed";
  if (repealTurn === undefined || turn < repealTurn) {
    return current === "authorized" ? "operating" : current;
  }
  return encumbered > 0 ? "winding_down" : "closed";
}
