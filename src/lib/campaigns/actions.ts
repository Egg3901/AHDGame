import { GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS } from "@/lib/constants/governorOffice";

/**
 * Per-turn campaign action gain for the campaign manager's SEPARATE action pool
 * (distinct from the player's Character.actions pool — upgrades + ops spend from
 * Campaign.actions, never from the player).
 *
 * Formula: baseline + floor(sqrt(endorsementCount) * 3)
 *
 * The baseline comes from the player's own base action gain (baseActionsPerTurn
 * from game config) so a more active player rolls a correspondingly more active
 * campaign. Endorsements ONLY boost campaign actions — never the player pool.
 */
export function calculateCampaignActions(endorsementCount: number, baseline: number = 1): number {
  const safeBaseline = Number.isFinite(baseline) && baseline > 0 ? Math.floor(baseline) : 1;
  if (endorsementCount < 0 || !Number.isFinite(endorsementCount)) {
    return safeBaseline;
  }
  return safeBaseline + Math.floor(Math.sqrt(endorsementCount) * 3);
}

export interface CampaignActionInputs {
  /** Active AND visible politician endorsements. Count in every race type. */
  nppEndorsements: number;
  /** Active player endorsements. Presidential races only. */
  playerEndorsements: number;
  governorEndorsements: number;
  executiveEndorsements: number;
  isPresidential: boolean;
  /** NPP-run campaigns roll on half a player's baseline. */
  candidateIsNPP: boolean;
  /** Raw `gameConfig.baseActionsPerTurn`; floored at 4 here. */
  baseActionsPerTurn: number;
}

/**
 * The whole per-turn accrual rule, in one place.
 *
 * The turn engine pays what this returns and the campaign desk promises what
 * this returns. They used to derive it separately, which is how a campaign came
 * to be shown 15 actions a turn while being credited 8: the desk counted
 * politician endorsements the engine had stopped counting, and it still counted
 * player endorsements in races where the engine gates them, ignored the
 * governor and executive terms, and used a full baseline for NPP-run campaigns
 * the engine halves. Every one of those rules now lives here, so the two cannot
 * disagree again.
 *
 * Sources are summed BEFORE the square root, not curved separately: the curve
 * is what makes stacking endorsements yield less each time, and applying it per
 * source would hand out a bonus for spreading them around.
 */
export function campaignActionsPerTurn(inputs: CampaignActionInputs): number {
  const playerBase = Math.max(
    Number.isFinite(inputs.baseActionsPerTurn) ? inputs.baseActionsPerTurn : 4,
    4
  );
  const baseline = inputs.candidateIsNPP ? Math.max(1, Math.floor(playerBase / 2)) : playerBase;

  // Player endorsements are a social signal down-ballot; only a presidential
  // race converts them into national canvassing capacity.
  const player = inputs.isPresidential ? inputs.playerEndorsements : 0;
  // A governor's presidential endorsement is state-scoped and lands as an
  // in-state vote multiplier in accumulatePresidentVoteTurn, so it grants no
  // national actions. Executive endorsements apply in every race.
  const governor = inputs.isPresidential ? 0 : inputs.governorEndorsements;
  const weighted =
    (governor + inputs.executiveEndorsements) * GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS;

  return calculateCampaignActions(inputs.nppEndorsements + player + weighted, baseline);
}
