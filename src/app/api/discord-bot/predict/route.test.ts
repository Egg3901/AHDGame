import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireBotToken", () => ({ requireBotToken: vi.fn(() => true) }));
vi.mock("@/lib/api/rateLimit", () => ({
  BOT_READ_LIMITS: { maxRequests: 60, windowMs: 60_000 },
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn(async () => ({ currentTurn: 1000 })) }));

function makeCursor<T>(rows: T[]) {
  return {
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

/**
 * Seed the three collections the no-active-election path reads. With no active
 * elections the route returns the current composition only — enough to exercise
 * country/race validation, case canonicalization, and chamber-name resolution,
 * which is where the IE/CN regression lived.
 */
function seedComposition(
  db: MockDb,
  opts: { countryId: string; officeType: string; party: string; seats: number }
) {
  db.collectionMocks.electedOfficials = db.collection("electedOfficials");
  db.collectionMocks.electedOfficials.find.mockReturnValue(
    makeCursor([
      {
        _id: new ObjectId(),
        characterId: new ObjectId(),
        countryId: opts.countryId,
        officeType: opts.officeType,
        party: opts.party,
        state: `${opts.countryId}-1`,
        seatsHeld: opts.seats,
      },
    ])
  );

  db.collectionMocks.politicalParties = db.collection("politicalParties");
  db.collectionMocks.politicalParties.find.mockReturnValue(
    makeCursor([
      {
        _id: new ObjectId(),
        sequentialId: opts.party,
        name: opts.party,
        countryId: opts.countryId,
      },
    ])
  );

  db.collectionMocks.elections = db.collection("elections");
  db.collectionMocks.elections.find.mockReturnValue(makeCursor([]));
}

describe("GET /api/discord-bot/predict", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("resolves IE Dáil (regression: previously rejected with empty race list)", async () => {
    seedComposition(db, { countryId: "IE", officeType: "dail", party: "5", seats: 80 });
    const { GET } = await import("./route");
    const res = await GET(new Request("https://x/api/discord-bot/predict?country=IE&race=dail"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.country).toBe("IE");
    expect(json.race).toBe("dail");
    expect(json.chamberName).toBe(COUNTRY_CONFIGS.IE.legislature.lowerChamber.name);
    expect(json.totalSeats).toBe(80);
  });

  it("resolves CN NPC and canonicalizes camelCase race regardless of input casing", async () => {
    seedComposition(db, { countryId: "CN", officeType: "npcDelegate", party: "1", seats: 2980 });
    const { GET } = await import("./route");
    // Lowercased input must still resolve to the canonical `npcDelegate` key.
    const res = await GET(
      new Request("https://x/api/discord-bot/predict?country=CN&race=npcdelegate")
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.race).toBe("npcDelegate");
    // chamberName resolves via the office's chamberKey (npc), not the race value.
    expect(json.chamberName).toBe(COUNTRY_CONFIGS.CN.legislature.lowerChamber.name);
  });

  it("rejects an invalid race with a non-empty valid-race list for the country", async () => {
    seedComposition(db, { countryId: "IE", officeType: "dail", party: "5", seats: 1 });
    const { GET } = await import("./route");
    const res = await GET(new Request("https://x/api/discord-bot/predict?country=IE&race=senate"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid race for IE");
    expect(json.error).toContain("dail");
  });

  it("rejects an unknown country", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("https://x/api/discord-bot/predict?country=ZZ&race=house"));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid country");
  });
});
