import { describe, it, expect } from "vitest";
import type { Election } from "@/lib/db/types";
import { snapAnchorEndTime } from "./snapShift";

const at = (ms: number) => new Date(ms);

function prev(over: Partial<Election> = {}): Partial<Election> {
  return { electionType: "snap_commons", endTime: at(1000), ...over };
}

describe("snapAnchorEndTime", () => {
  it("returns the end time of a prime minister's snap, which drags the calendar", () => {
    // Shipped behaviour: the immediate post-snap regular anchors to the snap's
    // end turn. This test exists so the imposed-snap change cannot silently
    // alter it.
    expect(snapAnchorEndTime(prev(), "snap_commons")).toEqual(at(1000));
  });

  it("returns null for an imposed snap, so the calendar stays canonical", () => {
    // A settlement dissolves a chamber. It does not also reschedule every
    // future election in the country.
    expect(snapAnchorEndTime(prev({ imposedSnap: true }), "snap_commons")).toBeNull();
  });

  it("treats imposedSnap false the same as a prime minister's snap", () => {
    expect(snapAnchorEndTime(prev({ imposedSnap: false }), "snap_commons")).toEqual(at(1000));
  });

  it("returns null for a regular election, so admin edits cannot drag the calendar", () => {
    // The existing rule this helper preserves: only a SNAP anchors the next
    // regular. An admin-accelerated regular must not.
    expect(snapAnchorEndTime(prev({ electionType: "commons" }), "snap_commons")).toBeNull();
  });

  it("returns null when the snap type does not match the caller's chamber", () => {
    expect(snapAnchorEndTime(prev({ electionType: "snap_shugiin" }), "snap_commons")).toBeNull();
  });

  it("returns null when there is no prior election at all", () => {
    expect(snapAnchorEndTime(null, "snap_commons")).toBeNull();
    expect(snapAnchorEndTime(undefined, "snap_commons")).toBeNull();
  });

  it("returns null when the prior snap carries no end time", () => {
    expect(snapAnchorEndTime(prev({ endTime: undefined }), "snap_commons")).toBeNull();
  });
});
