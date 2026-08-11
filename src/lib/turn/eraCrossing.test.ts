import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  shouldCrossEra,
  buildEraCrossingContent,
  runEraCrossing,
  runMetricActivation,
} from "./eraCrossing";
import { createSystemNewsPost } from "@/lib/news";
import { sendNewsEvent } from "@/lib/discordWebhooks";

vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/discordWebhooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discordWebhooks")>();
  return { ...actual, sendNewsEvent: vi.fn().mockResolvedValue(undefined) };
});

describe("shouldCrossEra (Week 1 of years ending in 0)", () => {
  it("fires on a decade year not yet crossed", () => {
    expect(shouldCrossEra(2000, undefined)).toBe(true);
    expect(shouldCrossEra(2010, 2000)).toBe(true);
  });
  it("does not re-fire within the same decade year", () => {
    expect(shouldCrossEra(2000, 2000)).toBe(false);
  });
  it("does not fire on non-decade years (incl. preset start years)", () => {
    expect(shouldCrossEra(1991, undefined)).toBe(false);
    expect(shouldCrossEra(2019, undefined)).toBe(false);
    expect(shouldCrossEra(2008, undefined)).toBe(false);
  });
  it("guards non-finite years", () => {
    expect(shouldCrossEra(NaN, undefined)).toBe(false);
  });
});

describe("buildEraCrossingContent", () => {
  it("names the new decade", () => {
    expect(buildEraCrossingContent("2000s")).toContain("2000s");
  });
});

describe("runEraCrossing (phase)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("no-ops entirely while the era system is disabled — even on a decade year", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current", currentYear: 2010 });
    const result = await runEraCrossing(db as unknown as Db);
    expect(result.ran).toBe(false);
    expect(db.collection("gameState").updateOne).not.toHaveBeenCalled();
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });

  it("no-ops off decade years when the marker is already current", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2008,
      currentEraId: "2000s",
      eraSystemEnabled: true,
    });
    const result = await runEraCrossing(db as unknown as Db);
    expect(result.ran).toBe(false);
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });

  it("stamps era + guard year and posts news on a decade year", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2010,
      eraSystemEnabled: true,
    });
    const result = await runEraCrossing(db as unknown as Db);
    expect(result).toEqual({ ran: true, eraId: "2010s", year: 2010 });
    expect(db.collection("gameState").updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        $set: expect.objectContaining({ currentEraId: "2010s", lastEraCrossedYear: 2010 }),
      })
    );
    expect(createSystemNewsPost).toHaveBeenCalledOnce();
  });

  it("quietly self-heals the marker on mid-decade enable (no news)", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2008,
      eraSystemEnabled: true,
    });
    const result = await runEraCrossing(db as unknown as Db);
    expect(result).toEqual({ ran: true, eraId: "2000s", year: 2008, healed: true });
    expect(db.collection("gameState").updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        $set: expect.objectContaining({ currentEraId: "2000s" }),
      })
    );
    // Self-heal must not set the crossing guard — the next real decade year still fires.
    const setArg = db.collection("gameState").updateOne.mock.calls[0][1].$set;
    expect(setArg.lastEraCrossedYear).toBeUndefined();
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });

  it("does not re-fire after the stamp", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2010,
      currentEraId: "2010s",
      lastEraCrossedYear: 2010,
      eraSystemEnabled: true,
    });
    const result = await runEraCrossing(db as unknown as Db);
    expect(result.ran).toBe(false);
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });
});

describe("runMetricActivation (era catalog activation news)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    vi.mocked(createSystemNewsPost).mockClear();
    vi.mocked(sendNewsEvent).mockClear();
  });

  it("no-ops entirely while the era system is disabled", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current", currentYear: 1998 });
    const result = await runMetricActivation(db as unknown as Db);
    expect(result.posted).toEqual([]);
    expect(db.collection("gameState").updateOne).not.toHaveBeenCalled();
  });

  it("first flag-on run quietly self-heals the guard — stamps, posts NOTHING", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2005,
      eraSystemEnabled: true,
    });
    const result = await runMetricActivation(db as unknown as Db);
    expect(result).toEqual({ posted: [], healed: true });
    const set = db.collection("gameState").updateOne.mock.calls[0][1].$set;
    expect(set.lastMetricActivationYear).toBe(2005);
    expect(createSystemNewsPost).not.toHaveBeenCalled();
    expect(sendNewsEvent).not.toHaveBeenCalled();
  });

  it("posts the base window copy once when the year crosses `from`", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1998,
      lastMetricActivationYear: 1997,
      eraSystemEnabled: true,
    });
    const result = await runMetricActivation(db as unknown as Db);
    expect(result.posted).toContain("The World Logs On");
    expect(createSystemNewsPost).toHaveBeenCalledWith(
      expect.stringContaining("Broadband access"),
      "general",
      { title: "The World Logs On" }
    );
    expect(sendNewsEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "The World Logs On" })
    );
    const set = db.collection("gameState").updateOne.mock.calls.at(-1)![1].$set;
    expect(set.lastMetricActivationYear).toBe(1998);
  });

  it("posts a countryOverride's OWN copy at its own year (not the base copy)", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2008,
      lastMetricActivationYear: 2007,
      eraSystemEnabled: true,
    });
    const result = await runMetricActivation(db as unknown as Db);
    expect(result.posted).toContain("Broadband Reaches Nigeria");
    expect(result.posted).not.toContain("The World Logs On");
  });

  it("does not re-post within the same covered year", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1998,
      lastMetricActivationYear: 1998,
      eraSystemEnabled: true,
    });
    const result = await runMetricActivation(db as unknown as Db);
    expect(result.posted).toEqual([]);
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });
});
