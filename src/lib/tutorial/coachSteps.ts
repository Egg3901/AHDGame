import type { Character } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { legislatureUrl } from "@/lib/urls";
import type { TutorialChapterId } from "@/lib/onboarding/tutorialPlan";
import type { TutorialFactKey } from "@/lib/tutorial/facts";

/**
 * Interactive tutorial coach — the step vocabulary.
 *
 * Chapter content lives in `chapters.ts`; this module owns the shape a step
 * takes and the country resolution every chapter needs. Two kinds of step:
 *  - Action steps (`anchor` + `link`): highlight a real element on a real page,
 *    tell the player what to do, and auto-advance when they do it.
 *  - Strategy cards (no `anchor`): centered advice the new player actually needs
 *    (build a donor base, do not self-fund). These never depend on the DOM, so
 *    they always render cleanly.
 *
 * Copy is country-neutral: region nouns, the legislature name, and deep links
 * all come from the character's country config, so nothing reads as US-only.
 */

export const COMMUNITY_DISCORD_URL = "https://discord.gg/DmF8zJJuqN";

/**
 * Elements a step can spotlight. Each id must exist as a `data-coach="…"`
 * attribute on the page named in the step's `link`.
 */
export type CoachAnchor =
  | "nav-region"
  | "nav-parties"
  | "nav-actions"
  | "nav-elections"
  | "nav-legislature"
  | "nav-news"
  | "nav-stockmarket"
  | "nav-portfolio"
  | "nav-corporations"
  | "nav-unions"
  | "nav-budget"
  | "nav-races"
  | "action-campaign"
  | "action-advertise"
  | "action-fundraise"
  | "action-buildDonorBase";

/**
 * Real-world things the coach can watch for to advance a step on its own,
 * polled from GET /api/onboarding/signals.
 */
export type CoachAdvanceSignal =
  "party" | "vote" | "campaign" | "candidacy" | "invest" | "company" | "union";

export interface CoachStep {
  id: string;
  title: string;
  body: string;
  /** Extra line shown when the step waits on a real player action. */
  hint?: string;
  /** The `data-coach` anchor to spotlight. Absent = centered strategy card. */
  anchor?: CoachAnchor;
  /** Route the anchor lives on. If the player is elsewhere, the card offers to go there. */
  link?: string;
  /** When true, `link` is an external URL opened in a new tab (e.g. Discord). */
  external?: boolean;
  /**
   * Optional "go look at this" link on a strategy card. Unlike `link` it never
   * blocks the step: the card still shows its normal advance button, so a
   * player who does not want the detour is not stuck.
   */
  readMore?: { label: string; href: string };
  /** Button label for manual advance. */
  next: string;
  /** True when the intended way forward is doing the action, not the button. */
  waits?: boolean;
  /** Auto-advance once the real action is detected via /api/onboarding/signals. */
  advanceSignal?: CoachAdvanceSignal;
  /**
   * Explains something a returning player already knows. Dropped from the
   * "new to this iteration" tour (see stepVisibleForExperience).
   */
  fundamental?: boolean;
  /** Live world numbers to show on the card, from GET /api/tutorial/context. */
  facts?: TutorialFactKey[];
}

/** A step once the tour knows which chapter it came from. */
export interface TourStep extends CoachStep {
  chapterId: TutorialChapterId;
  chapterTitle: string;
  /** 0-based position of this step's chapter within the player's tour. */
  chapterIndex: number;
}

export type CoachCharacter = Pick<Character, "countryId" | "homeState">;

/** Lowercased per-country region noun ("state", "nation", "land", "region"). */
export function regionNoun(countryId: string): string {
  const label = COUNTRY_CONFIGS[countryId as CountryId]?.regionLabel ?? "State";
  return label.toLowerCase();
}

/** Everything the chapter builders need to write country-correct copy. */
export interface CoachCountryContext {
  countryId: string;
  homeState: string;
  countryName: string;
  /** "state" / "nation" / "land" / "region". */
  region: string;
  /** "Congress", "the Commons", "the Bundestag", … */
  legislatureName: string;
  /** Canonical legislature route. Never a redirect shell (see below). */
  legislatureLink: string;
}

export function coachCountryContext(character: CoachCharacter): CoachCountryContext {
  const countryId = character.countryId;
  const config = COUNTRY_CONFIGS[countryId as CountryId];
  return {
    countryId,
    homeState: character.homeState,
    countryName: config?.name ?? "your country",
    region: regionNoun(countryId),
    legislatureName: config?.legislature.name ?? "the legislature",
    // Always the canonical route, never /congress. /congress is a redirect
    // shell to this same URL, and a step linking to a redirect softlocks the
    // coach: the browser lands somewhere the step does not recognise, so
    // `onStepPage` never becomes true and the button stays on "Take me there"
    // with no way past. This shipped once; the redirect test now guards it.
    legislatureLink: legislatureUrl(countryId),
  };
}
