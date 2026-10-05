import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/resetLegislation/loadReviewedCatalog", () => ({
  loadReviewedLawCatalog: vi.fn(),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { loadReviewedLawCatalog } = await import("@/lib/resetLegislation/loadReviewedCatalog");
const { GET } = await import("./route");

const receipt = (system: "metrics" | "legislation") => ({
  worldId: "world-v2",
  revision: RESET_V2_SEED_REVISION[system],
  sourceTurn: 1,
  completedAt: "1991-01-01T00:00:00.000Z",
  verificationHash: `verified-${system}`,
});

describe("reset legislation catalog route", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user-1", isAdmin: false },
    } as never);
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      resetWorldId: "world-v2",
      currentTurn: 1,
      startingYear: 1991,
      metricsSystemVersion: "v2",
      legislationSystemVersion: "v2",
      resetVersionSeeds: {
        metrics: receipt("metrics"),
        legislation: receipt("legislation"),
      },
    });
    vi.mocked(loadReviewedLawCatalog).mockResolvedValue([]);
  });

  it("loads the catalog when both dependent live versions are verified", async () => {
    const response = await GET(
      new Request("http://localhost/api/country/us/reset-legislation/catalog"),
      { params: Promise.resolve({ code: "us" }) }
    );

    expect(response.status).toBe(200);
    expect(db.collection("gameState").findOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        projection: expect.objectContaining({
          metricsSystemVersion: 1,
          legislationSystemVersion: 1,
        }),
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      country: "US",
      scope: "national",
      families: [],
    });
  });

  it("returns player-facing definitions for metrics used by the law catalog", async () => {
    vi.mocked(loadReviewedLawCatalog).mockResolvedValue([
      {
        familyId: "L04",
        title: "Work and wage standards",
        domain: "Economy, work, trade, and fiscal affairs",
        ownerCode: "LAB",
        primaryMetricIds: ["01"],
        currentLaw: "Existing standards",
        currentLawDescription: "Existing standards remain in force.",
        currentChoice: "center",
        overseeingSeatId: "secretary_of_labor",
        overseeingAgencyId: "us_labor_department",
        overseeingAgencyName: "U.S. Department of Labor",
        options: [],
      },
    ]);

    const response = await GET(
      new Request("http://localhost/api/country/us/reset-legislation/catalog"),
      { params: Promise.resolve({ code: "us" }) }
    );

    const body = await response.json();
    expect(body).toMatchObject({
      metrics: [
        {
          id: "01",
          name: "Unemployment",
          description: expect.stringContaining("share of people in the labor force"),
        },
      ],
    });
    expect(body.metrics[0].description).not.toContain("laborParticipation");
  });
});
