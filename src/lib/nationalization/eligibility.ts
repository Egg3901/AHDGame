import {
  DISTRESS_VACANT_CEO_TURNS,
  MONOPOLY_SHARE_THRESHOLD,
  FINANCIAL_DISTRESS_GRACE_TURNS,
} from "./constants";

export type NationalizationTrigger =
  "npc" | "unowned" | "distress" | "strategic" | "monopoly" | "supermajority";

export interface EligibilityInput {
  /** "player" corps are conditional; "npc" and "unowned" are always eligible. */
  ownerKind: "player" | "npc" | "unowned";
  /** Corp liquid capital in its own currency; < 0 ⇒ insolvent. Ignored for non-player. */
  liquidCapital: number;
  hasDefaultedBond: boolean;
  /** Consecutive turns the CEO seat has been vacant (0 if seated). */
  ceoVacantTurns: number;
  currentTurn: number;
  /** True if the corp operates in a (countryId, sectorType) designated strategic. */
  strategicSectorMatch: boolean;
  /** Highest (state, sectorType) market share the corp holds, as a 0–100 percent. */
  topMarketSharePercent: number;
  /** True if a supermajority nationalization vote has passed against this corp. */
  supermajorityVotePassed: boolean;
  /**
   * Consecutive turns the corp has been in FINANCIAL distress (insolvency or a
   * defaulted bond). Financial distress only exposes a player corp once this
   * reaches FINANCIAL_DISTRESS_GRACE_TURNS. 0 when not in financial distress.
   */
  financialDistressTurns: number;
}

export interface EligibilityResult {
  eligible: boolean;
  triggers: NationalizationTrigger[];
  /**
   * True when an *unambiguous-failure* trigger (distress) is present. The
   * executive route may only act on NPC/unowned assets or distressed player
   * corps (locked executive-reach rule, spec §8).
   */
  isDistressed: boolean;
}

/**
 * Pure eligibility evaluation. Caller pre-fetches the snapshot. Distress is
 * deliberately limited to insolvency / defaulted bond / long-vacant CEO — a
 * low-credit-but-solvent corp is NOT distress-eligible (spec §8).
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const triggers: NationalizationTrigger[] = [];

  if (input.ownerKind === "npc") {
    triggers.push("npc");
    return { eligible: true, triggers, isDistressed: false };
  }
  if (input.ownerKind === "unowned") {
    triggers.push("unowned");
    return { eligible: true, triggers, isDistressed: false };
  }

  // Financial distress (insolvency / defaulted bond) only exposes a player corp
  // after it has persisted the grace window, giving the owner time to cure.
  // CEO-vacancy keeps its own DISTRESS_VACANT_CEO_TURNS threshold.
  const inFinancialDistress = input.liquidCapital < 0 || input.hasDefaultedBond;
  const financialMature =
    inFinancialDistress && input.financialDistressTurns >= FINANCIAL_DISTRESS_GRACE_TURNS;
  const distressed = financialMature || input.ceoVacantTurns >= DISTRESS_VACANT_CEO_TURNS;
  if (distressed) triggers.push("distress");

  if (input.strategicSectorMatch) triggers.push("strategic");
  if (input.topMarketSharePercent >= MONOPOLY_SHARE_THRESHOLD * 100) triggers.push("monopoly");
  if (input.supermajorityVotePassed) triggers.push("supermajority");

  return { eligible: triggers.length > 0, triggers, isDistressed: distressed };
}
