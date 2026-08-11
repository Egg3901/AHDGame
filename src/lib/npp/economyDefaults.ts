import type { NPP } from "@/lib/db/types/npp";

/**
 * Economy-subsystem fields stamped on every newly created NPP, regardless of
 * creation path (org generation, historical seed, player recruitment, admin
 * spawn). Centralised as a single source of truth so the paths can't drift:
 * the recruitment routes and admin spawn previously built the NPP document
 * inline without these fields, so recruited NPPs spawned with donorBaseLevel
 * undefined — rendering as 0/10 with zero donor income.
 *
 * donorBaseLevel starts at 1 so NPPs draw a small donor income from turn one
 * (see getDonorBaseBonusLogarithmic). The rest start at 0: no banked funds, no
 * action points, never processed.
 *
 * Note: passive-investment fields (nppInvestmentCashAnchor,
 * lastIndexFundInvestmentTurn) are intentionally excluded — they are accrued
 * during turn processing, not stamped at spawn.
 */
export const NPP_ECONOMY_DEFAULTS: Pick<
  NPP,
  "funds" | "donorBaseLevel" | "actionPoints" | "lastActionProcessedTurn"
> = {
  funds: 0,
  donorBaseLevel: 1,
  actionPoints: 0,
  lastActionProcessedTurn: 0,
};
