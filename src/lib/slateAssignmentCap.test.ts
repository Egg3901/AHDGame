import { describe, expect, it } from "vitest";
import {
  SLATE_ASSIGNMENT_CAP,
  countSlateAssignmentUsage,
  type SlateUsageCandidacy,
  type SlateUsageRow,
} from "./slateAssignmentCap";

function row(candidateId: string, status: SlateUsageRow["status"]): SlateUsageRow {
  return { candidateId, status };
}

function candidacy(
  characterId: string,
  isNPP: boolean,
  status: SlateUsageCandidacy["status"] = "active"
): SlateUsageCandidacy {
  return { characterId, isNPP, status };
}

function legacyNppCandidacy(characterId: string): SlateUsageCandidacy {
  // Pre-flag rows carry `nppId` but no `isNPP`.
  return { characterId, nppId: characterId, status: "active" };
}

describe("countSlateAssignmentUsage", () => {
  it("reports the full cap as remaining when nothing is assigned", () => {
    expect(countSlateAssignmentUsage([], [])).toEqual({
      used: 0,
      cap: SLATE_ASSIGNMENT_CAP,
      remaining: SLATE_ASSIGNMENT_CAP,
    });
  });

  it("counts players and NPPs against one shared pool", () => {
    const usage = countSlateAssignmentUsage(
      [row("npp1", "invited"), row("player1", "accepted"), row("npp2", "filed")],
      []
    );
    expect(usage.used).toBe(3);
    expect(usage.remaining).toBe(0);
  });

  it("frees the slot of a declined or withdrawn row", () => {
    const usage = countSlateAssignmentUsage(
      [row("npp1", "declined"), row("npp2", "withdrawn"), row("npp3", "considering")],
      []
    );
    expect(usage.used).toBe(1);
    expect(usage.remaining).toBe(2);
  });

  it("counts a filed row and its candidacy as one slot, not two", () => {
    const usage = countSlateAssignmentUsage([row("npp1", "filed")], [candidacy("npp1", true)]);
    expect(usage.used).toBe(1);
  });

  it("counts an autopilot NPP candidacy that has no slate row", () => {
    const usage = countSlateAssignmentUsage([row("npp1", "accepted")], [candidacy("npp2", true)]);
    expect(usage.used).toBe(2);
  });

  it("counts an NPP candidacy that carries only a legacy nppId", () => {
    const usage = countSlateAssignmentUsage([], [legacyNppCandidacy("npp1")]);
    expect(usage.used).toBe(1);
  });

  it("never counts a player who filed their own candidacy", () => {
    const usage = countSlateAssignmentUsage([], [candidacy("player1", false)]);
    expect(usage.used).toBe(0);
  });

  it("ignores a candidacy that is no longer active", () => {
    const usage = countSlateAssignmentUsage([], [candidacy("npp1", true, "withdrawn")]);
    expect(usage.used).toBe(0);
  });

  it("counts an NPP the autopilot filed after they declined the chair", () => {
    // The declined row frees its slot, but the candidacy the autopilot then
    // created holds one. Exactly one slot, not zero and not two.
    const usage = countSlateAssignmentUsage([row("npp1", "declined")], [candidacy("npp1", true)]);
    expect(usage.used).toBe(1);
  });

  it("counts a duplicated slate row for one candidate once", () => {
    const usage = countSlateAssignmentUsage([row("npp1", "invited"), row("npp1", "accepted")], []);
    expect(usage.used).toBe(1);
  });

  it("clamps remaining at zero when a race is already over cap", () => {
    const usage = countSlateAssignmentUsage(
      [row("a", "filed"), row("b", "filed"), row("c", "filed"), row("d", "filed")],
      []
    );
    expect(usage.used).toBe(4);
    expect(usage.remaining).toBe(0);
  });
});
