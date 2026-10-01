import { describe, expect, it } from "vitest";
import { getRacePriority } from "./nppElectionPriority";

describe("getRacePriority", () => {
  it.each([
    ["snap_commons", "commons"],
    ["snap_bundestag", "bundestag"],
    ["snap_shugiin", "shugiin"],
  ])("gives %s the same priority as %s", (snapType, regularType) => {
    expect(getRacePriority(snapType)).toBe(getRacePriority(regularType));
  });

  it("keeps unknown election types at the fallback priority", () => {
    expect(getRacePriority("unknown-race")).toBe(999);
  });
});
