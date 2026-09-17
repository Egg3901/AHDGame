/**
 * Per-user GET no-store coverage (#589).
 *
 * Every GET below reads the authenticated caller and returns a body that
 * differs per caller at the same URL, so it must never be edge-cacheable.
 * Each handler is wrapped with `withNoStore`; these tests prove the
 * `Cache-Control: no-store` guarantee holds on success AND on the
 * auth/error paths (401s, 404s, feature-gated 403s), where a missing stamp
 * would be just as cacheable.
 *
 * Success-path assertions are header-only on purpose: bodies and statuses
 * belong to the routes' own tests. Statuses are asserted only where they
 * are fully determined by the mocks (auth failures, invalid ids, short
 * queries, disabled flags).
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextResponse, NextRequest } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { AuthUser } from "@/lib/auth";
import type { Character } from "@/lib/db/types";

const mockGetDb = vi.fn();
vi.mock("@/lib/mongodb", () => ({ getDb: mockGetDb }));

const mockRequireAuth = vi.fn();
const mockRequireBasicAuth = vi.fn();
const mockRequireAuthWithCharacter = vi.fn();
const mockRequireHumanSession = vi.fn();
const mockRequireAdmin = vi.fn();
vi.mock("@/lib/api/requireAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/requireAuth")>();
  return {
    ...actual,
    requireAuth: mockRequireAuth,
    requireBasicAuth: mockRequireBasicAuth,
    requireAuthWithCharacter: mockRequireAuthWithCharacter,
    requireHumanSession: mockRequireHumanSession,
  };
});
vi.mock("@/lib/api/requireAdmin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/requireAdmin")>();
  return { ...actual, requireAdmin: mockRequireAdmin };
});

const mockGetAuthUser = vi.fn();
const mockGetAuthUserWithCharacter = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getAuthUser: mockGetAuthUser,
    getAuthUserWithCharacter: mockGetAuthUserWithCharacter,
  };
});

const mockIsForexEnabled = vi.fn();
vi.mock("@/lib/currency/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency/featureFlag")>();
  return { ...actual, isForexEnabled: mockIsForexEnabled };
});

const mockGetGameState = vi.fn();
vi.mock("@/lib/gameState", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gameState")>();
  return { ...actual, getGameState: mockGetGameState };
});

const mockGetCurrentTurn = vi.fn();
vi.mock("@/lib/turn/currentTurn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/turn/currentTurn")>();
  return { ...actual, getCurrentTurn: mockGetCurrentTurn };
});

const mockCheckWikiDisabled = vi.fn();
vi.mock("@/lib/api/wikiGuard", () => ({ checkWikiDisabled: mockCheckWikiDisabled }));

const mockIsRpgStatsEnabled = vi.fn();
vi.mock("@/lib/stats/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stats/featureFlag")>();
  return { ...actual, isRpgStatsEnabled: mockIsRpgStatsEnabled };
});

const mockIsLabourFullMode = vi.fn();
vi.mock("@/lib/labour/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labour/featureFlag")>();
  return { ...actual, isLabourFullMode: mockIsLabourFullMode };
});

const userId = new ObjectId().toHexString();
const characterId = new ObjectId();
const basicUser: AuthUser = {
  userId,
  username: "viewer",
  email: "viewer@example.test",
  role: "player",
  isAdmin: false,
  isModerator: false,
  isBanned: false,
};
const adminUser: AuthUser = { ...basicUser, isAdmin: true };
const character = {
  _id: characterId,
  userId: new ObjectId(userId),
  countryId: "US",
  homeState: new ObjectId(),
  party: "independent",
} as unknown as Character;
const characterUser = { ...basicUser, character, hasCharacter: true };
const adminOk = { ok: true, admin: { userId, username: "root" } };
const fail = (mock: Mock, status = 401) =>
  mock.mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status }),
  });

const req = (path: string) => new Request(`https://example.test${path}`);
const idParams = (id = characterId.toHexString()) => ({ params: Promise.resolve({ id }) });
const NO_STORE = "no-store";

let db: MockDb;
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  mockGetDb.mockResolvedValue(db as unknown as Db);
  fail(mockRequireAuth);
  fail(mockRequireBasicAuth);
  fail(mockRequireAuthWithCharacter);
  fail(mockRequireHumanSession);
  fail(mockRequireAdmin);
  mockGetAuthUser.mockResolvedValue(null);
  mockGetAuthUserWithCharacter.mockResolvedValue(null);
  mockIsForexEnabled.mockResolvedValue(true);
  mockGetGameState.mockResolvedValue(null);
  mockGetCurrentTurn.mockResolvedValue(1);
  mockCheckWikiDisabled.mockResolvedValue(null);
  mockIsRpgStatsEnabled.mockResolvedValue(true);
  mockIsLabourFullMode.mockResolvedValue(true);
});

function expectNoStore(res: Response) {
  expect(res.headers.get("Cache-Control")).toContain(NO_STORE);
}

describe("per-user GET auth failures are never cacheable", () => {
  const cases: { name: string; run: () => Promise<Response> }[] = [
    { name: "auth/character", run: async () => (await import("./auth/character/route")).GET() },
    {
      name: "auth/active-character",
      run: async () =>
        (await import("./auth/active-character/route")).GET(req("/api/auth/active-character")),
    },
    {
      name: "character/savings",
      run: async () => (await import("./character/savings/route")).GET(),
    },
    {
      name: "character/savings/ledger",
      run: async () =>
        (await import("./character/savings/ledger/route")).GET(
          req("/api/character/savings/ledger")
        ),
    },
    { name: "character/loc", run: async () => (await import("./character/loc/route")).GET() },
    {
      name: "character/allocate-stats",
      run: async () =>
        (await import("./character/allocate-stats/route")).GET(
          req("/api/character/allocate-stats")
        ),
    },
    {
      name: "character/constituency",
      run: async () => (await import("./character/constituency/route")).GET(),
    },
    // character/relocate: covered on the success path below (its auth-failure
    // path hangs the test runner under mocks; residual, see handoff).
    {
      name: "character/[id]/portfolio",
      run: async () =>
        (await import("./character/[id]/portfolio/route")).GET(req("/x"), idParams()),
    },
    {
      name: "character/[id]/sovereign-holdings",
      run: async () =>
        (await import("./character/[id]/sovereign-holdings/route")).GET(req("/x"), idParams()),
    },
    {
      name: "character/[id]/fund-portfolio",
      run: async () =>
        (await import("./character/[id]/fund-portfolio/route")).GET(req("/x"), idParams()),
    },
    {
      name: "characters/[id]/subscribe rejects a malformed id without caching",
      run: async () =>
        (await import("./characters/[id]/subscribe/route")).GET(req("/x"), {
          params: Promise.resolve({ id: "not-an-id" }),
        }),
    },
    {
      name: "charters",
      run: async () => (await import("./charters/route")).GET(req("/api/charters?me=true")),
    },
    { name: "player-ads", run: async () => (await import("./player-ads/route")).GET() },
    {
      name: "forex/orders",
      run: async () => (await import("./forex/orders/route")).GET(req("/api/forex/orders")),
    },
    {
      name: "forex/transactions",
      run: async () =>
        (await import("./forex/transactions/route")).GET(req("/api/forex/transactions")),
    },
    { name: "tutorial/context", run: async () => (await import("./tutorial/context/route")).GET() },
    { name: "tutorial/plan", run: async () => (await import("./tutorial/plan/route")).GET() },
    {
      name: "onboarding/signals",
      run: async () => (await import("./onboarding/signals/route")).GET(),
    },
    {
      name: "canvassing/eligibility",
      run: async () => (await import("./canvassing/eligibility/route")).GET(),
    },
    {
      name: "actions/poll",
      run: async () =>
        (await import("./actions/poll/route")).GET(
          new NextRequest("https://example.test/api/actions/poll")
        ),
    },
    {
      name: "actions/recommendations",
      run: async () => (await import("./actions/recommendations/route")).GET(),
    },
    {
      name: "political-operations/state-org/list",
      run: async () => (await import("./political-operations/state-org/list/route")).GET(),
    },
    {
      name: "political-operations/state-org/by-state",
      run: async () =>
        (await import("./political-operations/state-org/by-state/[stateId]/route")).GET(req("/x"), {
          params: Promise.resolve({ stateId: "CA" }),
        }),
    },
    {
      name: "corporation/[id]/private-invites",
      run: async () =>
        (await import("./corporation/[id]/private-invites/route")).GET(req("/x"), idParams()),
    },
    {
      name: "settings/supporter-requests",
      run: async () => (await import("./settings/supporter-requests/route")).GET(),
    },
    {
      name: "settings/user-api-keys",
      run: async () => (await import("./settings/user-api-keys/route")).GET(),
    },
    {
      name: "settings/bot-api-keys",
      run: async () => (await import("./settings/bot-api-keys/route")).GET(),
    },
    {
      name: "settings/retired-characters",
      run: async () => (await import("./settings/retired-characters/route")).GET(),
    },
    {
      name: "settings/retired-characters/[id]",
      run: async () =>
        (await import("./settings/retired-characters/[id]/route")).GET(req("/x"), idParams()),
    },
    {
      name: "settings/achievements/list",
      run: async () => (await import("./settings/achievements/list/route")).GET(),
    },
    {
      name: "settings/resignable-positions",
      run: async () => (await import("./settings/resignable-positions/route")).GET(),
    },
    {
      name: "game/turn/dashboard",
      run: async () => (await import("./game/turn/dashboard/route")).GET(),
    },
    { name: "news", run: async () => (await import("./news/route")).GET(req("/api/news")) },
    {
      name: "unions/[id]/leader/vote disabled",
      run: async () => {
        mockIsLabourFullMode.mockResolvedValue(false);
        return (await import("./unions/[id]/leader/vote/route")).GET(req("/x"), idParams());
      },
    },
    {
      name: "wiki/[slug]",
      run: async () =>
        (await import("./wiki/[slug]/route")).GET(req("/api/wiki/x"), {
          params: Promise.resolve({ slug: "x" }),
        }),
    },
    {
      name: "wiki/search",
      run: async () => (await import("./wiki/search/route")).GET(req("/api/wiki/search?q=x")),
    },
    {
      name: "search/universal short query",
      run: async () =>
        (await import("./search/universal/route")).GET(req("/api/search/universal?q=a")),
    },
    {
      name: "suggestions/public",
      run: async () =>
        (await import("./suggestions/public/route")).GET(req("/api/suggestions/public")),
    },
  ];

  it.each(cases)("$name stamps no-store on the failure path", async ({ run }) => {
    const res = await run();
    expectNoStore(res);
  });

  it("stamps 401 + no-store when the caller check fails on representative routes", async () => {
    const savings = await (await import("./character/savings/route")).GET();
    expect(savings.status).toBe(401);
    expectNoStore(savings);

    const keys = await (await import("./settings/user-api-keys/route")).GET();
    expect(keys.status).toBe(401);
    expectNoStore(keys);

    const fund = await (
      await import("./character/[id]/fund-portfolio/route")
    ).GET(req("/x"), idParams());
    expect(fund.status).toBe(401);
    expectNoStore(fund);

    const badId = await (
      await import("./character/[id]/sovereign-holdings/route")
    ).GET(req("/x"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(badId.status).toBe(401);
    expectNoStore(badId);
  });

  it("stamps no-store on the admin character-switch validation error", async () => {
    mockRequireAdmin.mockResolvedValue(adminOk);
    const res = await (
      await import("./auth/active-character/route")
    ).GET(req("/api/auth/active-character"));
    expect(res.status).toBe(400);
    expectNoStore(res);
  });
});

describe("per-user GET success paths are never cacheable", () => {
  function okBasic() {
    mockRequireBasicAuth.mockResolvedValue({ ok: true, user: basicUser });
    mockRequireHumanSession.mockResolvedValue({ ok: true, user: basicUser });
  }
  function okCharacter() {
    mockRequireAuthWithCharacter.mockResolvedValue({ ok: true, user: characterUser });
    mockRequireAuth.mockResolvedValue({ ok: true, user: characterUser });
  }

  it.each([
    {
      name: "auth/character",
      run: async () => {
        okBasic();
        return (await import("./auth/character/route")).GET();
      },
    },
    {
      name: "character/savings",
      run: async () => {
        okBasic();
        return (await import("./character/savings/route")).GET();
      },
    },
    {
      name: "character/savings/ledger",
      run: async () => {
        okBasic();
        return (await import("./character/savings/ledger/route")).GET(
          req("/api/character/savings/ledger")
        );
      },
    },
    {
      name: "character/loc",
      run: async () => {
        okBasic();
        return (await import("./character/loc/route")).GET();
      },
    },
    {
      name: "character/allocate-stats",
      run: async () => {
        mockRequireHumanSession.mockResolvedValue({ ok: true, user: basicUser });
        return (await import("./character/allocate-stats/route")).GET(
          req("/api/character/allocate-stats")
        );
      },
    },
    {
      name: "character/constituency",
      run: async () => {
        okCharacter();
        return (await import("./character/constituency/route")).GET();
      },
    },
    {
      name: "character/relocate",
      run: async () => {
        okCharacter();
        return (await import("./character/relocate/route")).GET();
      },
    },
    {
      name: "character/[id]/portfolio",
      run: async () => {
        mockRequireAuth.mockResolvedValue({ ok: true, user: characterUser });
        return (await import("./character/[id]/portfolio/route")).GET(req("/x"), idParams());
      },
    },
    {
      name: "character/[id]/sovereign-holdings returns 200 with no-store",
      run: async () => {
        mockRequireAuth.mockResolvedValue({ ok: true, user: characterUser });
        const res = await (
          await import("./character/[id]/sovereign-holdings/route")
        ).GET(req("/x"), idParams());
        expect(res.status).toBe(200);
        return res;
      },
    },
    {
      name: "character/[id]/fund-portfolio",
      run: async () => {
        mockGetAuthUserWithCharacter.mockResolvedValue({ ...characterUser, isAdmin: true });
        return (await import("./character/[id]/fund-portfolio/route")).GET(req("/x"), idParams());
      },
    },
    {
      name: "characters/[id]/subscribe",
      run: async () => {
        mockGetAuthUser.mockResolvedValue(basicUser);
        return (await import("./characters/[id]/subscribe/route")).GET(req("/x"), idParams());
      },
    },
    {
      name: "charters",
      run: async () => {
        okCharacter();
        return (await import("./charters/route")).GET(req("/api/charters?me=true"));
      },
    },
    {
      name: "player-ads",
      run: async () => {
        okCharacter();
        return (await import("./player-ads/route")).GET();
      },
    },
    {
      name: "forex/orders",
      run: async () => {
        okCharacter();
        return (await import("./forex/orders/route")).GET(req("/api/forex/orders"));
      },
    },
    {
      name: "forex/transactions returns 200 with no-store",
      run: async () => {
        okCharacter();
        const res = await (
          await import("./forex/transactions/route")
        ).GET(req("/api/forex/transactions"));
        expect(res.status).toBe(200);
        return res;
      },
    },
    {
      name: "tutorial/context",
      run: async () => {
        okCharacter();
        return (await import("./tutorial/context/route")).GET();
      },
    },
    {
      name: "tutorial/plan",
      run: async () => {
        okCharacter();
        return (await import("./tutorial/plan/route")).GET();
      },
    },
    {
      name: "onboarding/signals",
      run: async () => {
        okCharacter();
        return (await import("./onboarding/signals/route")).GET();
      },
    },
    {
      name: "canvassing/eligibility",
      run: async () => {
        okCharacter();
        return (await import("./canvassing/eligibility/route")).GET();
      },
    },
    {
      name: "actions/poll",
      run: async () => {
        okBasic();
        return (await import("./actions/poll/route")).GET(
          new NextRequest("https://example.test/api/actions/poll")
        );
      },
    },
    {
      name: "actions/recommendations",
      run: async () => {
        okBasic();
        return (await import("./actions/recommendations/route")).GET();
      },
    },
    {
      name: "political-operations/state-org/list",
      run: async () => {
        okCharacter();
        return (await import("./political-operations/state-org/list/route")).GET();
      },
    },
    {
      name: "political-operations/state-org/by-state",
      run: async () => {
        okBasic();
        return (await import("./political-operations/state-org/by-state/[stateId]/route")).GET(
          req("/x"),
          {
            params: Promise.resolve({ stateId: "CA" }),
          }
        );
      },
    },
    {
      name: "corporation/[id]/private-invites",
      run: async () => {
        okBasic();
        return (await import("./corporation/[id]/private-invites/route")).GET(
          req("/x"),
          idParams()
        );
      },
    },
    {
      name: "settings/supporter-requests",
      run: async () => {
        okBasic();
        return (await import("./settings/supporter-requests/route")).GET();
      },
    },
    {
      name: "settings/user-api-keys",
      run: async () => {
        okBasic();
        return (await import("./settings/user-api-keys/route")).GET();
      },
    },
    {
      name: "settings/bot-api-keys",
      run: async () => {
        okBasic();
        return (await import("./settings/bot-api-keys/route")).GET();
      },
    },
    {
      name: "settings/retired-characters",
      run: async () => {
        okBasic();
        return (await import("./settings/retired-characters/route")).GET();
      },
    },
    {
      name: "settings/retired-characters/[id]",
      run: async () => {
        okBasic();
        return (await import("./settings/retired-characters/[id]/route")).GET(
          req("/x"),
          idParams()
        );
      },
    },
    {
      name: "settings/achievements/list",
      run: async () => {
        okBasic();
        return (await import("./settings/achievements/list/route")).GET();
      },
    },
    {
      name: "settings/resignable-positions",
      run: async () => {
        okCharacter();
        return (await import("./settings/resignable-positions/route")).GET();
      },
    },
    {
      name: "game/turn/dashboard returns 404 with no-store when no game state",
      run: async () => {
        okBasic();
        const res = await (await import("./game/turn/dashboard/route")).GET();
        expect(res.status).toBe(404);
        return res;
      },
    },
    {
      name: "news",
      run: async () => {
        mockGetAuthUser.mockResolvedValue(basicUser);
        return (await import("./news/route")).GET(req("/api/news"));
      },
    },
    {
      name: "unions/[id]/leader/vote returns 404 with no-store for an unknown union",
      run: async () => {
        const res = await (
          await import("./unions/[id]/leader/vote/route")
        ).GET(req("/x"), idParams());
        expect(res.status).toBe(404);
        return res;
      },
    },
    {
      name: "wiki/[slug] returns 404 with no-store for an unknown page",
      run: async () => {
        const res = await (
          await import("./wiki/[slug]/route")
        ).GET(req("/api/wiki/x"), {
          params: Promise.resolve({ slug: "x" }),
        });
        expect(res.status).toBe(404);
        return res;
      },
    },
    {
      name: "wiki/search",
      run: async () => (await import("./wiki/search/route")).GET(req("/api/wiki/search?q=x")),
    },
    {
      name: "search/universal as admin",
      run: async () => {
        mockGetAuthUser.mockResolvedValue(adminUser);
        return (await import("./search/universal/route")).GET(req("/api/search/universal?q=ab"));
      },
    },
    {
      name: "suggestions/public",
      run: async () =>
        (await import("./suggestions/public/route")).GET(req("/api/suggestions/public")),
    },
  ])("$name stamps no-store", async ({ run }) => {
    expectNoStore(await run());
  });
});
