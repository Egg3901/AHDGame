import type { ReferendumKind } from "@/lib/db/types/referendum";

export interface SideLabels {
  yes: string;
  no: string;
}

/** Display labels for a referendum's two sides, keyed off its kind. The
 *  underlying `side: "yes" | "no"` and all mechanics are unaffected. */
export function referendumSideLabels(kind: ReferendumKind): SideLabels {
  return kind === "reunification"
    ? { yes: "Reunify", no: "Stay in UK" }
    : { yes: "Independence", no: "Stay in UK" };
}
