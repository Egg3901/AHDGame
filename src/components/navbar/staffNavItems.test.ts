import { describe, expect, it } from "vitest";
import { buildStaffNavItems, isStaffUser, visibleStaffNavItems } from "./staffNavItems";

describe("buildStaffNavItems", () => {
  it("returns no visible items for non-staff", () => {
    expect(visibleStaffNavItems({ isAdmin: false, isModerator: false })).toEqual([]);
    expect(isStaffUser({ isAdmin: false, isModerator: false })).toBe(false);
  });

  it("moderator sees Mod Panel and Docs only", () => {
    const visible = visibleStaffNavItems({ isAdmin: false, isModerator: true });
    expect(visible.map((i) => i.label)).toEqual(["Mod Panel", "Docs"]);
  });

  it("admin sees all staff links", () => {
    const visible = visibleStaffNavItems({ isAdmin: true, isModerator: true });
    expect(visible.map((i) => i.label)).toEqual([
      "Admin Panel",
      "Mod Panel",
      "Ops Dashboard",
      "Docs",
      "Tickets",
      "Suggestions",
    ]);
  });

  it("admin-only links are gated", () => {
    const all = buildStaffNavItems({ isAdmin: true, isModerator: false });
    const modOnly = visibleStaffNavItems({ isAdmin: false, isModerator: true });
    expect(all.find((i) => i.label === "Tickets")?.show).toBe(true);
    expect(modOnly.find((i) => i.label === "Tickets")).toBeUndefined();
  });
});
