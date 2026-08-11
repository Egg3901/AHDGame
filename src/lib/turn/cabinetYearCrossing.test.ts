import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { runCabinetYearCrossing } from "./cabinetYearCrossing";
import { createSystemNewsPost } from "@/lib/news";
import { sendNewsEvent } from "@/lib/discordWebhooks";

vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/discordWebhooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discordWebhooks")>();
  return { ...actual, sendNewsEvent: vi.fn().mockResolvedValue(undefined) };
});

describe("runCabinetYearCrossing", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("cabinetMembers").findOne.mockResolvedValue(null);
  });

  it("no-ops without a finite currentYear", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current" });
    const result = await runCabinetYearCrossing(db as unknown as Db);
    expect(result.ran).toBe(false);
    expect(db.collection("gameState").updateOne).not.toHaveBeenCalled();
  });

  it("first run self-heals quietly: stamps guard, posts nothing", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1979,
      eraSystemEnabled: true,
    });
    const result = await runCabinetYearCrossing(db as unknown as Db);
    expect(result).toMatchObject({ ran: true, healed: true, posted: [] });
    expect(db.collection("gameState").updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        $set: expect.objectContaining({ lastCabinetYearProcessed: 1979 }),
      })
    );
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });

  it("no-ops when the year has not advanced past the guard", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1979,
      lastCabinetYearProcessed: 1979,
      eraSystemEnabled: true,
    });
    const result = await runCabinetYearCrossing(db as unknown as Db);
    expect(result.ran).toBe(false);
  });

  it("posts unlock news when a US seat crosses yearEnabled (1964→1965: HUD)", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1965,
      lastCabinetYearProcessed: 1964,
      eraSystemEnabled: true,
    });
    const result = await runCabinetYearCrossing(db as unknown as Db);
    expect(result.ran).toBe(true);
    expect(result.posted.some((t) => t.includes("Housing and Urban Development"))).toBe(true);
    expect(createSystemNewsPost).toHaveBeenCalled();
    expect(sendNewsEvent).toHaveBeenCalled();
  });

  it("reconcile still runs with eraSystemEnabled off — news does not", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2001,
      lastCabinetYearProcessed: 2000,
      eraSystemEnabled: false,
    });
    db.collection("cabinetMembers").findOne.mockImplementation(
      async (query: Record<string, unknown>) =>
        query.positionId === "agriculture_secretary" && query.countryId === "UK"
          ? { _id: "member1", countryId: "UK", positionId: "agriculture_secretary" }
          : null
    );
    const result = await runCabinetYearCrossing(db as unknown as Db);
    expect(result.transferred).toContain("UK:agriculture_secretary->environment_secretary");
    expect(db.collection("cabinetMembers").updateOne).toHaveBeenCalledWith(
      { _id: "member1" },
      expect.objectContaining({
        $set: expect.objectContaining({ positionId: "environment_secretary" }),
      })
    );
    expect(createSystemNewsPost).not.toHaveBeenCalled();
    expect(db.collection("gameState").updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        $set: expect.objectContaining({ lastCabinetYearProcessed: 2001 }),
      })
    );
  });

  it("2000→2001 with news on: single reorganization item, no literal years", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2001,
      lastCabinetYearProcessed: 2000,
      eraSystemEnabled: true,
    });
    db.collection("cabinetMembers").findOne.mockImplementation(
      async (query: Record<string, unknown>) =>
        query.positionId === "agriculture_secretary" && query.countryId === "UK"
          ? { _id: "member1", countryId: "UK", positionId: "agriculture_secretary" }
          : null
    );
    const result = await runCabinetYearCrossing(db as unknown as Db);
    expect(result.transferred).toHaveLength(1);
    const bodies = (createSystemNewsPost as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => String(c[0])
    );
    for (const body of bodies) expect(body).not.toMatch(/\b(19|20)\d{2}\b/);
    // The successor seat's unlock is folded into the reorganization item — no
    // separate "Established" post for environment_secretary. (2000→2001 also
    // legitimately posts rename items for other UK seats with 2001 bands.)
    const established = result.posted.filter((t) => t.includes("Established"));
    expect(established).toHaveLength(1);
    expect(established[0]).toContain("Environment, Food and Rural Affairs");
  });

  it("occupied retiring seat with successor already filled: incumbent removed", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2001,
      lastCabinetYearProcessed: 2000,
      eraSystemEnabled: false,
    });
    db.collection("cabinetMembers").findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.positionId === "agriculture_secretary" && query.countryId === "UK")
          return { _id: "member1", countryId: "UK", positionId: "agriculture_secretary" };
        if (query.positionId === "environment_secretary" && query.countryId === "UK")
          return { _id: "member2", countryId: "UK", positionId: "environment_secretary" };
        return null;
      }
    );
    const result = await runCabinetYearCrossing(db as unknown as Db);
    expect(result.removed).toContain("UK:agriculture_secretary");
    expect(db.collection("cabinetMembers").deleteOne).toHaveBeenCalledWith({ _id: "member1" });
  });

  it("first-run self-heal reconciles an occupied retired seat silently", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2019,
      eraSystemEnabled: true,
    });
    db.collection("cabinetMembers").findOne.mockImplementation(
      async (query: Record<string, unknown>) =>
        query.positionId === "agriculture_secretary" && query.countryId === "UK"
          ? { _id: "member1", countryId: "UK", positionId: "agriculture_secretary" }
          : null
    );
    const result = await runCabinetYearCrossing(db as unknown as Db);
    expect(result.healed).toBe(true);
    expect(result.transferred).toContain("UK:agriculture_secretary->environment_secretary");
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });
});
