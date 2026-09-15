import { beforeEach, describe, expect, it, vi } from "vitest";

// OPS_DASHBOARD_URL resolves from NEXT_PUBLIC_OPS_DASHBOARD_URL at module load,
// so stub the env and re-import per test to cover both configurations.
async function load(opsUrl?: string) {
  vi.resetModules();
  if (opsUrl === undefined) vi.stubEnv("NEXT_PUBLIC_OPS_DASHBOARD_URL", "");
  else vi.stubEnv("NEXT_PUBLIC_OPS_DASHBOARD_URL", opsUrl);
  return await import("./staffNavItems");
}

describe("buildStaffNavItems", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  it("returns no visible items for non-staff", async () => {
    const { visibleStaffNavItems, isStaffUser } = await load("https://ops.example.com");
    expect(visibleStaffNavItems({ isAdmin: false, isModerator: false })).toEqual([]);
    expect(isStaffUser({ isAdmin: false, isModerator: false })).toBe(false);
  });

  it("moderator sees Mod Panel and Docs only", async () => {
    const { visibleStaffNavItems } = await load("https://ops.example.com");
    const visible = visibleStaffNavItems({ isAdmin: false, isModerator: true });
    expect(visible.map((i) => i.label)).toEqual(["Mod Panel", "Docs"]);
  });

  it("admin sees all staff links when an ops dashboard is configured", async () => {
    const { visibleStaffNavItems } = await load("https://ops.example.com");
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

  it("ops dashboard links hide when no dashboard is configured", async () => {
    const { visibleStaffNavItems } = await load(undefined);
    const visible = visibleStaffNavItems({ isAdmin: true, isModerator: true });
    expect(visible.map((i) => i.label)).toEqual(["Admin Panel", "Mod Panel", "Docs"]);
  });

  it("admin-only links are gated", async () => {
    const { buildStaffNavItems, visibleStaffNavItems } = await load("https://ops.example.com");
    const all = buildStaffNavItems({ isAdmin: true, isModerator: false });
    const modOnly = visibleStaffNavItems({ isAdmin: false, isModerator: true });
    expect(all.find((i) => i.label === "Tickets")?.show).toBe(true);
    expect(modOnly.find((i) => i.label === "Tickets")).toBeUndefined();
  });

  it("singleplayer owner sees Local World first, ahead of hosted console links", async () => {
    const { visibleStaffNavItems } = await load("https://ops.example.com");
    const visible = visibleStaffNavItems({ isAdmin: true, isSingleplayerOwner: true });
    expect(visible[0]).toMatchObject({ label: "Local World", href: "/singleplayer/admin" });
    expect(visible.map((i) => i.label)).toContain("Admin Panel");
  });

  it("hides Local World without owner authority", async () => {
    const { visibleStaffNavItems } = await load("https://ops.example.com");
    // Multiplayer admin: singleplayer mode is off.
    expect(
      visibleStaffNavItems({ isAdmin: true, isSingleplayerOwner: false }).map((i) => i.label)
    ).not.toContain("Local World");
    // Singleplayer guest (host-mode LAN viewer): mode is on but the DB
    // record carries no admin, so the owner flag stays false.
    expect(
      visibleStaffNavItems({ isAdmin: false, isModerator: false }).map((i) => i.label)
    ).not.toContain("Local World");
    // Moderator never owns the world.
    expect(
      visibleStaffNavItems({ isAdmin: false, isModerator: true }).map((i) => i.label)
    ).not.toContain("Local World");
  });

  it("viewerIsSingleplayerOwner needs mode AND the admin record, never mode alone", async () => {
    const { viewerIsSingleplayerOwner } = await load("https://ops.example.com");
    expect(viewerIsSingleplayerOwner({ singleplayer: true, isAdmin: true })).toBe(true);
    expect(viewerIsSingleplayerOwner({ singleplayer: true, isAdmin: false })).toBe(false);
    expect(viewerIsSingleplayerOwner({ singleplayer: false, isAdmin: true })).toBe(false);
    expect(viewerIsSingleplayerOwner({ isAdmin: true })).toBe(false);
    expect(viewerIsSingleplayerOwner(null)).toBe(false);
    expect(viewerIsSingleplayerOwner(undefined)).toBe(false);
  });
});
