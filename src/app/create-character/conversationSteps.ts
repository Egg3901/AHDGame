/**
 * Canonical step model for the guided (conversational) character creator.
 *
 * The steps mirror the classic all-at-once form one-to-one: Country, The
 * politician, Home region, Where you stand, Party, Stats (only when the
 * RPG-stats flag is on), Review. This module owns order, titles, and prompts
 * only. Completion and summaries stay with the page, which already derives
 * them from the same validation the submit path enforces, so the shell can
 * never drift from what filing actually requires.
 */

export const CONVERSATION_STEP_IDS = [
  "country",
  "politician",
  "region",
  "compass",
  "party",
  "stats",
  "review",
] as const;

export type ConversationStepId = (typeof CONVERSATION_STEP_IDS)[number];

/** One step as the shell sees it: identity, wording, and parent-owned state. */
export interface ConversationStep {
  id: ConversationStepId;
  title: string;
  prompt: string;
  /** Complete under the existing validation rules for this step. */
  complete: boolean;
  /** One-line answer shown in the transcript once complete. */
  summary: string | null;
}

/**
 * Canonical order, minus Stats when the RPG-stats flag is off. Review always
 * closes the flow.
 */
export function visibleConversationStepIds(rpgStatsEnabled: boolean): ConversationStepId[] {
  return CONVERSATION_STEP_IDS.filter((id) => id !== "stats" || rpgStatsEnabled);
}

function titleFor(id: ConversationStepId, regionNoun: string): string {
  switch (id) {
    case "country":
      return "Country";
    case "politician":
      return "The politician";
    case "region":
      return `Home ${regionNoun}`;
    case "compass":
      return "Where you stand";
    case "party":
      return "Party";
    case "stats":
      return "Stats";
    case "review":
      return "Review";
  }
}

function promptFor(id: ConversationStepId, regionNoun: string): string {
  switch (id) {
    case "country":
      return "Which country will your politician run in?";
    case "politician":
      return "Who is your politician? Give them a name and a background.";
    case "region":
      return `Which ${regionNoun} is home?`;
    case "compass":
      return "Where do you stand? Place yourself on the compass.";
    case "party":
      return "Which party will carry your name? Independent is a real choice, so pick one on purpose.";
    case "stats":
      return "How is your politician built? Spend every point.";
    case "review":
      return "Read your file before you file it. Anything can still change.";
  }
}

export function buildConversationSteps(args: {
  regionNoun: string;
  rpgStatsEnabled: boolean;
  complete: Record<ConversationStepId, boolean>;
  summary: Record<ConversationStepId, string | null>;
}): ConversationStep[] {
  return visibleConversationStepIds(args.rpgStatsEnabled).map((id) => ({
    id,
    title: titleFor(id, args.regionNoun),
    prompt: promptFor(id, args.regionNoun),
    complete: args.complete[id],
    summary: args.summary[id],
  }));
}
