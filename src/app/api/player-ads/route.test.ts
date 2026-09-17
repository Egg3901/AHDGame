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
vi.mock("@/lib/playerAds/playerAdSpend", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/playerAds/playerAdSpend")>()),
  applyPlayerAdSpend: vi.fn(),
}));
vi.mock("@/lib/imageOptimize", () => ({
  optimizeImage: vi.fn(),
  IMAGE_PRESETS: { bannerAd: {} },
}));
vi.mock("@/lib/r2", () => ({
  isR2Enabled: vi.fn(),
  uploadFile: vi.fn(),
}));

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

describe("POST /api/player-ads spend flow", () => {
  let db: MockDb;
  let character: Character;
  const adId = new ObjectId();

  function multipartRequest(idempotencyKey?: string): Request {
    const form = new FormData();
    form.append("file", new Blob(["fake-image"], { type: "image/png" }), "ad.png");
    form.append("linkUrl", "https://example.com");
    form.append("altText", "An ad");
    return new Request("http://localhost/api/player-ads", {
      method: "POST",
      body: form,
      headers: idempotencyKey !== undefined ? { "Idempotency-Key": idempotencyKey } : {},
    });
  }

  async function spendInput() {
    const { applyPlayerAdSpend } = await import("@/lib/playerAds/playerAdSpend");
    const mock = vi.mocked(applyPlayerAdSpend);
    if (mock.mock.calls.length === 0) throw new Error("applyPlayerAdSpend was not called");
    return mock.mock.calls[0][1] as Record<string, unknown>;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    character = makeCharacter();

    const { getDb } = await import("@/lib/mongodb");
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    const { applyPlayerAdSpend } = await import("@/lib/playerAds/playerAdSpend");
    const { optimizeImage } = await import("@/lib/imageOptimize");
    const { isR2Enabled, uploadFile } = await import("@/lib/r2");

    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: character.userId.toString(), character },
    } as never);
    vi.mocked(isForexEnabled).mockResolvedValue(false);
    db.collection("users").findOne.mockResolvedValue({ patreonTier: null });
    vi.mocked(getCurrentTurn).mockResolvedValue(110);
    stubRecentAds(db, []);
    // Non-patron average wealth 25k -> cost floor(25k * 2%) = 500.
    db.collection("characters").aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ avg: 25000 }]),
    });
    vi.mocked(optimizeImage).mockResolvedValue({
      buffer: Buffer.from("optimized"),
      ext: "png",
    } as never);
    vi.mocked(isR2Enabled).mockReturnValue(true);
    vi.mocked(uploadFile).mockResolvedValue("https://cdn.example/ads/x.png");
    vi.mocked(applyPlayerAdSpend).mockResolvedValue({ duplicate: false, adId });
  });

  it("charges the exact spend shape and returns 201 with the flow adId", async () => {
    const res = await POST(multipartRequest("header-key-1"));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data).toEqual({ success: true, adId: adId.toHexString() });
    const input = await spendInput();
    expect(input).toMatchObject({
      characterId: character._id,
      balanceField: "cashOnHand",
      cost: 500,
      isFree: false,
      imageUrl: "https://cdn.example/ads/x.png",
      linkUrl: "https://example.com",
      altText: "An ad",
      createdTurn: 110,
      currencyCode: "USD",
      windowStartTurn: 86, // 110 - 24
      maxFree: 0,
      windowTurns: 24,
      fingerprint: `${character._id.toHexString()}:110:paid:500:USD`,
      idempotencyKey: "header-key-1",
    });
  });

  it("mints an idempotency key when no header is sent", async () => {
    const res = await POST(multipartRequest());
    expect(res.status).toBe(201);
    const input = await spendInput();
    expect(typeof input.idempotencyKey).toBe("string");
    expect((input.idempotencyKey as string).length).toBeGreaterThan(0);
  });

  it("rejects an over-long Idempotency-Key with 400 without spending", async () => {
    const { applyPlayerAdSpend } = await import("@/lib/playerAds/playerAdSpend");

    const res = await POST(multipartRequest("k".repeat(129)));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(vi.mocked(applyPlayerAdSpend)).not.toHaveBeenCalled();
    expect(data.error).toMatch(/Idempotency-Key/);
  });

  it("maps a raced window fill to 429 with the flow's turnsUntilEligible", async () => {
    const { applyPlayerAdSpend, PlayerAdSlotUnavailableError } =
      await import("@/lib/playerAds/playerAdSpend");
    vi.mocked(applyPlayerAdSpend).mockRejectedValue(new PlayerAdSlotUnavailableError(14));

    const res = await POST(multipartRequest());
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data.turnsUntilEligible).toBe(14);
  });

  it("preserves the 409 funds-changed contract", async () => {
    const { applyPlayerAdSpend } = await import("@/lib/playerAds/playerAdSpend");
    vi.mocked(applyPlayerAdSpend).mockRejectedValue(new Error("PLAYER_AD_FUNDS_CHANGED"));

    const res = await POST(multipartRequest());
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe("Your available personal funds changed before the ad completed.");
  });

  it("maps ad-row conflicts and settled-key replays to 409", async () => {
    const { applyPlayerAdSpend } = await import("@/lib/playerAds/playerAdSpend");
    const { MoneyFlowTerminalError, MoneyFlowKeyConflictError } =
      await import("@/lib/db/nonAtomicMoneyFlow");

    vi.mocked(applyPlayerAdSpend).mockRejectedValueOnce(new Error("PLAYER_AD_CONFLICT:missing"));
    expect((await POST(multipartRequest())).status).toBe(409);

    vi.mocked(applyPlayerAdSpend).mockRejectedValueOnce(
      new MoneyFlowTerminalError("k", "compensated")
    );
    expect((await POST(multipartRequest())).status).toBe(409);

    vi.mocked(applyPlayerAdSpend).mockRejectedValueOnce(new MoneyFlowKeyConflictError("k"));
    expect((await POST(multipartRequest())).status).toBe(409);
  });
});
