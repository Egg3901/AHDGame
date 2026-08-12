import type { Db, ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  countryElectionsUrl,
  legislatureUrl,
  partiesUrl,
  regionUrl,
  stockmarketUrl,
  unionsUrl,
} from "@/lib/urls";
import {
  DEFAULT_TUTORIAL_PLAN,
  chapterIdsForPlan,
  resolveTutorialPlan,
  type TutorialChapterId,
  type TutorialPlan,
} from "@/lib/onboarding/tutorialPlan";

/**
 * Canonical new-player onboarding checklist.
 *
 * Single source of truth for the getting-started steps: the profile checklist
 * card, the /actions/suggestions getting-started recommendations, and the
 * completion reward all derive from these definitions so the surfaces can never
 * disagree about what a step is or whether it is done.
 *
 * Most steps derive from game state; two ("scout-state", "read-wire") are page
 * visits recorded server-side under `Character.onboarding.steps` via PATCH
 * /api/character/me (only these two ids are writable, timestamps are stamped
 * server-side).
 *
 * Each step declares the tutorial chapters it belongs to, and the checklist is
 * filtered to the chapters the player's plan actually runs (see
 * tutorialPlan.ts). A step can belong to more than one chapter: joining a party
 * matters whether you want a seat or the top job, and owning shares matters
 * whether you came to invest or to run a company.
 */

export const ONBOARDING_STEP_IDS = [
  "scout-state",
  "join-party",
  "first-vote",
  "invest",
  "campaign-action",
  "file-for-race",
  "found-company",
  "back-union",
  "read-wire",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

/** The only step ids a client may record via PATCH /api/character/me. */
export const TRACKED_ONBOARDING_STEP_IDS = ["scout-state", "read-wire"] as const;

export type TrackedOnboardingStepId = (typeof TRACKED_ONBOARDING_STEP_IDS)[number];

export function isTrackedOnboardingStepId(id: string): id is TrackedOnboardingStepId {
  return (TRACKED_ONBOARDING_STEP_IDS as readonly string[]).includes(id);
}

/** The character fields step content and derivation read. */
export type OnboardingCharacter = Pick<
  Character,
  | "_id"
  | "countryId"
  | "homeState"
  | "party"
  | "currentOffice"
  | "careerHistory"
  | "onboarding"
  | "tutorial"
  | "tutorialTrack"
>;

export interface OnboardingStepContent {
  id: OnboardingStepId;
  title: string;
  body: string;
  link: string;
  /**
   * Tutorial chapters this step belongs to. The step shows when the player's
   * plan runs any one of them.
   */
  chapters: TutorialChapterId[];
}

/** Lowercased per-country region noun ("state", "nation", "land", "region"). */
export function regionNoun(countryId: string): string {
  const label = COUNTRY_CONFIGS[countryId as CountryId]?.regionLabel ?? "State";
  return label.toLowerCase();
}

/**
 * Player-facing copy and deep links for every step, in display order.
 * Nouns follow the character's country config (state vs nation vs land).
 */
export function buildOnboardingStepContent(
  character: Pick<OnboardingCharacter, "countryId" | "homeState">
): OnboardingStepContent[] {
  const { countryId, homeState } = character;
  const region = regionNoun(countryId);
  return [
    {
      id: "scout-state",
      title: `Scout your home ${region}`,
      body: `Open your ${region} page and check its economy, sitting officials, and upcoming races. This is where your career starts.`,
      link: regionUrl(countryId, homeState),
      chapters: ["core"],
    },
    {
      id: "join-party",
      title: "Join a party",
      body: "Parties unlock the shared action pool and improve your primary scores. Pick the one that fits your platform, or the one weak enough to take over.",
      link: partiesUrl(countryId),
      chapters: ["office", "nation"],
    },
    {
      id: "first-vote",
      title: "Cast your first vote",
      body: "Bills change real numbers: taxes, wages, growth. Once you hold a seat, read one on the floor and vote.",
      link: legislatureUrl(countryId),
      chapters: ["office", "nation"],
    },
    {
      id: "invest",
      title: "Put your money to work",
      body: "Buy shares in a corporation or an index fund. The market moves every turn whether you play it or not.",
      link: stockmarketUrl(countryId),
      chapters: ["invest", "company"],
    },
    {
      id: "campaign-action",
      title: "Make yourself known",
      body: "Run a Campaign action to build Political Influence. Nobody votes for a stranger.",
      link: "/actions",
      chapters: ["office", "nation"],
    },
    {
      id: "file-for-race",
      title: "File for a race",
      body:
        countryId === COUNTRY_CONFIGS.US.id
          ? "State legislature is the classic first run. Low stakes, real power, and a record to campaign on later."
          : "A legislature seat is the classic first run. Low stakes, real power, and a record to campaign on later.",
      link: countryElectionsUrl(countryId),
      chapters: ["office", "nation"],
    },
    {
      id: "found-company",
      title: "Take charge of a company",
      body: "Found a corporation, or claim a CEO seat nobody is sitting in. A company that earns every turn pays for everything else you want to do.",
      link: stockmarketUrl(countryId),
      chapters: ["company"],
    },
    {
      id: "back-union",
      title: "Back a union",
      body: "Fund an organizing drive in your industry. It raises the union's membership pressure and earns you a vote in its leadership election.",
      link: unionsUrl(countryId),
      chapters: ["union"],
    },
    {
      id: "read-wire",
      title: "Check the news",
      body: "The News page reports what other players and the economy did last turn. The best players read it before every move.",
      link: "/news",
      chapters: ["core"],
    },
  ];
}

/** Signals the pure derivation needs; load them with loadOnboardingSignals. */
export interface OnboardingSignals {
  /** Has ever cast a vote on a national or state bill. */
  hasVoted: boolean;
  /** Has ever filed as a candidate in any election. */
  hasCandidacy: boolean;
  /** Holds corporate shares or an index-fund position. */
  hasInvested: boolean;
  /** Has ever run a Campaign or Run Advertisements action. */
  hasCampaignActed: boolean;
  /** Sits as the player CEO of a corporation (founded it or took the chair). */
  hasCompany: boolean;
  /** Leads a union, or has funded an organizing drive in one. */
  hasUnion: boolean;
}

export function isOnboardingStepComplete(
  id: OnboardingStepId,
  character: Pick<OnboardingCharacter, "party" | "currentOffice" | "careerHistory" | "onboarding">,
  signals: OnboardingSignals
): boolean {
  switch (id) {
    case "scout-state":
      return character.onboarding?.steps?.["scout-state"] !== undefined;
    case "join-party":
      return Boolean(character.party) && character.party !== "independent";
    case "first-vote":
      return signals.hasVoted;
    case "invest":
      return signals.hasInvested;
    case "campaign-action":
      return signals.hasCampaignActed;
    case "file-for-race":
      // Filed for a race, currently holds office, or has any office-related
      // career event (elected/appointed/resigned/removed/lost_election all
      // imply they entered the arena at some point).
      return (
        signals.hasCandidacy ||
        // != null: docs that never had the field (undefined) hold no office.
        character.currentOffice != null ||
        (character.careerHistory ?? []).some((event) => event.type !== "relocated")
      );
    case "found-company":
      return signals.hasCompany;
    case "back-union":
      return signals.hasUnion;
    case "read-wire":
      return character.onboarding?.steps?.["read-wire"] !== undefined;
  }
}

export interface OnboardingChecklistStep extends OnboardingStepContent {
  done: boolean;
}

export interface OnboardingChecklist {
  steps: OnboardingChecklistStep[];
  completedCount: number;
  total: number;
  allComplete: boolean;
}

/**
 * Chapters whose steps appear on the checklist.
 *
 * Not the same as the guided-tour chapter list. Two deliberate differences:
 *  - "core" is always present, even for a player who chose to skip the tour.
 *    Skipping the walkthrough is not the same as opting out of the checklist.
 *  - A plan with no interests (the skip path, where we were never told what the
 *    player wants) falls back to every chapter rather than to core alone. That
 *    keeps the completion reward from becoming two page visits.
 */
function checklistChapterIds(plan: TutorialPlan): TutorialChapterId[] {
  if (plan.interests.length === 0) {
    return chapterIdsForPlan({ experience: "new", interests: DEFAULT_TUTORIAL_PLAN.interests });
  }
  return ["core", ...plan.interests];
}

/**
 * Pure derivation: combine step content with completion signals, filtered to
 * the chapters the player's plan covers. `total` / `allComplete` (and therefore
 * the completion reward gate) count only the steps this player was actually
 * asked to do, so an invest-only player is never blocked on filing for a race.
 * Omitting `plan` yields the full checklist, which is what every pre-plan
 * character keeps.
 */
export function deriveOnboardingChecklist(
  character: OnboardingCharacter,
  signals: OnboardingSignals,
  plan: TutorialPlan = DEFAULT_TUTORIAL_PLAN
): OnboardingChecklist {
  const visible = new Set(checklistChapterIds(plan));
  const steps = buildOnboardingStepContent(character)
    .filter((content) => content.chapters.some((chapter) => visible.has(chapter)))
    .map((content) => ({
      ...content,
      done: isOnboardingStepComplete(content.id, character, signals),
    }));
  const completedCount = steps.filter((s) => s.done).length;
  return {
    steps,
    completedCount,
    total: steps.length,
    allComplete: steps.length > 0 && completedCount === steps.length,
  };
}

/**
 * Has this character ever voted on a bill?
 *
 * Bill votes are stored as embedded maps keyed by character id string:
 * `bills.votes` / `bills.otherChamberVotes` (national) and `stateBills.votes`
 * (state legislatures). The old recommendations derivation queried
 * `voteTallies.characterId`, but voteTallies holds election tallies with no
 * characterId field, so it was always false and the "vote on a bill"
 * suggestion never auto-completed.
 */
export async function hasVotedOnAnyBill(db: Db, characterId: ObjectId): Promise<boolean> {
  const key = characterId.toString();
  const [national, state] = await Promise.all([
    db.collection("bills").countDocuments(
      {
        $or: [
          { [`votes.${key}`]: { $exists: true } },
          { [`otherChamberVotes.${key}`]: { $exists: true } },
        ],
      },
      { limit: 1 }
    ),
    db
      .collection("stateBills")
      .countDocuments({ [`votes.${key}`]: { $exists: true } }, { limit: 1 }),
  ]);
  return national > 0 || state > 0;
}

/** Load all DB-derived completion signals for a character in parallel. */
export async function loadOnboardingSignals(
  db: Db,
  characterId: ObjectId
): Promise<OnboardingSignals> {
  const [
    hasVoted,
    hasCandidacy,
    ownsShares,
    ownsFundUnits,
    hasCampaignActed,
    isCeo,
    leadsUnion,
    organizedUnion,
  ] = await Promise.all([
    hasVotedOnAnyBill(db, characterId),
    db
      .collection("electionCandidates")
      .countDocuments({ characterId }, { limit: 1 })
      .then((n) => n > 0),
    db
      .collection("corporations")
      .countDocuments(
        { shareholders: { $elemMatch: { characterId, shares: { $gt: 0 } } } },
        { limit: 1 }
      )
      .then((n) => n > 0),
    db
      .collection("indexFundPositions")
      .countDocuments({ holderKind: "character", characterId, units: { $gt: 0 } }, { limit: 1 })
      .then((n) => n > 0),
    db
      .collection("actionLogs")
      .countDocuments({ characterId, actionType: { $in: ["campaign", "advertise"] } }, { limit: 1 })
      .then((n) => n > 0),
    // Player-run seat only. `ceoType` defaults to "character" when absent
    // (see Corporation type); founding historically omitted the field, so
    // treat missing the same as "character". Exclude imperial / NPP seats.
    // Same $or shape as allocate-stats' corpsOwned query.
    db
      .collection("corporations")
      .countDocuments(
        {
          ceoId: characterId,
          $or: [{ ceoType: "character" }, { ceoType: { $exists: false } }],
        },
        { limit: 1 }
      )
      .then((n) => n > 0),
    db
      .collection("unions")
      .countDocuments({ ownerId: characterId }, { limit: 1 })
      .then((n) => n > 0),
    db
      .collection("unionOrganizers")
      .countDocuments({ characterId }, { limit: 1 })
      .then((n) => n > 0),
  ]);

  return {
    hasVoted,
    hasCandidacy,
    hasInvested: ownsShares || ownsFundUnits,
    hasCampaignActed,
    hasCompany: isCeo,
    // Funding a drive is the step the tutorial actually asks for; leading one
    // implies it for anyone who organized before this shipped.
    hasUnion: leadsUnion || organizedUnion,
  };
}

/** Convenience: signals + derivation in one call (server components, claim route). */
export async function loadOnboardingChecklist(
  db: Db,
  character: OnboardingCharacter
): Promise<OnboardingChecklist> {
  const signals = await loadOnboardingSignals(db, character._id);
  return deriveOnboardingChecklist(character, signals, resolveTutorialPlan(character));
}

/** Dismissal absorbs the legacy boolean so pre-existing dismissals stay dismissed. */
export function isOnboardingDismissed(
  character: Pick<Character, "onboardingDismissed" | "onboarding">
): boolean {
  return character.onboardingDismissed === true || character.onboarding?.dismissedAt !== undefined;
}
