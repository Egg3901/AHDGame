/**
 * Pure notice-window logic (spec §14). No DB. The notice length keys off the
 * cited triggers (distress = immediate; everything else = a reaction window).
 * Cure-cancel fires only when EVERY cited *curable* condition (strategic /
 * monopoly) has cleared — a taking citing no curable condition never cancels.
 */
import { DISTRESS_NOTICE_TURNS, STRATEGIC_NOTICE_TURNS } from "./constants";
import type { NationalizationTrigger } from "./eligibility";

/** Curable conditions a player can clear during the window. */
const CURABLE: ReadonlySet<NationalizationTrigger> = new Set(["strategic", "monopoly"]);

export function computeNoticeTurns(triggers: NationalizationTrigger[]): number {
  // Distress is the shortest (0) — an abandoned/failing firm is seized at once.
  return triggers.includes("distress") ? DISTRESS_NOTICE_TURNS : STRATEGIC_NOTICE_TURNS;
}

/**
 * True ⇒ cancel the pending taking. Only the cited curable conditions matter; if
 * none were cited (e.g. `["supermajority"]`), there is nothing to cure → false.
 */
export function allCitedConditionsCleared(
  citedTriggers: NationalizationTrigger[],
  stillActive: { strategic: boolean; monopoly: boolean }
): boolean {
  const citedCurable = citedTriggers.filter((t) => CURABLE.has(t));
  if (citedCurable.length === 0) return false;
  return citedCurable.every((t) =>
    t === "strategic" ? !stillActive.strategic : !stillActive.monopoly
  );
}
