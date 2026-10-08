/**
 * Tests for GET + PATCH /api/admin/country/[code]/settings.
 * Covers admin auth guard, country code validation, settings resolution,
 * readiness gates on player/economy opening, and upsert logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({
  getCountryAccess: vi.fn(),
  getCountryAccessFromDb: vi.fn(),
}));

let db: MockDb;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  db = createMockDb();
});

async function setup(preset = "1953-default") {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { getCountryAccessFromDb } = await import("@/lib/countryAccess");
  vi.mocked(getCountryAccessFromDb).mockResolvedValue({
    enabledForPlayers: false,
    status: "coming-soon",
    economyPreview: false,
    requirementLevel: "background",
    registered: true,
    econOnly: true,
    nppGoverned: false,
  });
  // Pre-initialize collections used by the route
  db.collection("countryGameStates");
  db.collection("gameState");
  db.collection("characters");
  db.collection("npps");
  db.collection("politicalParties");
  db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
    _id: "current",
    preset,
    currentTurn: 1,
    currentYear: 1953,
  });
}

function makeAdmin() {
  return { ok: true, admin: { isAdmin: true } };
}

function makeForbidden() {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
  };
}

describe("GET /api/admin/country/[code]/settings", () => {
  it("returns settings, stats, and readiness for a valid country", async () => {
    await setup();

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { getCountryAccess } = await import("@/lib/countryAccess");
    vi.mocked(getCountryAccess).mockResolvedValue({
      enabledForPlayers: true,
      status: "active",
      economyPreview: false,
      requirementLevel: "player-enabled",
      registered: true,
      econOnly: false,
      nppGoverned: false,
    });

    db.collectionMocks["characters"]!.countDocuments.mockResolvedValue(34);
    db.collectionMocks["npps"]!.countDocuments.mockResolvedValue(512);
    db.collectionMocks["politicalParties"]!.countDocuments.mockResolvedValue(8);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/country/US/settings"), {
      params: Promise.resolve({ code: "US" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enabledForPlayers).toBe(true);
    expect(json.status).toBe("active");
    expect(json.readiness).toMatchObject({
      presetId: "1953-default",
      autonomous: "ready",
      player: "ready",
    });
    expect(json.readiness.archetypes).toContain("presidential");
    expect(json.readinessProfiles).toMatchObject({
      presetId: "1953-default",
      source: "reset-preset",
      activeLevel: "player-enabled",
      presetLevel: "player-enabled",
      contentStatus: "complete",
    });
    expect(json.readinessProfiles.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "background", status: "ready" }),
        expect.objectContaining({ level: "economy-preview", status: "ready" }),
        expect.objectContaining({ level: "player-enabled", status: "ready" }),
      ])
    );
    expect(json.stats).toEqual({
      currentTurn: 1,
      currentYear: 1953,
      activePlayers: 34,
      activeNpps: 512,
      politicalParties: 8,
    });
  });

  it("returns 400 for an invalid country code", async () => {
    await setup();

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/country/XX/settings"), {
      params: Promise.resolve({ code: "XX" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid country code");
  });

  it("returns 403 when user is not an admin", async () => {
    await setup();

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeForbidden() as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/country/US/settings"), {
      params: Promise.resolve({ code: "US" }),
    });

    expect(res.status).toBe(403);
  });

  it("returns fallback stat values when gameState document is missing", async () => {
    await setup();
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue(null);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { getCountryAccess } = await import("@/lib/countryAccess");
    vi.mocked(getCountryAccess).mockResolvedValue({
      enabledForPlayers: false,
      status: "coming-soon",
      economyPreview: false,
      requirementLevel: "background",
      registered: true,
      econOnly: true,
      nppGoverned: false,
    });

    db.collectionMocks["characters"]!.countDocuments.mockResolvedValue(0);
    db.collectionMocks["npps"]!.countDocuments.mockResolvedValue(0);
    db.collectionMocks["politicalParties"]!.countDocuments.mockResolvedValue(0);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/country/DE/settings"), {
      params: Promise.resolve({ code: "DE" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enabledForPlayers).toBe(false);
    expect(json.status).toBe("coming-soon");
    expect(json.readiness.presetId).toBe("2019-default");
    expect(json.stats).toEqual({
      currentTurn: null,
      currentYear: null,
      activePlayers: 0,
      activeNpps: 0,
      politicalParties: 0,
    });
  });

  it("reports an era-absent country as Background-ready without fabricating autonomy", async () => {
    await setup("2019-default");

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { getCountryAccess } = await import("@/lib/countryAccess");
    vi.mocked(getCountryAccess).mockResolvedValue({
      enabledForPlayers: false,
      status: "coming-soon",
      economyPreview: false,
      requirementLevel: "background",
      registered: false,
      econOnly: false,
      nppGoverned: false,
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/country/DD/settings"), {
      params: Promise.resolve({ code: "DD" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.absentFromEra).toBe(true);
    expect(json.readiness).toBeNull();
    expect(json.readinessProfiles).toMatchObject({
      presetId: "2019-default",
      presetLevel: "background",
      backgroundMode: "absent",
      contentStatus: "not-assessed",
    });
    expect(json.readinessProfiles.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "background", status: "ready", blockers: [] }),
        expect.objectContaining({ level: "economy-preview", status: "not-ready" }),
        expect.objectContaining({ level: "player-enabled", status: "not-ready" }),
      ])
    );
  });
});

describe("PATCH /api/admin/country/[code]/settings", () => {
  it("upserts settings on disable without readiness gate", async () => {
    await setup();

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    db.collectionMocks["countryGameStates"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
    });

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/US/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledForPlayers: false }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "US" }) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    expect(db.collectionMocks["countryGameStates"]!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      expect.objectContaining({
        $set: expect.objectContaining({ enabledForPlayers: false }),
      }),
      { upsert: true }
    );
  });

  it("allows enabling a player-ready country", async () => {
    await setup("1953-default");

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    db.collectionMocks["countryGameStates"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    });

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/UK/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledForPlayers: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "UK" }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks["countryGameStates"]!.updateOne).toHaveBeenCalled();
  });

  it("rejects enabling Japan 1953 with hard blockers named in the response", async () => {
    await setup("1953-default");

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/JP/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledForPlayers: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "JP" }) });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/hard blockers/i);
    expect(json.readiness.player).toBe("blocked");
    expect(json.readiness.autonomous).toBe("ready");
    expect(
      json.readiness.hardBlockers.map((b: { capabilityId: string }) => b.capabilityId)
    ).toContain("adminDiagnostics");
    expect(db.collectionMocks["countryGameStates"]!.updateOne).not.toHaveBeenCalled();
  });

  it("preserves player access explicitly when a status-only update is upserted", async () => {
    await setup();

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { getCountryAccessFromDb } = await import("@/lib/countryAccess");
    vi.mocked(getCountryAccessFromDb).mockResolvedValue({
      enabledForPlayers: false,
      status: "coming-soon",
      economyPreview: false,
      requirementLevel: "background",
      registered: true,
      econOnly: true,
      nppGoverned: false,
    });

    db.collectionMocks["countryGameStates"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    });

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/UK/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "UK" }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks["countryGameStates"]!.updateOne).toHaveBeenCalledWith(
      { _id: "UK" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "active", enabledForPlayers: false }),
      }),
      { upsert: true }
    );
  });

  it("rejects mutually exclusive player and economy-preview access", async () => {
    await setup();

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/UK/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledForPlayers: true, economyPreview: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "UK" }) });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot be player enabled and economy preview/i);
    expect(db.collectionMocks["countryGameStates"]!.updateOne).not.toHaveBeenCalled();
  });

  it("rejects economy preview when the country is already enabled for players", async () => {
    await setup();

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);
    const { getCountryAccessFromDb } = await import("@/lib/countryAccess");
    vi.mocked(getCountryAccessFromDb).mockResolvedValue({
      enabledForPlayers: true,
      status: "active",
      economyPreview: false,
      requirementLevel: "player-enabled",
      registered: true,
      econOnly: false,
      nppGoverned: false,
    });

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/UK/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ economyPreview: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "UK" }) });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/while it is enabled for players/i);
    expect(db.collectionMocks["countryGameStates"]!.updateOne).not.toHaveBeenCalled();
  });

  it("allows an atomic transition from player access to economy preview", async () => {
    await setup("1953-default");

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);
    const { getCountryAccessFromDb } = await import("@/lib/countryAccess");
    vi.mocked(getCountryAccessFromDb).mockResolvedValue({
      enabledForPlayers: true,
      status: "active",
      economyPreview: false,
      requirementLevel: "player-enabled",
      registered: true,
      econOnly: false,
      nppGoverned: false,
    });
    db.collectionMocks["countryGameStates"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    });

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/UK/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledForPlayers: false, economyPreview: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "UK" }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks["countryGameStates"]!.updateOne).toHaveBeenLastCalledWith(
      { _id: "UK" },
      { $set: expect.objectContaining({ economyPreview: true }) },
      { upsert: true }
    );
  });

  it("allows economy preview when autonomous readiness passes", async () => {
    await setup("1953-default");

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    db.collectionMocks["countryGameStates"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    });

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/JP/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ economyPreview: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "JP" }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks["countryGameStates"]!.updateOne).toHaveBeenCalled();
  });

  it("rejects economy preview when autonomous readiness is blocked", async () => {
    await setup("2019-default");

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/BR/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ economyPreview: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "BR" }) });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/economy preview/i);
    expect(json.readiness.autonomous).toBe("blocked");
    expect(json.readiness.hardBlockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ capabilityId: "fullAutonomousTier" })])
    );
    expect(db.collectionMocks["countryGameStates"]!.updateOne).not.toHaveBeenCalled();
  });

  it("rejects economy preview when the country is absent from the reset era", async () => {
    await setup("2019-default");

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/DD/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ economyPreview: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "DD" }) });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/absent from this era/i);
    expect(db.collectionMocks["countryGameStates"]!.updateOne).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid country code", async () => {
    await setup();

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/XX/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledForPlayers: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "XX" }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid country code");
  });

  it("returns 400 when body has no recognised fields (refine validation)", async () => {
    await setup();

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/US/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "US" }) });

    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid status value", async () => {
    await setup();

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/US/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "unknown-status" }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "US" }) });

    expect(res.status).toBe(400);
  });

  it("returns 403 when user is not an admin", async () => {
    await setup();

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeForbidden() as never);

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost/api/admin/country/US/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledForPlayers: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: "US" }) });

    expect(res.status).toBe(403);
  });
});
