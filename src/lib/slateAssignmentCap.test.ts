import { describe, expect, it } from "vitest";
import {
  SLATE_ASSIGNMENT_CAP,
  countSlateAssignmentUsage,
  formatSlateCapNote,
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

describe("formatSlateCapNote", () => {
  it("says how many may be assigned and how many are left", () => {
    const note = formatSlateCapNote({ used: 1, cap: 3, remaining: 2 });
    expect(note).toBe(
      "Up to 3 candidates may be assigned to this race, players and NPPs sharing the same 3 slots. 1 of 3 used."
    );
  });

  it("tells the chair what to do when the race is full", () => {
    const note = formatSlateCapNote({ used: 3, cap: 3, remaining: 0 });
    expect(note).toBe(
      "This race is full at 3 candidates, players and NPPs sharing the same 3 slots. Withdraw one to assign someone else."
    );
  });

  it("flags a race left above the limit by an older board", () => {
    const note = formatSlateCapNote({ used: 5, cap: 3, remaining: 0 });
    expect(note).toBe(
      "This race holds 5 candidates, above the limit of 3. The next turn will withdraw the extra."
    );
  });

  it("uses no dash characters anywhere in the copy", () => {
    for (const usage of [
      { used: 0, cap: 3, remaining: 3 },
      { used: 3, cap: 3, remaining: 0 },
      { used: 4, cap: 3, remaining: 0 },
    ]) {
      expect(formatSlateCapNote(usage)).not.toMatch(/[–—]/);
    }
  });
});
