/**
 * Turn dashboard poll-cost parity (#1724 follow-up to the merged Poll slice #1973).
 *
 * The dashboard's `actionCosts` map must derive `poll` / `pollLarge` from the
 * canonical Poll owner (`getPollActionCost` in `src/lib/actions/rules.ts`,
 * re-exported through `@/lib/actions`) instead of restating the literals.
 * The override test below fails against hardcoded `poll: 2, pollLarge: 6`:
 * it moves the canonical cost test-only and requires the dashboard to follow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeCharacter } from "@/lib/test-utils/factories";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getGameState } from "@/lib/gameState";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getGameTime } from "@/lib/time/gameTime";
import type { PollTier } from "@/lib/actions/rules";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));

// Test-only canonical-cost override. Null means "use the real shared owner".
let pollOverride: ((tier: PollTier) => number) | null = null;
vi.mock("@/lib/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions")>();
  return {
    ...actual,
    getPollActionCost: (tier: PollTier) =>
      pollOverride ? pollOverride(tier) : actual.getPollActionCost(tier),
  };
});

describe("turn dashboard poll action costs", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    pollOverride = null;
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const character = makeCharacter({ actions: 10 });
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: character.userId.toString() },
    } as never);
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 10,
      currentYear: 2026,
      isActive: true,
      pausedAt: null,
    } as never);
    vi.mocked(isForexEnabled).mockResolvedValue(false);
    vi.mocked(getGameTime).mockResolvedValue({ currentTurn: 10 } as never);
    db.collection("characters").findOne.mockResolvedValue(character);
  });

  it("reports the canonical shared Poll AP costs", async () => {
    const { getPollActionCost } = await import("@/lib/actions");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.actionCosts.poll).toBe(getPollActionCost("small"));
    expect(body.actionCosts.pollLarge).toBe(getPollActionCost("large"));
  });

  it("follows a test-only canonical Poll cost move (no dashboard literals)", async () => {
    pollOverride = (tier) => (tier === "large" ? 22 : 11);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.actionCosts.poll).toBe(11);
    expect(body.actionCosts.pollLarge).toBe(22);
  });
});
