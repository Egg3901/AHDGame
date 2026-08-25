import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/crises/featureFlag", () => ({
  isCrisisInteractionEnabled: vi.fn(async () => true),
  isCrisisAidBillsEnabled: vi.fn(async () => true),
}));
vi.mock("@/lib/crises/interactionEngine", () => ({
  submitCrisisDecision: vi.fn(),
  resolveCharacterRoles: vi.fn(async () => ["any", "headOfState"]),
  getCrisisInteraction: vi.fn(),
}));

const crisisId = new ObjectId();
const characterId = new ObjectId();

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/crises/${crisisId.toString()}/interact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  return POST(makeRequest(body), { params: Promise.resolve({ id: crisisId.toString() }) });
}

describe("POST /api/crises/[id]/interact", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({} as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "lynetters",
        isAdmin: false,
        character: {
          _id: characterId,
          name: "Sarah Spencer",
          countryId: "IT",
        },
      },
    } as never);

    const { getCrisisInteraction } = await import("@/lib/crises/interactionEngine");
    vi.mocked(getCrisisInteraction).mockResolvedValue({
      _id: new ObjectId(),
      crisisId,
      currentNodeId: "ultimatum_consultation_global_response",
      resolvedAt: null,
      decisionTree: [
        {
          nodeId: "ultimatum_consultation_global_response",
          type: "choice",
          title: "Berlin Crisis: governments are called to respond",
          description: "Access rights are contested.",
          requiredRoles: ["headOfState"],
          options: [],
        },
      ],
    } as never);
  });

  it("returns the engine's player-facing rejection as a 400 with its message", async () => {
    const { submitCrisisDecision } = await import("@/lib/crises/interactionEngine");
    vi.mocked(submitCrisisDecision).mockRejectedValue(
      new Error(
        "National capacity is insufficient: Needs 0.02% of GDP in treasury capacity; Needs logistics 38"
      )
    );

    const res = await post({ optionId: "allied_support" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error:
        "National capacity is insufficient: Needs 0.02% of GDP in treasury capacity; Needs logistics 38",
    });
  });

  it("still routes genuine faults (db errors) to the 500 capture path", async () => {
    const { submitCrisisDecision } = await import("@/lib/crises/interactionEngine");
    vi.mocked(submitCrisisDecision).mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );

    const res = await post({ optionId: "allied_support" });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  });

  it("returns the decision result on success", async () => {
    const { submitCrisisDecision } = await import("@/lib/crises/interactionEngine");
    vi.mocked(submitCrisisDecision).mockResolvedValue({
      interaction: { _id: new ObjectId() } as never,
      nextNode: null,
      appliedEffects: [],
    });

    const res = await post({ optionId: "allied_mediation" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      interaction: { _id: expect.any(String) },
      nextNode: null,
      appliedEffects: [],
    });
  });
});
