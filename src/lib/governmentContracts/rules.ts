/**
 * Government contract bidding uses sealed corporate bids until the closing turn.
 * tenderTab and canBid enforce turn deadlines; compareBids orders fixed-term bids
 * by price without choosing a winner for the government.
 */
import type { ContractBid, GovernmentTender, TenderTab } from "./types";

export const BIDDING_TURNS_MIN = 6;
export const BIDDING_TURNS_MAX = 48;
export const BIDDING_TURNS_DEFAULT = 24;
export const AWARD_WINDOW_TURNS = 24;

export function tenderDeadlines(turn: number, biddingTurns = BIDDING_TURNS_DEFAULT) {
  const closesTurn = turn + biddingTurns;
  return { closesTurn, awardDeadlineTurn: closesTurn + AWARD_WINDOW_TURNS };
}

export const CONTRACTS_PAGE_SIZE = 10;
export function visibleBidHistory(
  history: ContractBid[],
  closesTurn: number,
  turn: number,
  userId?: string,
  ownedCorporationIds?: ReadonlySet<string>
): ContractBid[] {
  return history.filter(
    (b) =>
      turn >= closesTurn ||
      (ownedCorporationIds ? ownedCorporationIds.has(b.corporationId) : b.userId === userId)
  );
}

/** Maximum funding held by an untargeted defence tender; concessions hold capacity instead. */
export function tenderReservationValue(terms: import("./types").TenderTerms): number | null {
  const value = terms.type === "defence" ? terms.lots * terms.maximumPricePerLot : 0;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function validContractCopy(copy: string): boolean {
  return !/[\u2013\u2014]/u.test(copy);
}
export function extractionBidError(input: {
  corporationType: string;
  hasOperations: boolean;
  amount: number;
  minimum: number;
}): string | null {
  if (
    ![input.amount, input.minimum].every(Number.isFinite) ||
    input.amount < 0 ||
    input.minimum < 0
  )
    return "The signing fee must be a valid nonnegative amount.";
  if (input.corporationType !== "extraction")
    return "Only extraction corporations may bid on this concession.";
  if (!input.hasOperations) return "The corporation must operate in this state.";
  if (input.amount < input.minimum) return "The signing fee is below this tender's minimum.";
  return null;
}
export function defenceBidError(input: {
  supplierGrade: number;
  eraGrade?: number;
  requiredGrade: number;
  amount: number;
  maximum: number;
  floor: number | null;
  ceiling: number | null;
  supplierRemainingLots: number;
  lots: number;
}): string | null {
  if (
    ![
      input.supplierGrade,
      input.eraGrade ?? 3,
      input.requiredGrade,
      input.amount,
      input.maximum,
      input.floor,
      input.ceiling,
      input.supplierRemainingLots,
      input.lots,
    ].every((v) => typeof v === "number" && Number.isFinite(v)) ||
    input.amount <= 0 ||
    input.lots <= 0
  )
    return "The procurement values must be finite and valid.";
  if (Math.min(input.supplierGrade, input.eraGrade ?? 3) < input.requiredGrade)
    return "The plant cannot supply the required equipment grade.";
  if (
    input.floor == null ||
    input.ceiling == null ||
    input.amount < input.floor ||
    input.amount > input.ceiling ||
    input.amount > input.maximum
  )
    return "The bid must fit the current permitted price band and this tender's maximum.";
  if (input.supplierRemainingLots < input.lots)
    return "The supplier cannot take this order within its quarterly concentration limit.";
  return null;
}

export function tenderTab(
  tender: Pick<GovernmentTender, "status" | "closesTurn" | "awardDeadlineTurn">,
  turn: number
): TenderTab {
  if (tender.status === "awarded") return "awarded";
  if (tender.status === "canceled") return "canceled";
  if (tender.status !== "awarding" && turn >= tender.awardDeadlineTurn) return "canceled";
  return turn < tender.closesTurn && tender.status !== "awarding" ? "active" : "closed";
}
export function canBid(
  tender: Pick<GovernmentTender, "status" | "closesTurn" | "awardDeadlineTurn">,
  turn: number
): boolean {
  return tender.status === "open" && tenderTab(tender, turn) === "active";
}
export function canAward(
  tender: Pick<GovernmentTender, "status" | "closesTurn" | "awardDeadlineTurn">,
  turn: number
): boolean {
  return tender.status === "open" && turn >= tender.closesTurn && turn < tender.awardDeadlineTurn;
}
export function visibleBids(
  tender: Pick<GovernmentTender, "bids" | "closesTurn">,
  turn: number,
  userId?: string,
  ownedCorporationIds?: ReadonlySet<string>
): ContractBid[] {
  return Object.values(tender.bids).filter(
    (b) =>
      (ownedCorporationIds ? ownedCorporationIds.has(b.corporationId) : b.userId === userId) ||
      (!b.withdrawn && turn >= tender.closesTurn)
  );
}
export function compareBids(
  type: "defence" | "extraction",
  left: ContractBid,
  right: ContractBid
): number {
  return (
    (type === "defence" ? left.amount - right.amount : right.amount - left.amount) ||
    left.submittedTurn - right.submittedTurn ||
    left.corporationId.localeCompare(right.corporationId)
  );
}
export function validDeadlines(
  turn: number,
  closesTurn: number,
  awardDeadlineTurn: number
): boolean {
  return (
    Number.isSafeInteger(turn) &&
    turn >= 1 &&
    Number.isSafeInteger(closesTurn) &&
    Number.isSafeInteger(awardDeadlineTurn) &&
    closesTurn - turn >= BIDDING_TURNS_MIN &&
    closesTurn - turn <= BIDDING_TURNS_MAX &&
    awardDeadlineTurn - closesTurn === AWARD_WINDOW_TURNS
  );
}
export function normalizePage(raw: string | null): number {
  const n = Number(raw ?? 1);
  return Number.isSafeInteger(n) && n > 0 && n <= 100000 ? n : 1;
}
export function officeContractType(
  countryId: string,
  positionId: string,
  financePositionId: string | undefined,
  defencePositionId: string | null | undefined
): "defence" | "extraction" | null {
  if (!countryId) return null;
  if (positionId === defencePositionId) return "defence";
  if (positionId === financePositionId) return "extraction";
  return null;
}
