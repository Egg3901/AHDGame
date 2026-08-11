import type { FinancialVisibilityReason } from "../types";

/**
 * Human copy for each reason money figures are withheld. One source of truth so
 * the hero-card stat tooltip and the overview notice never drift apart.
 *
 * `short` labels a single blanked stat cell; `title`/`body` fill the notice
 * banner that stands in for the whole missing money panel. The point of every
 * string is the same: a withheld number is NOT a real $0, and the most common
 * cause is simply not being signed in as the owner on this device.
 */
export interface FinancialVisibilityCopy {
  short: string;
  title: string;
  body: string;
}

const COPY: Record<Exclude<FinancialVisibilityReason, "visible">, FinancialVisibilityCopy> = {
  "signed-out": {
    short: "Sign in to view",
    title: "You are not signed in on this device",
    body: "Revenue, profit and margin are only shown to the sector's owner. If this is your sector, sign in with the owning account here, the figures are not zero, they are hidden.",
  },
  "public-rival": {
    short: "Owner only",
    title: "Rivals cannot see a public company's live figures",
    body: "This is a listed company you do not own. Its live revenue, profit and margin are hidden from competitors, this is not a $0 sector. Market share and the market pie stay public.",
  },
  "private-corp": {
    short: "Private company",
    title: "This company keeps its books private",
    body: "The owner has set this corporation to private, so its revenue, profit and margin are hidden from everyone but them. The figures exist, they are just not disclosed.",
  },
};

export function financialVisibilityCopy(
  reason: FinancialVisibilityReason
): FinancialVisibilityCopy | null {
  if (reason === "visible") return null;
  return COPY[reason];
}
