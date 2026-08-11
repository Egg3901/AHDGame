/**
 * Tutorial plan — the two answers a player gives before the guided tour runs.
 *
 * 1. `experience`: how well they already know the game.
 *      "skip"      — no tour. Nothing auto-starts; /tutorial stays available.
 *      "returning" — played a previous iteration. Gets the what-changed chapter
 *                    and skips every step tagged `fundamental`.
 *      "new"       — never played. Gets everything, in order.
 * 2. `interests`: what they actually want to do. Multi-select; "All of it" in
 *    the UI is stored as every interest, never as a literal "all" value, so no
 *    consumer has to special-case it.
 *
 * This replaces the old single `tutorialTrack` axis ("politics" | "complete"),
 * which could only say "hide the econ steps". Every guided surface (coach
 * chapters, onboarding checklist, welcome mail, /tutorial hub) reads the plan
 * so they can never disagree about what a player asked to be shown.
 */

/**
 * @deprecated The pre-plan axis, kept only so existing `tutorialTrack` values
 * on character documents still type-check where they are read and migrated.
 */
export const TUTORIAL_TRACKS = ["politics", "complete"] as const;
/** @deprecated See {@link TUTORIAL_TRACKS}. */
export type TutorialTrack = (typeof TUTORIAL_TRACKS)[number];

export const TUTORIAL_EXPERIENCES = ["skip", "returning", "new"] as const;
export type TutorialExperience = (typeof TUTORIAL_EXPERIENCES)[number];

/**
 * Interest ids, in the order the selector renders them. Each maps 1:1 onto the
 * chapter of the same id (see TUTORIAL_CHAPTER_IDS).
 */
export const TUTORIAL_INTERESTS = ["invest", "company", "union", "office", "nation"] as const;
export type TutorialInterest = (typeof TUTORIAL_INTERESTS)[number];

/**
 * Chapter ids. "core" always runs; "whats-new" runs for returning players only;
 * the rest are the interest chapters.
 */
export const TUTORIAL_CHAPTER_IDS = [
  "whats-new",
  "core",
  "office",
  "invest",
  "company",
  "union",
  "nation",
] as const;
export type TutorialChapterId = (typeof TUTORIAL_CHAPTER_IDS)[number];

/**
 * Tour order for the interest chapters. Deliberately not the selector order:
 * "office" leads because a party and a seat unlock most of what the other
 * chapters talk about, and "nation" trails because it is the top of the ladder.
 */
const INTEREST_CHAPTER_ORDER: readonly TutorialInterest[] = [
  "office",
  "invest",
  "company",
  "union",
  "nation",
];

export interface TutorialPlan {
  experience: TutorialExperience;
  interests: TutorialInterest[];
}

/** What a character with no stored choice and no legacy track gets. */
export const DEFAULT_TUTORIAL_PLAN: TutorialPlan = {
  experience: "new",
  interests: [...TUTORIAL_INTERESTS],
};

export function isTutorialExperience(value: unknown): value is TutorialExperience {
  return typeof value === "string" && (TUTORIAL_EXPERIENCES as readonly string[]).includes(value);
}

export function isTutorialInterest(value: unknown): value is TutorialInterest {
  return typeof value === "string" && (TUTORIAL_INTERESTS as readonly string[]).includes(value);
}

export function isTutorialChapterId(value: unknown): value is TutorialChapterId {
  return typeof value === "string" && (TUTORIAL_CHAPTER_IDS as readonly string[]).includes(value);
}

/** Deduplicate and canonically order a possibly-messy interest list. */
export function normalizeInterests(value: unknown): TutorialInterest[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set(value.filter(isTutorialInterest));
  return TUTORIAL_INTERESTS.filter((id) => seen.has(id));
}

/** The shape resolveTutorialPlan reads off a character document. */
export interface TutorialPlanSource {
  tutorial?: { experience?: unknown; interests?: unknown } | null;
  /** Legacy pre-plan field. Migrated in memory; never backfilled. */
  tutorialTrack?: unknown;
}

/**
 * Normalize a character to a concrete plan.
 *
 * Migration is in-memory only, so nothing has to be backfilled:
 *   legacy "politics" → the office chapter alone (its exact old behavior:
 *                       politics steps, econ steps hidden)
 *   legacy "complete" / absent → every interest (the full experience every
 *                       pre-plan character has today)
 *
 * A stored plan always wins over the legacy field.
 */
export function resolveTutorialPlan(source: TutorialPlanSource | null | undefined): TutorialPlan {
  const stored = source?.tutorial;
  if (stored && isTutorialExperience(stored.experience)) {
    const interests = normalizeInterests(stored.interests);
    return {
      experience: stored.experience,
      // "skip" legitimately has no interests; any other experience with an
      // empty list is corrupt state, so fall back to the full tour.
      interests:
        stored.experience === "skip"
          ? interests
          : interests.length > 0
            ? interests
            : [...TUTORIAL_INTERESTS],
    };
  }

  if (source?.tutorialTrack === "politics") {
    return { experience: "new", interests: ["office"] };
  }
  return { ...DEFAULT_TUTORIAL_PLAN, interests: [...TUTORIAL_INTERESTS] };
}

/** Ordered chapter ids this plan runs. Empty for "skip". */
export function chapterIdsForPlan(plan: TutorialPlan): TutorialChapterId[] {
  if (plan.experience === "skip") return [];
  const selected = new Set(plan.interests);
  const interests = INTEREST_CHAPTER_ORDER.filter((id) => selected.has(id));

  // "What changed" runs for everyone, but where it goes depends on who you are.
  // A returning player needs it before anything else: it is the only reason
  // they opened the tutorial. A new player needs the fundamentals first, so it
  // lands at the end as a "here is what is new this time" closer rather than a
  // wall of context about a game they have not played yet.
  return plan.experience === "returning"
    ? ["whats-new", "core", ...interests]
    : ["core", ...interests, "whats-new"];
}

/** Whether a chapter belongs to this plan's tour. */
export function chapterVisibleForPlan(chapterId: TutorialChapterId, plan: TutorialPlan): boolean {
  return chapterIdsForPlan(plan).includes(chapterId);
}

/**
 * Whether a step runs for this experience level. Steps tagged `fundamental`
 * explain something a returning player already knows ("what is an action",
 * "what is a party"), so the returning tour drops them and keeps the
 * do-it-now steps.
 */
export function stepVisibleForExperience(
  step: { fundamental?: boolean },
  experience: TutorialExperience
): boolean {
  if (experience === "skip") return false;
  if (experience === "returning") return step.fundamental !== true;
  return true;
}
