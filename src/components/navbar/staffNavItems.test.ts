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
});
