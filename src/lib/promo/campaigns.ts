/**
 * Server-side catalogue of bot-issued promotional cash grants.
 *
 * The grant amount lives here and only here: callers name a campaign and the
 * server decides what it pays. `amountAnchor` is denominated in anchor units
 * (₳, rate 1.0) and is converted into the recipient's home currency at the
 * live FX rate when credited.
 */
export interface PromoCampaign {
  /** Grant size in anchor units (₳). */
  amountAnchor: number;
  /** Human-readable label for logs and ledger metadata. */
  label: string;
}

export const PROMO_CAMPAIGNS = {
  "itch-boost-2026-10": { amountAnchor: 5_000_000, label: "itch.io community boost" },
} as const satisfies Record<string, PromoCampaign>;

export type PromoCampaignId = keyof typeof PROMO_CAMPAIGNS;

export function getPromoCampaign(id: string): PromoCampaign | null {
  return Object.prototype.hasOwnProperty.call(PROMO_CAMPAIGNS, id)
    ? PROMO_CAMPAIGNS[id as PromoCampaignId]
    : null;
}
