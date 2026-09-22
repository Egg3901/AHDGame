import { describe, expect, it } from "vitest";
import {
  buildNoConfidenceBallotPlan,
  buildNoConfidenceLifecycleReport,
  checkMotionRetention,
  checkTerminalResolution,
  expectedNoConfidenceOutcome,
  NO_CONFIDENCE_FIXED_TOTALS,
  NO_CONFIDENCE_LIFECYCLE_MECHANIC_ID,
  noConfidenceClosesOnTurn,
  noConfidenceCooldownRemaining,
  type NoConfidenceSnapshot,
} from "./noConfidenceLifecycle";
import { syntheticObjectIdHex } from "./actorCoverage";
import { probeNoConfidenceMotion } from "./actorProbes";

const SEED = "vonc-probe-seed";

function inFlightSnapshot(turn: number, voteId: string): NoConfidenceSnapshot {
  return {
    turn,
    voteId,
    status: "active",
    votesFor: 3,
    votesAgainst: 2,
    closesOnTurn: 124,
    activeVoteId: voteId,
  };
}

describe("buildNoConfidenceBallotPlan", () => {
  it("fixes the 3-2 ballot with the proposer voting aye", () => {
    const plan = buildNoConfidenceBallotPlan(SEED);
    expect(plan.countryId).toBe("UK");
    expect(plan.voters).toHaveLength(5);
    expect(plan.voters.map((v) => v.choice)).toEqual(["aye", "aye", "aye", "nay", "nay"]);
    expect(plan.proposer.characterIdHex).toBe(plan.voters[0].characterIdHex);
    expect(plan.expectedVotesFor).toBe(NO_CONFIDENCE_FIXED_TOTALS.votesFor);
    expect(plan.expectedVotesAgainst).toBe(NO_CONFIDENCE_FIXED_TOTALS.votesAgainst);
  });

  it("is byte-stable per seed with distinct valid identities", () => {
    const a = buildNoConfidenceBallotPlan(SEED);
    expect(buildNoConfidenceBallotPlan(SEED)).toEqual(a);
    const ids = a.voters.map((v) => v.characterIdHex);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{24}$/);
  });

  it("never collides with the synthetic-actor plan namespaces", () => {
    const plan = buildNoConfidenceBallotPlan(SEED);
    const planIds = new Set(plan.voters.map((v) => v.characterIdHex));
    for (const role of ["character:us-president", "user:us-president", "ticker:us-president"]) {
      expect(planIds.has(syntheticObjectIdHex(SEED, `actor:${role}`))).toBe(false);
    }
    expect(planIds.has(syntheticObjectIdHex(SEED, "corp:private"))).toBe(false);
  });
});

describe("expectedNoConfidenceOutcome", () => {
  it("fails the fixed ballot at a Commons majority threshold via the real carry rule", () => {
    const plan = buildNoConfidenceBallotPlan(SEED);
    expect(expectedNoConfidenceOutcome(plan, 6, 10)).toBe("failed");
    expect(expectedNoConfidenceOutcome(plan, 326, 650)).toBe("failed");
  });

  it("passes only when the threshold drops to the ballot total", () => {
    const plan = buildNoConfidenceBallotPlan(SEED);
    expect(expectedNoConfidenceOutcome(plan, 3, 5)).toBe("passed");
  });
});

describe("turn and cooldown math", () => {
  it("closes 24 turns after proposal (production duration constant)", () => {
    expect(noConfidenceClosesOnTurn(100)).toBe(124);
  });

  it("holds the 48-turn cooldown from the proposing turn", () => {
    expect(noConfidenceCooldownRemaining(124, 100)).toBe(24);
    expect(noConfidenceCooldownRemaining(148, 100)).toBe(0);
    expect(noConfidenceCooldownRemaining(200, 100)).toBe(0);
  });
});

describe("checkMotionRetention", () => {
  it("passes when every in-flight turn keeps the identity and linkage", () => {
    const check = checkMotionRetention(
      "abc",
      124,
      [100, 110, 123].map((t) => inFlightSnapshot(t, "abc"))
    );
    expect(check.ok).toBe(true);
  });

  it("fails on replacement, early close, dropped linkage, or no snapshots", () => {
    expect(checkMotionRetention("abc", 124, []).ok).toBe(false);
    const replaced = [inFlightSnapshot(100, "abc"), inFlightSnapshot(101, "xyz")];
    expect(checkMotionRetention("abc", 124, replaced).ok).toBe(false);
    const earlyClose = [{ ...inFlightSnapshot(101, "abc"), status: "failed" }];
    expect(checkMotionRetention("abc", 124, earlyClose).ok).toBe(false);
    const droppedLink = [{ ...inFlightSnapshot(101, "abc"), activeVoteId: null }];
    expect(checkMotionRetention("abc", 124, droppedLink).ok).toBe(false);
  });

  it("ignores post-deadline snapshots", () => {
    const snaps = [
      inFlightSnapshot(100, "abc"),
      { ...inFlightSnapshot(124, "abc"), status: "failed", activeVoteId: null },
    ];
    expect(checkMotionRetention("abc", 124, snaps).ok).toBe(true);
  });
});

describe("checkTerminalResolution", () => {
  function terminal(overrides: Record<string, unknown> = {}) {
    return {
      voteId: "abc",
      expectedOutcome: "failed" as const,
      expectedVotesFor: 3,
      expectedVotesAgainst: 2,
      statusBeforeResolve: "active",
      statusAfterResolve: "failed",
      statusAfterExtraTurn: "failed",
      closedAt: "2026-01-05T00:00:00.000Z",
      votesFor: 3,
      votesAgainst: 2,
      repeatPassNoop: true,
      ...overrides,
    };
  }

  it("passes on exactly one active-to-failed transition with ballot totals", () => {
    expect(checkTerminalResolution(terminal()).ok).toBe(true);
  });

  it("fails on wrong outcome, drifting totals, missing stamp, or repeat side effects", () => {
    expect(checkTerminalResolution(terminal({ statusAfterResolve: "passed" })).ok).toBe(false);
    expect(checkTerminalResolution(terminal({ votesFor: 4 })).ok).toBe(false);
    expect(checkTerminalResolution(terminal({ closedAt: null })).ok).toBe(false);
    expect(checkTerminalResolution(terminal({ repeatPassNoop: false })).ok).toBe(false);
    expect(checkTerminalResolution(terminal({ statusAfterExtraTurn: "passed" })).ok).toBe(false);
    expect(checkTerminalResolution(terminal({ statusBeforeResolve: "failed" })).ok).toBe(false);
  });
});

describe("probeNoConfidenceMotion", () => {
  it("is uncovered in pure NPP mode", () => {
    const result = probeNoConfidenceMotion("pure-npp", SEED, 6, 100);
    expect(result.mechanicId).toBe(NO_CONFIDENCE_LIFECYCLE_MECHANIC_ID);
    expect(result.expectedOutcome).toBeNull();
    expect(result.closesOnTurn).toBeNull();
  });

  it("pins the fixed ballot, failed outcome, and deadline in synthetic mode", () => {
    const result = probeNoConfidenceMotion("synthetic", SEED, 6, 100);
    expect(result.expectedVotesFor).toBe(3);
    expect(result.expectedVotesAgainst).toBe(2);
    expect(result.expectedOutcome).toBe("failed");
    expect(result.closesOnTurn).toBe(124);
    expect(result.proposerCharacterIdHex).toBe(
      buildNoConfidenceBallotPlan(SEED).proposer.characterIdHex
    );
  });
});

describe("buildNoConfidenceLifecycleReport", () => {
  it("keeps proposal, retention, and terminal evidence in distinct sections", () => {
    const report = buildNoConfidenceLifecycleReport({
      voteId: "abc",
      seed: SEED,
      turnProposed: 100,
      closesOnTurn: 124,
      proposerCharacterIdHex: "proposer-hex",
      targetPmName: "Test PM",
      retention: { ok: true, reason: "retained" },
      terminal: { ok: true, reason: "resolved" },
      government: {
        pmCharacterId: "pm-hex",
        pmName: "Test PM",
        formationStatus: "formed",
        activeVoteId: null,
        cabinetMembers: 4,
        cooldownRemainingTurns: 24,
      },
      runUuid: "run-1",
      sourceCommit: "deadbee",
    });
    expect(report.mechanicId).toBe(NO_CONFIDENCE_LIFECYCLE_MECHANIC_ID);
    expect(report.preset).toBe("1979-default");
    expect(report.proposalLines.join("\n")).toContain("abc");
    expect(report.retentionLines.join("\n")).toContain("RETAINED");
    expect(report.terminalLines.join("\n")).toContain("RESOLVED");
    const sectionOrder = report.lines.join("\n");
    expect(sectionOrder.indexOf("(proposal)")).toBeLessThan(
      sectionOrder.indexOf("(in-flight retention)")
    );
    expect(sectionOrder.indexOf("(in-flight retention)")).toBeLessThan(
      sectionOrder.indexOf("(terminal outcome)")
    );
    expect(sectionOrder).toContain("cabinetMembers=4");
  });
});
