import type { DocketCase, DocketCaseAxis, DocketCaseOutcome } from "@/lib/db/types/scotus";
import type { SurpriseCaseTemplate } from "./surpriseCaseTemplates";
import { createSystemNewsPost } from "@/lib/news";
import { sendNewsEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";

/**
 * SCOTUS news/wire integration (owner ask: "make sure these get full news
 * posts and wire").
 *
 * Neither `scotusDocketTurn.ts` nor `scotusSurpriseCaseTurn.ts` posted
 * anything before this file existed — `onBillEnacted` (which both call for a
 * diverged ruling's law-equivalent effect) does NOT itself post news;
 * `generateBillSignedNews`/`generateBillVetoedNews` (src/lib/news.ts) are
 * only called from the human-driven signing paths
 * (presidentialBillAction.ts, stateBillActions.ts), never from the
 * synthetic SCOTUS enactment path. So a decided Docket case — historical or
 * surprise, affirmed or diverged, with or without a mechanical `effect` —
 * was decorative from a news/wire standpoint until this module.
 *
 * Mirrors the existing "post to the in-app feed AND push to the Discord news
 * webhook" pattern already used for decade/metric-activation milestones
 * (`src/lib/turn/eraCrossing.ts` `runMetricActivation`): one
 * `createSystemNewsPost` call (category "judicial") + one `sendNewsEvent`
 * call sharing the same title/body. Both are no-ops-on-failure at the
 * `sendNewsEvent` layer (catches internally) but NOT here — callers should
 * `.catch(...)` like every other fire-and-forget news hook in this codebase
 * (see `billEnactment.ts`'s `recordCountryEvent` call for the idiom).
 */

export interface ScotusNewsContent {
  title: string;
  body: string;
}

interface DecidedCaseVote {
  outcome: DocketCaseOutcome;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
}

/**
 * Pure builder for a curated Docket case's wire post. Prefers the case's
 * authored `historicalSummary`/`alternateSummary` (plain-language holding +
 * consequence, written for every case in the catalogue) and falls back to a
 * generic sentence only for content that hasn't had summaries authored, so
 * this never throws on a case missing the optional field.
 */
export function buildDocketCaseNews(
  docketCase: DocketCase,
  decision: DecidedCaseVote
): ScotusNewsContent {
  const affirmed = decision.outcome === "affirmed";
  const headlineTag = affirmed ? "Historical Ruling Holds" : "Court Breaks From History";
  const title = `SCOTUS Ruling: ${docketCase.title} (${docketCase.decisionYear}): ${headlineTag}`;

  const summary =
    (affirmed ? docketCase.historicalSummary : docketCase.alternateSummary) ??
    (affirmed
      ? `The Court affirmed the historical outcome in ${docketCase.title}.`
      : `The Court broke from history in ${docketCase.title}, ruling the other way.`);

  const vote = buildVoteLine(docketCase.axis, decision);
  const body = `${summary}\n\n${vote}`;

  return { title, body };
}

interface SurpriseDecision {
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  majoritySide: -1 | 0 | 1;
}

/**
 * Pure builder for a procedurally-spawned "surprise" case's wire post
 * (#3607 flavor content — not part of the curated landmark catalogue, so
 * there's no authored holding/alternate text to draw on). Kept deliberately
 * generic; a tied Court (majoritySide 0) gets a distinct "no ruling" post
 * rather than a fabricated outcome.
 */
export function buildSurpriseCaseNews(
  template: SurpriseCaseTemplate,
  decision: SurpriseDecision
): ScotusNewsContent {
  const title = `SCOTUS Docket Surprise: ${template.title}`;

  if (decision.majoritySide === 0) {
    const body = `An unscripted docket entry, ${template.title} reached the Court to a dead-even split among the sitting justices on its ${template.axis} axis. With no controlling majority, the case produced no ruling and no policy change.`;
    return { title, body };
  }

  const sideLabel =
    decision.majoritySide === 1
      ? "the Court's right-leaning bloc"
      : "the Court's left-leaning bloc";
  const body = `An unscripted docket entry, ${template.title}, was carried by ${sideLabel}, ${decision.positiveCount}-${decision.negativeCount} on the case's ${template.axis} axis, triggering a federal policy shift in that direction.`;

  return { title, body };
}

function buildVoteLine(axis: DocketCaseAxis, decision: DecidedCaseVote): string {
  const { positiveCount, negativeCount, neutralCount } = decision;
  const neutralClause =
    neutralCount > 0
      ? `, ${neutralCount} justice${neutralCount === 1 ? "" : "s"} recorded no lean on this axis`
      : "";
  return `The sitting Court divided ${positiveCount}-${negativeCount}${neutralClause} on the case's ${axis} axis.`;
}

/** Post + wire a decided curated Docket case. Does not catch — callers should `.catch(...)` per the repo's fire-and-forget news idiom. */
export async function generateScotusRulingNews(
  docketCase: DocketCase,
  decision: DecidedCaseVote
): Promise<void> {
  const { title, body } = buildDocketCaseNews(docketCase, decision);
  await createSystemNewsPost(body, "judicial", { title });
  await sendNewsEvent({ title, description: body, color: DISCORD_COLORS.scotusRuling });
}

/** Post + wire a decided surprise Docket case. Does not catch — callers should `.catch(...)`. */
export async function generateScotusSurpriseNews(
  template: SurpriseCaseTemplate,
  decision: SurpriseDecision
): Promise<void> {
  const { title, body } = buildSurpriseCaseNews(template, decision);
  await createSystemNewsPost(body, "judicial", { title });
  await sendNewsEvent({ title, description: body, color: DISCORD_COLORS.scotusRuling });
}

/**
 * Pure builder for a Court vacancy (Original Roster chain exhausted, or an
 * NPP Divergent Justice's hazard clock firing). Player-held seats are not
 * vacated by the hazard; this copy is for the seats that do open.
 */
export function buildScotusVacancyNews(input: {
  seatNumber: number;
  justiceName: string | null;
}): ScotusNewsContent {
  const title = `SCOTUS Seat #${input.seatNumber} Vacant`;
  const who = input.justiceName?.trim() || "A justice";
  const body = `${who} has left the Supreme Court. Seat #${input.seatNumber} is now vacant and awaits a presidential nomination.`;
  return { title, body };
}

/** Post + wire a Court vacancy. Does not catch — callers should `.catch(...)`. */
export async function generateScotusVacancyNews(input: {
  seatNumber: number;
  justiceName: string | null;
}): Promise<void> {
  const { title, body } = buildScotusVacancyNews(input);
  await createSystemNewsPost(body, "judicial", { title });
  await sendNewsEvent({ title, description: body, color: DISCORD_COLORS.scotusRuling });
}
