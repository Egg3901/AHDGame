import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const { enabledMock } = vi.hoisted(() => ({ enabledMock: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({
  isCountryEnabledForPlayers: (...a: unknown[]) => enabledMock(...a),
}));

import { assessCountryV1Readiness } from "../v1Readiness";

function setCounts(db: MockDb, counts: Record<string, number>) {
  for (const [col, n] of Object.entries(counts)) {
    vi.mocked(db.collection(col).countDocuments).mockResolvedValue(n as never);
  }
}

describe("assessCountryV1Readiness", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    enabledMock.mockReset().mockResolvedValue(false);
  });

  it("reports ready when all required entities are seeded (parliamentary)", async () => {
    setCounts(db, { npps: 40, politicalParties: 4, electedOfficials: 60, states: 12 });
    const r = await assessCountryV1Readiness(db as unknown as Db, "UK");
    expect(r.ready).toBe(true);
    expect(r.checks.find((c) => c.id === "states")!.ok).toBe(true);
    expect(r.checks.find((c) => c.id === "lowerSeats")!.severity).toBe("required");
  });

  it("flags not-ready when states are unseeded (the Nigeria-style gap)", async () => {
    setCounts(db, { npps: 40, politicalParties: 4, electedOfficials: 0, states: 0 });
    const r = await assessCountryV1Readiness(db as unknown as Db, "NG");
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.id === "states")!.ok).toBe(false);
    // NG is presidential → lower-chamber seats are only recommended, not required.
    expect(r.checks.find((c) => c.id === "lowerSeats")!.severity).toBe("recommended");
  });

  it("treats missing lower-chamber seats as required for a parliamentary country", async () => {
    setCounts(db, { npps: 40, politicalParties: 4, electedOfficials: 0, states: 12 });
    const r = await assessCountryV1Readiness(db as unknown as Db, "JP");
    expect(r.ready).toBe(false); // lowerSeats is required for JP and is 0
  });

  it("marks a player-enabled country as such (V1 does not act there)", async () => {
    enabledMock.mockResolvedValue(true);
    setCounts(db, { npps: 100, politicalParties: 5, electedOfficials: 400, states: 50 });
    const r = await assessCountryV1Readiness(db as unknown as Db, "US");
    expect(r.enabledForPlayers).toBe(true);
  });
});
