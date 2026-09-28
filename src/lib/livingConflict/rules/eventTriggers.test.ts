import { describe, expect, it } from "vitest";
import { emptyConflictState, openConflict, selectEvents } from "../engine";
import { allLivingConflictDefs } from "../registry";
import type { ConflictEvent } from "../types";
import { triggerMatches } from "./eventTriggers";

const event: ConflictEvent = {
  key: "consultation",
  kind: "authored",
  severity: "major",
  affects: "all",
  headline: "Consultation",
  body: "Decision window",
  trigger: { onPhaseEnter: true, everyTurns: 24 },
};
const opened = openConflict(emptyConflictState("test"), 1991);

describe("crisis event timing", () => {
  it.each([
    { phaseTurns: 0, totalTurns: 0, expected: true },
    { phaseTurns: 1, totalTurns: 1, expected: false },
    { phaseTurns: 24, totalTurns: 24, expected: true },
    { phaseTurns: 0, totalTurns: 13, expected: true },
    { phaseTurns: 0, totalTurns: 24, expected: true },
    { phaseTurns: 25, totalTurns: 25, expected: false },
  ])("resolves phase turn $phaseTurns and total turn $totalTurns", ({ expected, ...turns }) => {
    expect(triggerMatches(event, { ...opened, ...turns })).toBe(expected);
  });

  it("keeps stage and intensity restrictions on both timing paths", () => {
    for (const phaseTurns of [0, 24]) {
      const state = { ...opened, phaseTurns, totalTurns: 24, intensity: 50 };
      expect(
        triggerMatches({ ...event, trigger: { ...event.trigger, minIntensity: 60 } }, state)
      ).toBe(false);
      expect(
        triggerMatches({ ...event, trigger: { ...event.trigger, maxIntensity: 40 } }, state)
      ).toBe(false);
      expect(
        triggerMatches(
          { ...event, trigger: { ...event.trigger, campaignStages: ["aftermath"] } },
          state
        )
      ).toBe(false);
    }
  });

  it("preserves entry-only and cadence-only behavior", () => {
    expect(
      triggerMatches(
        { ...event, trigger: { onPhaseEnter: true } },
        { ...opened, phaseTurns: 24, totalTurns: 24 }
      )
    ).toBe(false);
    expect(triggerMatches({ ...event, trigger: { everyTurns: 24 } }, opened)).toBe(false);
    expect(
      triggerMatches(
        { ...event, trigger: { everyTurns: 24 } },
        { ...opened, phaseTurns: 24, totalTurns: 24 }
      )
    ).toBe(true);
  });

  it("opens and repeats every authored combined-trigger beat exactly once", () => {
    let checked = 0;
    for (const def of allLivingConflictDefs()) {
      for (const phase of def.phases) {
        for (const beat of phase.events) {
          if (!beat.trigger?.onPhaseEnter || !beat.trigger.everyTurns) continue;
          checked++;
          const state = { ...opened, defKey: def.key, phaseLevel: phase.level };
          for (const timing of [
            { phaseTurns: 0, totalTurns: 0 },
            { phaseTurns: beat.trigger.everyTurns, totalTurns: beat.trigger.everyTurns },
            { phaseTurns: 0, totalTurns: beat.trigger.everyTurns },
          ]) {
            expect(
              selectEvents(def, { ...state, ...timing }, 50).filter(
                (fired) => fired.event.key === beat.key
              ),
              `${def.key}/${phase.key}/${beat.key}`
            ).toHaveLength(1);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
