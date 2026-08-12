import type { Bill } from "@/lib/db/types/legislation";

export type BillVoteField = "votes" | "otherChamberVotes" | "vetoOverrideVotes";

/**
 * Which vote map a vote belongs in.
 *
 * Additive by construction: every pre-existing status returns exactly what the inline
 * ternaries it replaces returned, and IGNORES the voter. Only `active_both` consults the
 * voter's chamber — because two chambers are live at once and `bill.currentChamber` is a
 * single value that cannot express "both".
 *
 * The danger this exists to remove: if the mapping stayed status-driven, a senator
 * voting on a concurrent bill would write into `votes` alongside the house, the two
 * tallies would merge, and the bill could pass on votes cast by the other chamber — with
 * nothing erroring.
 */
export function resolveBillVoteField(
  bill: Pick<Bill, "status">,
  ctx?: { voterOfficeType?: string; lowerOfficeType?: string }
): BillVoteField {
  if (bill.status === "active_other") return "otherChamberVotes";
  if (bill.status === "veto_override") return "vetoOverrideVotes";
  if (bill.status === "active_both") {
    // No voter (display callers) -> the lower chamber's map, which is what every
    // unconverted reader already assumes.
    if (!ctx?.voterOfficeType || !ctx.lowerOfficeType) return "votes";
    return ctx.voterOfficeType === ctx.lowerOfficeType ? "votes" : "otherChamberVotes";
  }
  return "votes";
}
