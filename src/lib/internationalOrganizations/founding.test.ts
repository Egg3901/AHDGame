import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { isOrganizationFounded, resolveSeedRoster, loadOrgFoundingContext } from "./founding";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("isOrganizationFounded", () => {
  it("treats orgs without foundedYear (custom orgs) as always founded", () => {
    expect(isOrganizationFounded({ def: {}, liveYear: 1950, hasMembers: false })).toBe(true);
  });

  it("is founded once the live year reaches foundedYear (boundary inclusive)", () => {
    const def = { foundedYear: 1993 };
    expect(isOrganizationFounded({ def, liveYear: 1992, hasMembers: false })).toBe(false);
    expect(isOrganizationFounded({ def, liveYear: 1993, hasMembers: false })).toBe(true);
    expect(isOrganizationFounded({ def, liveYear: 2019, hasMembers: false })).toBe(true);
  });

  it("member presence overrides the year (no forced history — a populated org never vanishes)", () => {
    expect(
      isOrganizationFounded({ def: { foundedYear: 1993 }, liveYear: 1953, hasMembers: true })
    ).toBe(true);
    expect(
      isOrganizationFounded({
        def: { foundedYear: 1952, dissolvedYear: 1991 },
        liveYear: 2004,
        hasMembers: true,
      })
    ).toBe(true);
  });

  it("dissolvedYear closes the window when the org has no members", () => {
    const def = { foundedYear: 1952, dissolvedYear: 1991 };
    expect(isOrganizationFounded({ def, liveYear: 1953, hasMembers: false })).toBe(true);
    expect(isOrganizationFounded({ def, liveYear: 1990, hasMembers: false })).toBe(true);
    // Boundary: dissolved exactly at the dissolution year.
    expect(isOrganizationFounded({ def, liveYear: 1991, hasMembers: false })).toBe(false);
    expect(isOrganizationFounded({ def, liveYear: 2019, hasMembers: false })).toBe(false);
  });

  it("null live year (legacy gameState) → founded, preserving legacy behavior", () => {
    expect(
      isOrganizationFounded({ def: { foundedYear: 1993 }, liveYear: null, hasMembers: false })
    ).toBe(true);
  });
});

describe("resolveSeedRoster", () => {
  const def = {
    foundingMembers: ["US", "UK", "DE"] as const,
    foundingMembersByEra: { "1953-default": ["US", "UK", "FR"] as const },
  };
  it("prefers the preset's era roster", () => {
    expect(resolveSeedRoster(def as never, "1953-default")).toEqual(["US", "UK", "FR"]);
  });
  it("falls back to foundingMembers when the preset has no entry", () => {
    expect(resolveSeedRoster(def as never, "2019-default")).toEqual(["US", "UK", "DE"]);
  });
});

describe("loadOrgFoundingContext", () => {
  let db: MockDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns nulls/defaults when gameState is missing", async () => {
    db.collection("gameState").findOne.mockResolvedValue(null);
    expect(await loadOrgFoundingContext(db as unknown as Db)).toEqual({
      liveYear: null,
      preset: "2019-default",
    });
  });

  it("returns the live year and preset from gameState", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1994,
      currentTurn: 720,
      startingYear: 1979,
      preset: "1979-default",
    });
    expect(await loadOrgFoundingContext(db as unknown as Db)).toEqual({
      liveYear: 1994,
      preset: "1979-default",
    });
  });
});
