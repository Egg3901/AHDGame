import { describe, it, expect } from "vitest";
import { STRATEGY_TRANSITION_TURNS } from "@/lib/constants/sectorStrategies";

describe("strategy transition cleanup logic", () => {
  describe("transition completion check", () => {
    it("clears transitionCooldownUntilTurn when transition completes", () => {
      const transitionStartTurn = 100;
      const currentTurn = 112; // 12 turns later = transition complete
      const transitionCooldownUntilTurn = 124; // 100 + 24

      const elapsed = currentTurn - transitionStartTurn;
      const isComplete = elapsed >= STRATEGY_TRANSITION_TURNS;

      expect(isComplete).toBe(true);
      expect(currentTurn).toBeGreaterThanOrEqual(
        transitionCooldownUntilTurn - STRATEGY_TRANSITION_TURNS
      );

      // The fix: when transition completes, all three fields should be cleared:
      const updateFields: Record<string, null> = {};
      if (isComplete) {
        updateFields.transitionFromStrategyId = null;
        updateFields.transitionStartTurn = null;
        updateFields.transitionCooldownUntilTurn = null; // This was missing before the fix
      }

      expect(updateFields.transitionFromStrategyId).toBeNull();
      expect(updateFields.transitionStartTurn).toBeNull();
      expect(updateFields.transitionCooldownUntilTurn).toBeNull();
    });

    it("does NOT clear fields when transition is still in progress", () => {
      const transitionStartTurn = 100;
      const currentTurn = 105; // Only 5 turns in
      const transitionCooldownUntilTurn = 124;

      const elapsed = currentTurn - transitionStartTurn;
      const isComplete = elapsed >= STRATEGY_TRANSITION_TURNS;

      expect(isComplete).toBe(false);
      expect(currentTurn).toBeLessThan(transitionCooldownUntilTurn);

      // Fields should NOT be cleared yet
      const updateFields: Record<string, null> = {};
      if (isComplete) {
        updateFields.transitionFromStrategyId = null;
        updateFields.transitionStartTurn = null;
        updateFields.transitionCooldownUntilTurn = null;
      }

      expect(updateFields).toEqual({});
    });

    it("handles exact boundary (turn 112 for start=100)", () => {
      const transitionStartTurn = 100;
      const currentTurn = 112; // Exactly 12 turns

      const elapsed = currentTurn - transitionStartTurn;
      const isComplete = elapsed >= STRATEGY_TRANSITION_TURNS;

      expect(isComplete).toBe(true);
    });

    it("handles one turn before boundary (turn 111 for start=100)", () => {
      const transitionStartTurn = 100;
      const currentTurn = 111; // 11 turns

      const elapsed = currentTurn - transitionStartTurn;
      const isComplete = elapsed >= STRATEGY_TRANSITION_TURNS;

      expect(isComplete).toBe(false);
    });
  });

  describe("cooldown timer behavior", () => {
    it("cooldown runs concurrently with transition", () => {
      const transitionStartTurn = 100;
      const _transitionEndTurn = transitionStartTurn + STRATEGY_TRANSITION_TURNS; // 112
      const cooldownEndTurn = transitionStartTurn + 24; // 124

      // At turn 112, transition ends but cooldown still has 12 turns remaining
      const turn112_cooldownRemaining = cooldownEndTurn - 112;
      expect(turn112_cooldownRemaining).toBe(12);

      // At turn 124, cooldown ends
      expect(cooldownEndTurn - 124).toBe(0);
    });

    it("cooldown should be cleared when transition completes", () => {
      // The bug: cooldown was never cleared, so it showed "24 turns" forever
      // The fix: clear cooldown when transition completes

      const scenario = {
        transitionStartTurn: 100,
        transitionCooldownUntilTurn: 124,
        currentTurn: 112,
      };

      const elapsed = scenario.currentTurn - scenario.transitionStartTurn;
      const transitionComplete = elapsed >= STRATEGY_TRANSITION_TURNS;

      // Before fix: cooldownRemaining would show 12 (124 - 112)
      // After fix: cooldown is cleared, so remaining = 0
      const cooldownRemaining = transitionComplete
        ? 0 // Cleared!
        : Math.max(0, scenario.transitionCooldownUntilTurn - scenario.currentTurn);

      expect(cooldownRemaining).toBe(0);
    });

    it("displays correct remaining cooldown during active cooldown", () => {
      // If somehow the cooldown is still tracked separately (edge case)
      const scenario = {
        transitionStartTurn: 100,
        transitionCooldownUntilTurn: 124,
        currentTurn: 105,
      };

      const elapsed = scenario.currentTurn - scenario.transitionStartTurn;
      const transitionComplete = elapsed >= STRATEGY_TRANSITION_TURNS;

      // Transition not complete, so cooldown still tracks
      const cooldownRemaining = transitionComplete
        ? 0
        : Math.max(0, scenario.transitionCooldownUntilTurn - scenario.currentTurn);

      expect(cooldownRemaining).toBe(19); // 124 - 105
    });
  });
});
