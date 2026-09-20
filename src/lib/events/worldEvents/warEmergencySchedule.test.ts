import { describe, expect, it } from "vitest";
import { MIN_CRISIS_DURATION_TURNS } from "@/lib/crises/crisisDuration";
import { WORLD_EVENT_SEED_DEFINITIONS } from "./definitions";
import { windowGapTurns } from "./scheduler";

const CIVIL_DEFENSE_KIND = "worldEvents.civilDefenseFever";
const CIVIL_DEFENSE_RECOVERY_GAP_TURNS = 12;

describe("high-tension crisis schedules", () => {
  it("leaves a recovery gap after Civil Defense Fever expires", () => {
    const definition = WORLD_EVENT_SEED_DEFINITIONS.find(
      (candidate) => candidate.kind === CIVIL_DEFENSE_KIND
    );
    const schedule = definition?.schedule;

    expect(schedule?.kind).toBe("window");
    if (!schedule || schedule.kind !== "window") return;

    for (const lastFiredTurn of [463, 489, 515, 541, 567, 593, 619, 645, 671, 697]) {
      expect(
        windowGapTurns("US", CIVIL_DEFENSE_KIND, lastFiredTurn, schedule)
      ).toBeGreaterThanOrEqual(MIN_CRISIS_DURATION_TURNS + CIVIL_DEFENSE_RECOVERY_GAP_TURNS);
    }
  });
});
