import { describe, it, expect } from "vitest";
import { computeRecoveryTransition } from "../computeTransition";
import { RECOVERY_FLOOR_TURNS, RECOVERY_DISCIPLINE_REQUIRED_STREAK } from "../../constants";

const baseInput = {
  currentState: "recovering" as const,
  recoveryStartedAtTurn: 100,
  fiscalDisciplineStreak: 0,
  inGoodStanding: false,
  currentTurn: 110,
  recoveryGdpPenaltyTurnsRemaining: 3 as number | null,
};

describe("computeRecoveryTransition — guard cases", () => {
  it("returns no-op when state is not recovering", () => {
    const r = computeRecoveryTransition({ ...baseInput, currentState: "normal" });
    expect(r.set).toEqual({});
    expect(r.exitedRecovery).toBe(false);
  });

  it("returns no-op when recoveryStartedAtTurn is null (defensive)", () => {
    const r = computeRecoveryTransition({ ...baseInput, recoveryStartedAtTurn: null });
    expect(r.set).toEqual({});
    expect(r.exitedRecovery).toBe(false);
  });
});

describe("computeRecoveryTransition — streak tracking", () => {
  it("inGoodStanding=true increments streak", () => {
    const r = computeRecoveryTransition({
      ...baseInput,
      fiscalDisciplineStreak: 2,
      inGoodStanding: true,
    });
    expect(r.set.recoveryFiscalDisciplineStreak).toBe(3);
    expect(r.exitedRecovery).toBe(false);
  });

  it("inGoodStanding=false resets streak to 0", () => {
    const r = computeRecoveryTransition({
      ...baseInput,
      fiscalDisciplineStreak: 4,
      inGoodStanding: false,
    });
    expect(r.set.recoveryFiscalDisciplineStreak).toBe(0);
  });
});

describe("computeRecoveryTransition — GDP penalty turn decrement", () => {
  it("decrements recoveryGdpPenaltyTurnsRemaining when > 0", () => {
    const r = computeRecoveryTransition({
      ...baseInput,
      recoveryGdpPenaltyTurnsRemaining: 3,
    });
    expect(r.set.recoveryGdpPenaltyTurnsRemaining).toBe(2);
  });

  it("clears penalty fields when counter hits zero", () => {
    const r = computeRecoveryTransition({
      ...baseInput,
      recoveryGdpPenaltyTurnsRemaining: 1,
    });
    expect(r.set.recoveryGdpPenaltyTurnsRemaining).toBe(0);
    expect(r.set.recoveryGdpPenaltyPercent).toBe(null);
  });

  it("does not modify penalty fields when already null/zero", () => {
    const r = computeRecoveryTransition({
      ...baseInput,
      recoveryGdpPenaltyTurnsRemaining: 0,
    });
    expect(r.set.recoveryGdpPenaltyTurnsRemaining).toBeUndefined();
  });

  it("does not touch penalty when null (e.g. monetize crisis)", () => {
    const r = computeRecoveryTransition({
      ...baseInput,
      recoveryGdpPenaltyTurnsRemaining: null,
    });
    expect(r.set.recoveryGdpPenaltyTurnsRemaining).toBeUndefined();
  });
});

describe("computeRecoveryTransition — exit conditions", () => {
  it("does not exit before 48-turn floor", () => {
    const r = computeRecoveryTransition({
      ...baseInput,
      recoveryStartedAtTurn: 100,
      currentTurn: 100 + RECOVERY_FLOOR_TURNS - 1,
      fiscalDisciplineStreak: RECOVERY_DISCIPLINE_REQUIRED_STREAK,
      inGoodStanding: true,
    });
    expect(r.exitedRecovery).toBe(false);
    expect(r.set.sovereignCrisisState).toBeUndefined();
  });

  it("does not exit before 5-turn streak", () => {
    const r = computeRecoveryTransition({
      ...baseInput,
      recoveryStartedAtTurn: 100,
      currentTurn: 200,
      fiscalDisciplineStreak: 3,
      inGoodStanding: true,
    });
    expect(r.exitedRecovery).toBe(false);
  });

  it("exits when both conditions met", () => {
    const r = computeRecoveryTransition({
      ...baseInput,
      recoveryStartedAtTurn: 100,
      currentTurn: 100 + RECOVERY_FLOOR_TURNS,
      fiscalDisciplineStreak: RECOVERY_DISCIPLINE_REQUIRED_STREAK - 1,
      inGoodStanding: true,
      recoveryGdpPenaltyTurnsRemaining: 0,
    });
    expect(r.exitedRecovery).toBe(true);
    expect(r.set.sovereignCrisisState).toBe("normal");
    expect(r.set.recoveryStartedAt).toBe(null);
    expect(r.set.marketAccessLockedUntilTurn).toBe(null);
    expect(r.set.failedAuctionConsecutiveCount).toBe(0);
    expect(r.set.creditRating).toBe("BBB");
  });

  it("preserves lastDefaultTurn on exit (margin window extends to turn 72)", () => {
    const r = computeRecoveryTransition({
      ...baseInput,
      recoveryStartedAtTurn: 100,
      currentTurn: 100 + RECOVERY_FLOOR_TURNS,
      fiscalDisciplineStreak: RECOVERY_DISCIPLINE_REQUIRED_STREAK - 1,
      inGoodStanding: true,
      recoveryGdpPenaltyTurnsRemaining: 0,
    });
    expect(r.set.lastDefaultTurn).toBeUndefined();
  });

  it("phase 11a: stamps recoveryCredibilityBonusUntilTurn on clean exit", () => {
    const exitTurn = 100 + RECOVERY_FLOOR_TURNS;
    const r = computeRecoveryTransition({
      ...baseInput,
      recoveryStartedAtTurn: 100,
      currentTurn: exitTurn,
      fiscalDisciplineStreak: RECOVERY_DISCIPLINE_REQUIRED_STREAK - 1,
      inGoodStanding: true,
      recoveryGdpPenaltyTurnsRemaining: 0,
    });
    expect(r.exitedRecovery).toBe(true);
    // 100 turns past exit
    expect(r.set.recoveryCredibilityBonusUntilTurn).toBe(exitTurn + 100);
  });
});
