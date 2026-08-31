/**
 * Ticket #1183 — "Won't let me respond to international crisis".
 *
 * Every refusal on this endpoint used to reach the player as HTTP 500
 * "Internal server error", because the interaction engine threw bare Errors and
 * handleRouteError maps anything that is not an ApiError to a generic 500 (and
 * reports it to Sentry as a fault). The player could not tell an unmet capacity
 * requirement from an outage. These tests pin the status/message contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/crises/featureFlag", () => ({
  isCrisisInteractionEnabled: vi.fn().mockResolvedValue(true),
  isCrisisAidBillsEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));

let db: MockDb;

const crisisId = new ObjectId();
const interactionId = new ObjectId();
const characterId = new ObjectId();

function makeUser(office: string | null = "president") {
  return {
    userId: new ObjectId().toString(),
    username: "leader",
    email: "leader@example.com",
    role: "user",
    isAdmin: false,
    hasCharacter: true,
    character: {
      _id: characterId,
      name: "Test Leader",
      countryId: "US",
      currentOffice: office ? { type: office } : null,
    },
  };
}

const NODE = {
  nodeId: "response",
  type: "choice" as const,
  title: "Berlin Crisis: the alliance consults",
  description: "The alliance wants a common position.",
  requiredRoles: ["headOfState"],
  timeLimitMinutes: 1440,
  options: [
    {
      optionId: "allied_mediation",
      label: "Demand negotiations",
      description: "Press the alliance toward talks.",
      nextNodeId: null,
      effects: [],
    },
  ],
};

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    _id: interactionId,
    crisisId,
    decisionTree: [NODE],
    currentNodeId: "response",
    resolutionPath: [],
    contributors: [],
    collectiveCurrent: 0,
    collectiveTarget: null,
    decisionDeadline: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCrisis() {
  return {
    _id: crisisId,
    name: "Berlin Crisis",
    scope: "global",
    countryIds: [],
    regionIds: [],
    status: "active",
    startTurn: 1,
    effects: [],
  };
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  return POST(
    new Request(`http://localhost/api/crises/${crisisId.toString()}/interact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: crisisId.toString() }) }
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  ["crisisInteractions", "crises", "states", "federalBudget", "characters"].forEach((c) =>
    db.collection(c)
  );
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: makeUser(),
  } as unknown as Awaited<ReturnType<typeof requireAuthWithCharacter>>);
  db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(makeInteraction());
  db.collectionMocks["crises"]!.findOne.mockResolvedValue(makeCrisis());
});

describe("POST /api/crises/[id]/interact — refusals are readable", () => {
  it("answers an unknown option with 400 and names the problem", async () => {
    const res = await post({ optionId: "no_such_option" });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid option" });
  });

  it("answers a character without the office with 403, not a server error", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: makeUser(null),
    } as unknown as Awaited<ReturnType<typeof requireAuthWithCharacter>>);

    const res = await post({ optionId: "allied_mediation" });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/not authorized/i),
    });
  });

  it("answers a country that already responded with 409, not a server error", async () => {
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(
      makeInteraction({
        leaderResponses: [
          {
            countryId: "US",
            characterId: new ObjectId(),
            characterName: "Prior Leader",
            nodeId: "response",
            optionId: "allied_mediation",
            optionLabel: "Demand negotiations",
            respondedAt: new Date(),
          },
        ],
      })
    );

    const res = await post({ optionId: "allied_mediation" });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/already responded/i),
    });
  });

  it("answers a resolved crisis with 409, not a server error", async () => {
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(
      makeInteraction({ resolvedAt: new Date(), currentNodeId: null })
    );

    const res = await post({ optionId: "allied_mediation" });

    expect(res.status).toBe(409);
  });
});
