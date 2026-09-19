import { describe, it, expect } from "vitest";
import { notificationTypeFilter } from "./visibility";

describe("notification visibility", () => {
  it("leaves accounts without preferences unchanged", () => {
    expect(notificationTypeFilter(undefined, new Date())).toEqual({});
  });
  it("hides muted types and active snoozes, but restores expired snoozes", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(
      notificationTypeFilter(
        {
          mutedTypes: ["crisis"],
          snoozedTypes: [
            { type: "party_whip_issued", until: new Date("2026-01-01T13:00:00Z") },
            { type: "turn_advance", until: now },
          ],
        },
        now
      )
    ).toEqual({ type: { $nin: ["crisis", "party_whip_issued"] } });
  });
});
