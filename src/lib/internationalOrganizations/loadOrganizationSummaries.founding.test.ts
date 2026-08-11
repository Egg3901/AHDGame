import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("loadOrganizationSummaries — founding-year visibility", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    // Default: every org-related collection empty (MockDb find().toArray() → []).
  });

  function gameState(gs: object | null) {
    db.collection("gameState").findOne.mockResolvedValue(gs);
  }

  it("hides the EU in a 1979 game before 1993 (Warsaw Pact still in its window)", async () => {
    gameState({ currentYear: 1980, preset: "1979-default" });
    const { loadOrganizationSummaries } = await import("./service");
    const summaries = await loadOrganizationSummaries(db as unknown as Db);
    // COMECON (1949–1991) shares the Warsaw Pact cold-war window — visible in
    // 1980; the Non-Aligned Movement (founded 1961) is in-window there too.
    expect(summaries.map((s) => s.id)).toEqual([
      "NATO",
      "UN",
      "COMMONWEALTH",
      "WARSAW_PACT",
      "NON_ALIGNED",
      "COMECON",
    ]);
  });

  it("hides an empty Warsaw Pact once past its dissolution year", async () => {
    gameState({ currentYear: 1995, preset: "1979-default" });
    const { loadOrganizationSummaries } = await import("./service");
    const summaries = await loadOrganizationSummaries(db as unknown as Db);
    expect(summaries.map((s) => s.id)).not.toContain("WARSAW_PACT");
    // COMECON dissolved 28 June 1991 — same exclusive dissolvedYear gate.
    expect(summaries.map((s) => s.id)).not.toContain("COMECON");
    expect(summaries.map((s) => s.id)).toContain("EU"); // 1993 ≤ 1995
  });

  it("a leadership row alone no longer keeps an out-of-window org visible", async () => {
    gameState({ currentYear: 1980, preset: "1979-default" });
    db.collection("organizationLeadership").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ organizationId: "EU" }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    const { loadOrganizationSummaries } = await import("./service");
    const summaries = await loadOrganizationSummaries(db as unknown as Db);
    expect(summaries.map((s) => s.id)).not.toContain("EU");
  });

  it("member presence keeps an out-of-window org visible (no forced history)", async () => {
    gameState({ currentYear: 1980, preset: "1979-default" });
    db.collection("organizationMemberships").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { organizationId: "EU", countryId: "DE", status: "active", joinedTurn: 5 },
        ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    const { loadOrganizationSummaries } = await import("./service");
    const summaries = await loadOrganizationSummaries(db as unknown as Db);
    expect(summaries.map((s) => s.id)).toContain("EU");
  });

  it("shows everything for a legacy gameState (null year)", async () => {
    gameState(null);
    const { loadOrganizationSummaries } = await import("./service");
    const summaries = await loadOrganizationSummaries(db as unknown as Db);
    expect(summaries.map((s) => s.id)).toEqual([
      "EU",
      "NATO",
      "UN",
      "COMMONWEALTH",
      "WARSAW_PACT",
      "NON_ALIGNED",
      "COMECON",
    ]);
  });
});
