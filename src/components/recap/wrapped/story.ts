import type { ActionType } from "@/lib/db/types/gameState";
import type { CharacterRecap } from "@/lib/recap/types";

/**
 * Which slides a recap gets, in order. Pure so the order and gating are
 * testable. Each slide is gated on its own data, never on `schemaVersion`, so a
 * v1 recap (no v2 sections) still plays a shorter story.
 */

export type SlideKind =
  | "open"
  | "world"
  | "strip"
  | "guess"
  | "climb"
  | "race"
  | "votes"
  | "rival"
  | "law"
  | "fortune"
  | "standing"
  | "wire"
  | "honors"
  | "awards"
  | "persona"
  | "finale";

export interface StorySlide {
  kind: SlideKind;
  /** Auto-advance after this long; the guess slide holds until answered. */
  ms: number;
}

export const ACTION_LABELS: Record<ActionType, string> = {
  fundraise: "Fundraising",
  campaign: "Campaigning",
  advertise: "Advertising",
  buildDonorBase: "Building donors",
  poll: "Polling",
  pollLarge: "Deep polling",
  convertCash: "Moving money",
  rest: "Resting",
  debatePrep: "Debate prep",
};

/**
 * Display name for an action type. actionLogs carry more types than the
 * `ActionType` union (sector and market moves among them), so unknown keys are
 * split from camelCase rather than shown raw.
 */
export function actionLabel(type: string): string {
  const known = (ACTION_LABELS as Record<string, string>)[type];
  if (known) return known;
  const words = type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MIN_GUESS_ACTIONS = 10;
const NOT_A_DECOY = new Set(["rest", "convertCash"]);

/** Three options for the guess slide: the true top action plus two decoys. */
export function guessOptions(recap: CharacterRecap): ActionType[] | null {
  const top = recap.actions.topType;
  if (!top || recap.actions.total < MIN_GUESS_ACTIONS) return null;
  const used = Object.keys(recap.actions.byType) as ActionType[];
  const pool = [...new Set([...used, ...(Object.keys(ACTION_LABELS) as ActionType[])])]
    .filter((t) => t !== top && !NOT_A_DECOY.has(t))
    .sort((a, b) => (recap.actions.byType[b] ?? 0) - (recap.actions.byType[a] ?? 0));
  const decoys = pool.slice(0, 2);
  if (decoys.length < 2) return null;
  // Stable shuffle keyed on the character so a rewatch asks the same question.
  const seed = [...recap.characterId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const opts = [top, ...decoys];
  const pos = seed % 3;
  [opts[0], opts[pos]] = [opts[pos], opts[0]];
  return opts;
}

function hasRaceStory(r: CharacterRecap): boolean {
  return Boolean(r.races?.bestWin || r.races?.closest);
}

export function buildStory(recap: CharacterRecap): StorySlide[] {
  const s: StorySlide[] = [{ kind: "open", ms: 6000 }];
  if (recap.world) s.push({ kind: "world", ms: 7000 });
  if (recap.actions.total > 0) s.push({ kind: "strip", ms: 7500 });
  if (guessOptions(recap)) s.push({ kind: "guess", ms: 6000 });
  if ((recap.climb?.length ?? 0) > 0 || recap.highestOffice) s.push({ kind: "climb", ms: 7000 });
  if (hasRaceStory(recap)) s.push({ kind: "race", ms: 8500 });
  else if ((recap.races?.totalVotes ?? 0) > 0 || recap.elections.entered > 0)
    s.push({ kind: "votes", ms: 6000 });
  if (recap.races?.rival) s.push({ kind: "rival", ms: 7500 });
  if (recap.legislation || recap.bills.sponsored > 0) s.push({ kind: "law", ms: 8500 });
  if (recap.wealth || recap.netWorth || recap.campaignFunds) s.push({ kind: "fortune", ms: 7500 });
  // Influence ranks among zero-influence players are ties, not standings.
  if (recap.influence.npi?.rank != null && recap.influence.npi.value > 0)
    s.push({ kind: "standing", ms: 7000 });
  if (recap.social) s.push({ kind: "wire", ms: 5500 });
  if (recap.achievements.count > 0) s.push({ kind: "honors", ms: 5500 });
  if ((recap.awards?.length ?? 0) > 0) s.push({ kind: "awards", ms: 8000 });
  if (recap.persona) s.push({ kind: "persona", ms: 6500 });
  s.push({ kind: "finale", ms: 0 });
  return s;
}
