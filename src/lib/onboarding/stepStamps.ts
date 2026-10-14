import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import { accountAgeBand, captureIntakeEvent } from "@/lib/analytics/intakeEvents";
import {
  ONBOARDING_STEP_IDS,
  isOnboardingStepComplete,
  isTrackedOnboardingStepId,
  loadOnboardingSignals,
  type OnboardingCharacter,
  type OnboardingSignals,
  type OnboardingStepId,
} from "./checklist";

/**
 * Persist when each onboarding step was first completed.
 *
 * Seven of the nine steps are derived from game state on every page load and
 * were never stored, so nothing showed where new players stall. This stamps
 * `onboarding.steps.<id>` the first time a step is seen done (first write
 * wins), for every step whether or not the player kept the checklist card.
 *
 * Timestamps are first-observed times, except campaign-action, which uses the
 * player's earliest Campaign from `actionLogs` because that is the step the
 * intake metrics are measured on.
 */

/** Characters older than this stop being tracked: onboarding is over. */
export const ONBOARDING_TRACKING_WINDOW_DAYS = 30;

/** Turn the founding elections end; later characters joined a running world. */
export const FOUNDING_WINDOW_TURNS = 48;

export type StampableCharacter = OnboardingCharacter & Pick<Character, "createdAt" | "createdTurn">;

export function isWithinOnboardingWindow(
  character: Pick<Character, "createdAt">,
  now: number = Date.now()
): boolean {
  const created = character.createdAt instanceof Date ? character.createdAt.getTime() : NaN;
  return Number.isFinite(created) && now - created <= ONBOARDING_TRACKING_WINDOW_DAYS * 86_400_000;
}

/** "founding" for characters who joined during the founding races, else "mid_world". */
export function joinedBand(createdTurn: number | undefined): "founding" | "mid_world" | "unknown" {
  if (typeof createdTurn !== "number" || !Number.isFinite(createdTurn)) return "unknown";
  return createdTurn <= FOUNDING_WINDOW_TURNS ? "founding" : "mid_world";
}

/** Steps that are done now but have no stamp yet. Page-visit steps stamp themselves. */
export function newlyCompletedSteps(
  character: Pick<OnboardingCharacter, "party" | "currentOffice" | "careerHistory" | "onboarding">,
  signals: OnboardingSignals
): OnboardingStepId[] {
  const stamped = character.onboarding?.steps ?? {};
  return ONBOARDING_STEP_IDS.filter(
    (id) =>
      !isTrackedOnboardingStepId(id) &&
      stamped[id] === undefined &&
      isOnboardingStepComplete(id, character, signals)
  );
}

async function firstCampaignAt(db: Db, character: StampableCharacter): Promise<Date | null> {
  const first = await db
    .collection<{ createdAt?: Date }>("actionLogs")
    .find({ characterId: character._id, actionType: "campaign" }, { projection: { createdAt: 1 } })
    .sort({ createdAt: 1 })
    .limit(1)
    .next();
  return first?.createdAt instanceof Date ? first.createdAt : null;
}

/**
 * Stamp every newly completed step for a character still in its onboarding
 * window. Never throws: progress tracking must not break the page calling it.
 * Returns the steps stamped by this call.
 */
export async function recordOnboardingProgress(
  db: Db,
  character: StampableCharacter,
  options: { signals?: OnboardingSignals; now?: Date } = {}
): Promise<OnboardingStepId[]> {
  const now = options.now ?? new Date();
  try {
    if (!isWithinOnboardingWindow(character, now.getTime())) return [];
    const signals = options.signals ?? (await loadOnboardingSignals(db, character._id));
    const pending = newlyCompletedSteps(character, signals);
    const stamped: OnboardingStepId[] = [];
    for (const step of pending) {
      const at = step === "campaign-action" ? ((await firstCampaignAt(db, character)) ?? now) : now;
      const field = `onboarding.steps.${step}`;
      const result = await db
        .collection<Character>("characters")
        .updateOne({ _id: character._id, [field]: { $exists: false } }, { $set: { [field]: at } });
      if (result.modifiedCount !== 1) continue;
      stamped.push(step);
      await captureIntakeEvent("onboarding_step_done", {
        step: step.replace(/-/g, "_"),
        joined: joinedBand(character.createdTurn),
        character_age_band: accountAgeBand(character.createdAt, at.getTime()),
      });
    }
    return stamped;
  } catch {
    return [];
  }
}
