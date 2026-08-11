/**
 * Deterministic tie-break for NPC scoring (design Section 6.4).
 * Order: bailout > restructure > monetize > repudiate (lower-risk first).
 */

import type { SovereignResolutionChoice } from "@/lib/db/types/budget";

const TIE_BREAK_ORDER: Record<SovereignResolutionChoice, number> = {
  bailout: 0,
  restructure: 1,
  monetize: 2,
  repudiate: 3,
};

export function tieBreakOrder(a: SovereignResolutionChoice, b: SovereignResolutionChoice): number {
  return TIE_BREAK_ORDER[a] - TIE_BREAK_ORDER[b];
}
