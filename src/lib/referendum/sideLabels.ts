import type { ReferendumKind } from "@/lib/db/types/referendum";

export interface SideLabels {
  yes: string;
  no: string;
}

/** Display labels for a referendum's two sides, keyed off its kind. The
 *  underlying `side: "yes" | "no"` and all mechanics are unaffected. */
export function referendumSideLabels(kind: ReferendumKind): SideLabels {
  if (kind === "peace_agreement") return { yes: "Ratify agreement", no: "Reject agreement" };
  return kind === "reunification"
    ? { yes: "Reunify", no: "Stay in UK" }
    : { yes: "Independence", no: "Stay in UK" };
}

/** Name shared by the campaign pages and cards. */
export function referendumKindLabel(kind: ReferendumKind): string {
  if (kind === "peace_agreement") return "Peace agreement";
  return kind === "reunification" ? "Reunification" : "Independence";
}
