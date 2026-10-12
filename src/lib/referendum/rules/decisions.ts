import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";
export const NPP_REFERENDUM_DECISION_TURNS = 24;
/** Give human party officers a decision window before an NPP ministry acts. */
export function nppReferendumDecision(
  currentTurn: number,
  requestedTurn: number,
  policy: DevolutionPolicy
): "grant" | "decline" | null {
  if (currentTurn < requestedTurn + NPP_REFERENDUM_DECISION_TURNS) return null;
  return policy === "anti" ? "decline" : "grant";
}
