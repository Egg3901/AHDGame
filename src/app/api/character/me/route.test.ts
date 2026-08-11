import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/elections/activeCandidacy", () => ({ findBlockingActiveCandidacy: vi.fn() }));
vi.mock("@/lib/db/patreonBorders", () => ({ fetchBordersByUserIds: vi.fn() }));
vi.mock("@/lib/currency/characterFunds", () => ({ getTotalPersonalLiquidWealth: vi.fn() }));
vi.mock("@/lib/currency/corporationCapital", () => ({ loadFxRatesRecord: vi.fn() }));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: vi.fn() }));
// Tracked-step writes are gated on the onboarding flag; default it ON here and
// flip it per-test to prove the fail-closed path.
vi.mock("@/lib/onboarding/featureFlag", () => ({
  isOnboardingChecklistEnabled: vi.fn(async () => true),
}));

// Inline schema mirrors the one defined in route.ts for unit testing
const patchSchema = z.object({
  onboardingDismissed: z.boolean().optional(),
  autoConvertEnabled: z.boolean().optional(),
  onboardingStep: z.enum(["scout-state", "read-wire"]).optional(),
});

describe("GET /api/character/me caching", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const userId = new ObjectId();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: userId.toString() } as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: userId.toString(),
        character: {
          _id: new ObjectId(),
          name: "Test Founder",
          party: "independent",
          homeState: "NY",
          countryId: "US",
          avatarUrl: null,
        },
      },
    } as never);

    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const { findBlockingActiveCandidacy } = await import("@/lib/elections/activeCandidacy");
    vi.mocked(findBlockingActiveCandidacy).mockResolvedValue(null as never);

    const { fetchBordersByUserIds } = await import("@/lib/db/patreonBorders");
    vi.mocked(fetchBordersByUserIds).mockResolvedValue(new Map());

    const { getTotalPersonalLiquidWealth } = await import("@/lib/currency/characterFunds");
    vi.mocked(getTotalPersonalLiquidWealth).mockReturnValue(0);
  });

  // Regression guard for the "corp doesn't appear until hard refresh" bug:
  // a stale max-age on this endpoint let the browser serve a pre-founding
  // (corporation: null) body to the post-founding refetch. The current
  // corporation must always be read fresh, so the response must not be
  // cacheable with a positive max-age.
  it("does not return a stale max-age Cache-Control header", async () => {
    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(200);
    const cacheControl = res.headers.get("Cache-Control") ?? "";
    expect(cacheControl).not.toMatch(/max-age=[1-9]/);
  });
});

describe("PATCH /api/character/me schema", () => {
  it("accepts autoConvertEnabled: true", () => {
    const result = patchSchema.safeParse({ autoConvertEnabled: true });
    expect(result.success).toBe(true);
    expect(result.data?.autoConvertEnabled).toBe(true);
  });

  it("accepts autoConvertEnabled: false", () => {
    const result = patchSchema.safeParse({ autoConvertEnabled: false });
    expect(result.success).toBe(true);
    expect(result.data?.autoConvertEnabled).toBe(false);
  });

  it("still accepts onboardingDismissed", () => {
    const result = patchSchema.safeParse({ onboardingDismissed: true });
    expect(result.success).toBe(true);
    expect(result.data?.onboardingDismissed).toBe(true);
  });

  it("accepts both fields together", () => {
    const result = patchSchema.safeParse({ onboardingDismissed: true, autoConvertEnabled: false });
    expect(result.success).toBe(true);
  });

  it("rejects non-boolean autoConvertEnabled", () => {
    const result = patchSchema.safeParse({ autoConvertEnabled: "yes" });
    expect(result.success).toBe(false);
  });

  it("accepts only the two tracked onboarding step ids", () => {
    expect(patchSchema.safeParse({ onboardingStep: "scout-state" }).success).toBe(true);
    expect(patchSchema.safeParse({ onboardingStep: "read-wire" }).success).toBe(true);
  });

  it("rejects untracked or invented step ids", () => {
    expect(patchSchema.safeParse({ onboardingStep: "join-party" }).success).toBe(false);
    expect(patchSchema.safeParse({ onboardingStep: "reward" }).success).toBe(false);
    expect(patchSchema.safeParse({ onboardingStep: "onboarding.rewardGrantedAt" }).success).toBe(
      false
    );
    expect(patchSchema.safeParse({ onboardingStep: 5 }).success).toBe(false);
  });
});

describe("PATCH /api/character/me onboarding step tracking", () => {
  let db: MockDb;
  let userId: ObjectId;
  let characterId: ObjectId;

  function patchRequest(body: unknown): Request {
    return new Request("http://localhost/api/character/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    userId = new ObjectId();
    characterId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: characterId,
      userId,
    } as never);
  });

  it("rejects an invalid step id with 400 and writes nothing", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patchRequest({ onboardingStep: "join-party" }));

    expect(res.status).toBe(400);
    // Validation fails before any DB access, so the collection is never touched.
    expect(db.collectionMocks.characters).toBeUndefined();
  });

  it("records a tracked step with a server-side timestamp, scoped to the caller's own character", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patchRequest({ onboardingStep: "read-wire" }));

    expect(res.status).toBe(200);
    const [filter, update] = db.collectionMocks.characters!.updateOne.mock.calls[0];
    // Only-self: the update is keyed to the resolved character AND the auth userId.
    expect(filter._id).toBe(characterId);
    expect(filter.userId).toEqual(userId);
    // First visit wins: never overwrite an existing timestamp.
    expect(filter["onboarding.steps.read-wire"]).toEqual({ $exists: false });
    // Timestamp is set server-side; the client can't choose the value.
    expect(update.$set["onboarding.steps.read-wire"]).toBeInstanceOf(Date);
  });

  it("skips the tracked-step write when the onboarding flag is off (fail-closed)", async () => {
    const { isOnboardingChecklistEnabled } = await import("@/lib/onboarding/featureFlag");
    vi.mocked(isOnboardingChecklistEnabled).mockResolvedValueOnce(false);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchRequest({ onboardingStep: "read-wire" }));

    // Still a successful no-op response; flag-off worlds take zero onboarding
    // writes even if a stray client sends the field. The characters collection
    // mock is created lazily on first access, so undefined = never touched.
    expect(res.status).toBe(200);
    expect(db.collectionMocks.characters).toBeUndefined();
  });

  it("dismissing the checklist stamps onboarding.dismissedAt alongside the legacy boolean", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patchRequest({ onboardingDismissed: true }));

    expect(res.status).toBe(200);
    const [, update] = db.collectionMocks.characters!.updateOne.mock.calls[0];
    expect(update.$set.onboardingDismissed).toBe(true);
    expect(update.$set["onboarding.dismissedAt"]).toBeInstanceOf(Date);
  });
});
