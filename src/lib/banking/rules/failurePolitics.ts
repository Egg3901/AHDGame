/** Political consequences of a completed, cash-funded bank resolution. */
export const BANK_FAILURE_MEMORY_TURNS = 48;
export interface BankFailurePoliticalEvent {
  _id: string;
  bankId: string;
  charteredTurn: number;
  countryId: string;
  currency: string;
  /** Null until completed settlement publication is activated. */
  paidTurn: number | null;
  depositExposure: number;
  insurancePaid: number;
  taxpayerPaid: number;
  gdp: number;
}
export interface BankFailurePoliticalEffects {
  approval: number;
  consumerConfidence: number;
}
const positive = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);
export function bankFailurePoliticalEffects(
  events: readonly BankFailurePoliticalEvent[],
  countryId: string,
  turn: number
): BankFailurePoliticalEffects {
  let approval = 0;
  let consumerConfidence = 0;
  const seen = new Set<string>();
  for (const event of events) {
    if (
      seen.has(event._id) ||
      event.countryId !== countryId ||
      !(event.gdp > 0) ||
      !Number.isFinite(event.gdp)
    )
      continue;
    seen.add(event._id);
    if (typeof event.paidTurn !== "number" || !Number.isInteger(event.paidTurn)) continue;
    const age = turn - event.paidTurn;
    if (!Number.isInteger(age) || age < 0 || age >= BANK_FAILURE_MEMORY_TURNS) continue;
    const memory = 1 - age / BANK_FAILURE_MEMORY_TURNS;
    approval -= Math.min(3, (100 * positive(event.taxpayerPaid)) / event.gdp) * memory;
    consumerConfidence -=
      Math.min(10, (100 * positive(event.depositExposure)) / event.gdp) * memory;
  }
  return {
    approval: Math.max(-3, approval),
    consumerConfidence: Math.max(-10, consumerConfidence),
  };
}
