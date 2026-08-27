import { describe, it, expect } from "vitest";
import type { ConflictStatus } from "@/lib/db/types/conflict";
import { isConflictConcluded } from "./conflictLifecycle";

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
