/**
 * System-news emit helpers for sovereign-default events.
 *
 * Three Phase 4 events:
 *   - auctionUndersubscribed: 0.7 <= demand < 1.0
 *   - auctionFailed: demand < 0.7 (with running count)
 *   - crisisFired: warning + 3rd consecutive failure -> crisisPending
 *
 * All emit via `createSystemNewsPost(content, "sovereign")`.
 */

import { createSystemNewsPost } from "@/lib/news";
import { FAILED_AUCTION_COUNT_FOR_CRISIS } from "./constants";

function formatDemand(demandRatio: number): string {
  return demandRatio.toFixed(2);
}

export async function emitAuctionUndersubscribedNews(
  countryCode: string,
  demandRatio: number
): Promise<void> {
  const content =
    `Bond Auction Undersubscribed — ${countryCode}: market demand ${formatDemand(demandRatio)}. ` +
    `Treasury raised funds at a yield premium; investor confidence is wavering.`;
  await createSystemNewsPost(content, "sovereign");
}

export async function emitAuctionFailedNews(
  countryCode: string,
  demandRatio: number,
  consecutiveCount: number
): Promise<void> {
  const displayCount = Math.min(consecutiveCount, FAILED_AUCTION_COUNT_FOR_CRISIS);
  const content =
    `Bond Auction Failed — ${countryCode}: demand collapsed to ${formatDemand(demandRatio)} ` +
    `(${displayCount}/${FAILED_AUCTION_COUNT_FOR_CRISIS} consecutive failed auctions). ` +
    `One more failure may force a sovereign-debt crisis.`;
  await createSystemNewsPost(content, "sovereign");
}

export async function emitCrisisFiredNews(countryCode: string, currentTurn: number): Promise<void> {
  const content =
    `Sovereign Debt Crisis — ${countryCode}: bond auctions have failed ${FAILED_AUCTION_COUNT_FOR_CRISIS} ` +
    `consecutive times. The head of state must choose a resolution path within 12 hours. ` +
    `(turn ${currentTurn})`;
  await createSystemNewsPost(content, "sovereign");
}

function formatPrincipalAbbrev(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
}

export async function emitBailoutGrantedNews(
  countryCode: string,
  currentTurn: number,
  principal: number
): Promise<void> {
  const content =
    `Sovereign Crisis Resolved — ${countryCode}: IMF bailout granted ` +
    `(${formatPrincipalAbbrev(principal)} facility). Country enters recovery; austerity in effect. ` +
    `(turn ${currentTurn})`;
  await createSystemNewsPost(content, "sovereign");
}

export async function emitRepudiatedNews(
  countryCode: string,
  currentTurn: number,
  bondsAffected: number
): Promise<void> {
  const content =
    `Sovereign Default — ${countryCode}: government has repudiated all outstanding ` +
    `sovereign debt (${bondsAffected} bond series). Bond markets locked; recovery beginning. ` +
    `(turn ${currentTurn})`;
  await createSystemNewsPost(content, "sovereign");
}

export async function emitRestructuredNews(
  countryCode: string,
  currentTurn: number,
  haircutPercent: number,
  bondsAffected: number
): Promise<void> {
  const haircutPct = Math.round(haircutPercent * 100);
  const content =
    `Sovereign Restructuring — ${countryCode}: ${haircutPct}% haircut applied to ` +
    `${bondsAffected} sovereign bond series, with extended maturities. Recovery beginning. ` +
    `(turn ${currentTurn})`;
  await createSystemNewsPost(content, "sovereign");
}

export async function emitMonetizedNews(
  countryCode: string,
  currentTurn: number,
  printedAmount: number,
  inflationShockPp: number
): Promise<void> {
  const content =
    `Sovereign Monetization — ${countryCode}: central bank printed ` +
    `${formatPrincipalAbbrev(printedAmount)} to cover the financing gap, ` +
    `adding ${inflationShockPp.toFixed(1)} percentage points to inflation. ` +
    `(turn ${currentTurn})`;
  await createSystemNewsPost(content, "sovereign");
}

export async function emitRecoveryCompleteNews(
  countryCode: string,
  currentTurn: number
): Promise<void> {
  const content =
    `Sovereign Recovery Complete — ${countryCode}: bond markets re-opened; ` +
    `credit rating reset. (turn ${currentTurn})`;
  await createSystemNewsPost(content, "sovereign");
}

export async function emitImfBoardStatementNews(
  countryCode: string,
  kind: "publicEndorsement" | "publicCriticism",
  statement: string
): Promise<void> {
  const verb = kind === "publicEndorsement" ? "endorses" : "criticizes";
  const tone =
    kind === "publicEndorsement"
      ? "Public-trust modifier applied positively across markets."
      : "Public-trust modifier applied negatively across markets.";
  const trimmed = statement.length > 280 ? statement.slice(0, 277) + "…" : statement;
  const body = trimmed.length > 0 ? ` "${trimmed}"` : "";
  const content = `IMF Board ${verb} ${countryCode}'s bailout terms.${body} ${tone}`;
  await createSystemNewsPost(content, "sovereign");
}
