import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { GET, POST } from "./route";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Character } from "@/lib/db/types";
import type { PlayerBannerAd } from "@/lib/db/types/playerBannerAd";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));

function makeCharacter(overrides: Partial<Character> = {}): Character {
  const _id = overrides._id ?? new ObjectId();
  const userId = overrides.userId ?? new ObjectId();
  return {
    _id,
    userId,
    countryId: "US",
    name: "Test Cand",
    homeState: "California",
    politicalInfluence: 0,
    favorability: 50,
    infamy: 0,
    funds: 0,
    cashOnHand: 1_000_000,
    currencyBalances: { campaign: 0, personal: { USD: 1_000_000 } },
    actions: 0,
    donorBaseLevel: 0,
    policies: { economic: 0, social: 0 },
    party: "independent",
    currentOffice: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as Character;
}

function makeAd(overrides: Partial<PlayerBannerAd> = {}): PlayerBannerAd {
  return {
    _id: new ObjectId(),
    characterId: new ObjectId(),
    userId: new ObjectId(),
    characterName: "Test Cand",
    countryId: "US",
    imageUrl: "/x.png",
    viewCount: 0,
    isActive: true,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    createdTurn: 100,
    costPaid: 50,
    currencyCode: "USD",
    ...overrides,
  };
}

/** Make playerBannerAds.find().sort().toArray() resolve to `ads`. */
function stubRecentAds(db: MockDb, ads: PlayerBannerAd[]) {
  db.collection("playerBannerAds").find.mockReturnValue({
    sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(ads) }),
  });
}

describe("GET /api/player-ads", () => {
  let db: MockDb;
  let character: Character;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    character = makeCharacter();

    const { getDb } = await import("@/lib/mongodb");
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");

    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: character.userId.toString(), character },
    } as never);
    vi.mocked(isForexEnabled).mockResolvedValue(false);
    // users.findOne -> non-patron (none tier, 24-turn window, 0 free)
    db.collection("users").findOne.mockResolvedValue({ patreonTier: null });
  });

  it("returns turnsUntilEligible from createdTurn for a rate-limited non-patron", async () => {
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    vi.mocked(getCurrentTurn).mockResolvedValue(110); // 10 turns after the ad
    stubRecentAds(db, [makeAd({ characterId: character._id, createdTurn: 100, costPaid: 50 })]);

    const res = await GET();
    const data = await res.json();

    // window 24, ad at turn 100 -> eligible at 124, current 110 -> 14 turns left
    expect(data.turnsUntilEligible).toBe(14);
    // the wall-clock field is gone, replaced by the turn count
    expect(data.nextEligibleAt).toBeUndefined();
  });

  it("reports canSubmit false when rate-limited, even if the ad is affordable", async () => {
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    vi.mocked(getCurrentTurn).mockResolvedValue(110);
    stubRecentAds(db, [makeAd({ characterId: character._id, createdTurn: 100, costPaid: 50 })]);

    const res = await GET();
    const data = await res.json();

    expect(data.affordable).toBe(true); // cost 0 vs positive balance
    expect(data.turnsUntilEligible).toBe(14); // still within the window
    expect(data.canSubmit).toBe(false); // window blocks it despite affordability
  });
});

describe("POST /api/player-ads", () => {
  let db: MockDb;
  let character: Character;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    character = makeCharacter();

    const { getDb } = await import("@/lib/mongodb");
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");

    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: character.userId.toString(), character },
    } as never);
    vi.mocked(isForexEnabled).mockResolvedValue(false);
    db.collection("users").findOne.mockResolvedValue({ patreonTier: null });
  });

  it("rejects a within-window submission with 429 and turnsUntilEligible", async () => {
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    vi.mocked(getCurrentTurn).mockResolvedValue(105); // 5 turns after a turn-100 ad
    stubRecentAds(db, [makeAd({ characterId: character._id, createdTurn: 100, costPaid: 50 })]);

    const res = await POST(new Request("http://localhost/api/player-ads", { method: "POST" }));
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data.turnsUntilEligible).toBe(19); // 100 + 24 - 105
  });
});
