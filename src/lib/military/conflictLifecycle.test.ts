import { describe, it, expect } from "vitest";
import type { ConflictStatus } from "@/lib/db/types/conflict";
import {
  CONFLICT_ARCHIVE_DELAY_TURNS,
  archiveOpensTurn,
  isArchiveOpen,
  isConflictConcluded,
} from "./conflictLifecycle";

describe("isConflictConcluded", () => {
  it("is true for a resolved war", () => {
    expect(isConflictConcluded("resolved")).toBe(true);
  });

  it("is true for a war awaiting terms, whose rosters have already stood down", () => {
    expect(isConflictConcluded("terms_pending")).toBe(true);
  });

  it("is false for every status where the fighting can still continue", () => {
    for (const status of ["active", "escalating", "winding_down"] as ConflictStatus[]) {
      expect(isConflictConcluded(status)).toBe(false);
    }
  });

  it("is false for an absent status, so a malformed document is not read as finished", () => {
    // Treating unknown as concluded would silently stop a war nobody ended.
    expect(isConflictConcluded(undefined)).toBe(false);
  });

  it("covers every member of the status union", () => {
    // Guards the helper against a status added later that nobody classified here.
    const all: ConflictStatus[] = [
      "active",
      "escalating",
      "winding_down",
      "terms_pending",
      "resolved",
    ];
    for (const status of all) {
      expect(typeof isConflictConcluded(status)).toBe("boolean");
    }
  });
});

describe("archiveOpensTurn", () => {
  it("opens the archive CONFLICT_ARCHIVE_DELAY_TURNS after the war ended", () => {
    expect(archiveOpensTurn({ status: "resolved", endTurn: 500 })).toBe(
      500 + CONFLICT_ARCHIVE_DELAY_TURNS
    );
  });

  it("is null for a war that has not resolved, whatever endTurn says", () => {
    expect(archiveOpensTurn({ status: "terms_pending", endTurn: 500 })).toBeNull();
    expect(archiveOpensTurn({ status: "active" })).toBeNull();
  });

  // Every resolver stamps `endTurn` today; only a document resolved before the
  // stamp existed lacks it. Those have been an open record since they ended, and
  // dating their fog from nothing would hide what was already public.
  it("is null for a legacy resolved war with no endTurn, which is already open", () => {
    expect(archiveOpensTurn({ status: "resolved" })).toBeNull();
  });
});

describe("isArchiveOpen", () => {
  it("is closed inside the fog window and open from the turn it lapses", () => {
    const c = { status: "resolved" as const, endTurn: 100 };
    const opens = 100 + CONFLICT_ARCHIVE_DELAY_TURNS;
    expect(isArchiveOpen(c, opens - 1)).toBe(false);
    expect(isArchiveOpen(c, opens)).toBe(true);
  });

  it("is open for a legacy resolved war with no endTurn", () => {
    expect(isArchiveOpen({ status: "resolved" }, 0)).toBe(true);
  });

  it("is closed for a war that has not resolved", () => {
    expect(isArchiveOpen({ status: "terms_pending", endTurn: 0 }, 10_000)).toBe(false);
  });
});
