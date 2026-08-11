import { describe, expect, it } from "vitest";
import {
  TIER1_ECONOMIC_ACCOUNTING_CADENCE_TURNS,
  TIER1_NPP_DECISION_BUCKET_COUNT,
  TIER1_STRATEGIC_DECISION_KINDS,
  evaluateTier1NppDecisionSchedule,
  isTier1DecisionTurn,
  isTier1EconomicAccountingTurn,
  replayTier1DecisionClaims,
  tier1DecisionBucket,
  tier1DecisionCycle,
  tier1DecisionTurnForCycle,
} from "./tier1DecisionSchedule";

/** Proposed 1953 Tier-1 roster from epic #3712 (country codes in-repo). */
const TIER1_1953_ROSTER = [
  "US",
  "UK",
  "FR",
  "DE",
  "DD",
  "IT",
  "ES",
  "SE",
  "TR",
  "RU",
  "CN",
  "JP",
  "IN",
  "PK",
  "IR",
  "IQ",
  "EG",
  "SA",
  "SY",
  "ID",
  "KP",
  "KR",
  "BR",
] as const;

describe("tier1DecisionSchedule", () => {
  describe("cadence constants", () => {
    it("keeps economic accounting on every normal turn", () => {
      expect(TIER1_ECONOMIC_ACCOUNTING_CADENCE_TURNS).toBe(1);
      for (let turn = 1; turn <= 24; turn++) {
        expect(isTier1EconomicAccountingTurn(turn)).toBe(true);
      }
    });

    it("uses a six-hour (= six-turn) decision bucket period", () => {
      expect(TIER1_NPP_DECISION_BUCKET_COUNT).toBe(6);
      expect(TIER1_STRATEGIC_DECISION_KINDS).toEqual([
        "policy",
        "appointment",
        "sector-order",
        "diplomacy",
        "sphere",
      ]);
    });
  });

  describe("bucket assignment", () => {
    it("is deterministic for the same country id", () => {
      for (const id of TIER1_1953_ROSTER) {
        expect(tier1DecisionBucket(id)).toBe(tier1DecisionBucket(id));
      }
    });

    it("distributes countries across buckets without a synchronized spike", () => {
      const counts = Array.from({ length: TIER1_NPP_DECISION_BUCKET_COUNT }, () => 0);
      for (const id of TIER1_1953_ROSTER) {
        const bucket = tier1DecisionBucket(id);
        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(TIER1_NPP_DECISION_BUCKET_COUNT);
        counts[bucket]!++;
      }
      // Every bucket gets at least one country; no bucket holds the whole roster.
      expect(counts.every((c) => c >= 1)).toBe(true);
      expect(Math.max(...counts)).toBeLessThan(TIER1_1953_ROSTER.length);
      // No single hour processes more than half the Tier-1 slate.
      expect(Math.max(...counts)).toBeLessThanOrEqual(Math.ceil(TIER1_1953_ROSTER.length / 2));
    });

    it("schedules each country exactly once per six-turn cycle", () => {
      const id = "JP";
      const bucket = tier1DecisionBucket(id);
      const due: number[] = [];
      for (let turn = 1; turn <= 12; turn++) {
        if (isTier1DecisionTurn(id, turn)) due.push(turn);
      }
      expect(due).toEqual([bucket + 1, bucket + 1 + 6]);
    });
  });

  describe("evaluateTier1NppDecisionSchedule", () => {
    it("runs policy/appointment cadence only on the country's due turn", () => {
      const countryId = "DE";
      const dueTurn = tier1DecisionTurnForCycle(countryId, 3);
      expect(
        evaluateTier1NppDecisionSchedule({
          countryId,
          turn: dueTurn,
          lastCompletedCycle: null,
          playerControlled: false,
        })
      ).toMatchObject({ run: true, cycle: 3, completedCycle: 3 });

      expect(
        evaluateTier1NppDecisionSchedule({
          countryId,
          turn: dueTurn + 1,
          lastCompletedCycle: null,
          playerControlled: false,
        }).reason
      ).toBe("not-due");
    });

    it("skips when the decision surface is player-controlled", () => {
      const countryId = "UK";
      const dueTurn = tier1DecisionTurnForCycle(countryId, 0);
      const verdict = evaluateTier1NppDecisionSchedule({
        countryId,
        turn: dueTurn,
        lastCompletedCycle: null,
        playerControlled: true,
      });
      expect(verdict).toEqual({
        run: false,
        bucket: tier1DecisionBucket(countryId),
        cycle: 0,
        reason: "player-controlled",
      });
    });

    it("refuses to re-fire a cycle that was already completed", () => {
      const countryId = "CN";
      const dueTurn = tier1DecisionTurnForCycle(countryId, 2);
      const verdict = evaluateTier1NppDecisionSchedule({
        countryId,
        turn: dueTurn,
        lastCompletedCycle: 2,
        playerControlled: false,
      });
      expect(verdict.reason).toBe("already-completed");
      expect(verdict.run).toBe(false);
    });
  });

  describe("missed / restarted worker recovery", () => {
    it("recovers after a missed bucket window without double-firing", () => {
      const countryId = "RU";
      const bucket = tier1DecisionBucket(countryId);
      // Due turns for cycles 0..3
      const due0 = tier1DecisionTurnForCycle(countryId, 0);
      const due1 = tier1DecisionTurnForCycle(countryId, 1);
      const due2 = tier1DecisionTurnForCycle(countryId, 2);
      const due3 = tier1DecisionTurnForCycle(countryId, 3);

      // Worker processes cycle 0, then is down for the entire cycle-1 window,
      // then resumes on cycle 2's due turn.
      const { claimedCycles, finalLastCompletedCycle } = replayTier1DecisionClaims({
        countryId,
        processedTurns: [
          due0,
          // downtime across cycle 1's due turn (and surrounding hours)
          due1 - 1,
          due1 + 1,
          due2,
          due2, // restart mid-turn: second attempt must not claim again
          due3,
        ],
      });

      expect(claimedCycles).toEqual([0, 2, 3]);
      expect(claimedCycles).not.toContain(1); // missed window stayed missed
      expect(finalLastCompletedCycle).toBe(3);
      expect(bucket).toBe((due0 - 1) % TIER1_NPP_DECISION_BUCKET_COUNT);
    });

    it("matches an uninterrupted worker's claims for overlapping processed turns", () => {
      const countryId = "IT";
      const turns = Array.from({ length: 24 }, (_, i) => i + 1);

      const full = replayTier1DecisionClaims({ countryId, processedTurns: turns });
      // Worker restarts after turn 10 with the watermark persisted.
      const resume = replayTier1DecisionClaims({
        countryId,
        processedTurns: turns.slice(10),
        initialLastCompletedCycle:
          full.claimedCycles
            .filter((c) => {
              const due = tier1DecisionTurnForCycle(countryId, c);
              return due <= 10;
            })
            .at(-1) ?? null,
      });

      const expectedFromResume = full.claimedCycles.filter((c) => {
        const due = tier1DecisionTurnForCycle(countryId, c);
        return due > 10;
      });
      expect(resume.claimedCycles).toEqual(expectedFromResume);
      expect(resume.finalLastCompletedCycle).toBe(full.finalLastCompletedCycle);
    });

    it("is equivalent whether the due turn is processed once or retried immediately", () => {
      const countryId = "FR";
      const due = tier1DecisionTurnForCycle(countryId, 5);
      const once = replayTier1DecisionClaims({ countryId, processedTurns: [due] });
      const twice = replayTier1DecisionClaims({ countryId, processedTurns: [due, due, due] });
      expect(once.claimedCycles).toEqual([5]);
      expect(twice.claimedCycles).toEqual([5]);
      expect(twice.finalLastCompletedCycle).toBe(once.finalLastCompletedCycle);
    });
  });

  describe("cycle math", () => {
    it("maps turns 1–6 to cycle 0 and 7–12 to cycle 1", () => {
      expect(tier1DecisionCycle(1)).toBe(0);
      expect(tier1DecisionCycle(6)).toBe(0);
      expect(tier1DecisionCycle(7)).toBe(1);
      expect(tier1DecisionCycle(12)).toBe(1);
    });
  });
});
