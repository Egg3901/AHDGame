/**
 * Ticket #1183 — the Actions-page crisis card offered every global-response
 * option as clickable, including ones the nation cannot meet the campaign
 * requirement for. Clicking one is a guaranteed refusal. The crisis detail page
 * already greys those out from `campaignBrief.optionAvailability`; this feed has
 * to carry the same verdict so both surfaces agree.
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

let db: MockDb;

const crisisId = new ObjectId();
const characterId = new ObjectId();

const BLOC_OPTIONS = [
  {
    optionId: "allied_support",
    label: "Support the alliance line",
    description: "Contribute money, logistics, and diplomatic backing.",
    nextNodeId: null,
    effects: [],
    campaignRequirement: {
      allowedStages: ["posture", "mobilization", "operations"],
      minMilitaryReadiness: 42,
      minLogistics: 38,
    },
  },
  {
    optionId: "allied_mediation",
    label: "Demand negotiations",
    description: "Press the alliance toward talks.",
    nextNodeId: null,
    effects: [],
  },
];

const NODE = {
  nodeId: "response",
  type: "choice" as const,
  title: "Berlin Crisis: the alliance consults",
  description: "The alliance wants a common position.",
  requiredRoles: ["headOfState"],
  timeLimitMinutes: 1440,
  options: BLOC_OPTIONS,
  optionsByRole: { bloc: BLOC_OPTIONS },
};

function makeCrisis() {
  return {
    _id: crisisId,
    name: "Berlin Crisis",
    description: "Governments are called to respond.",
    scope: "global",
    countryIds: [],
    regionIds: [],
    status: "active",
    startTurn: 1,
    effects: [],
    interactionDefinition: { decisionTree: [NODE] },
    globalResponse: {
      conflictKey: "berlin",
      eventKey: "berlin_bloc",
      roleByCountry: { US: "bloc" },
      defaultOptionIdByRole: { bloc: "allied_mediation" },
      outcomes: [],
      defaultOutcomeId: "stalemate",
    },
  };
}

function makeInteraction() {
  return {
    _id: new ObjectId(),
    crisisId,
    decisionTree: [NODE],
    currentNodeId: "response",
    resolutionPath: [],
    contributors: [],
    collectiveCurrent: 0,
    collectiveTarget: null,
    decisionDeadline: null,
    resolvedAt: null,
    leaderResponses: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function get() {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost/api/crises/active-for-character"));
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  [
    "crises",
    "crisisInteractions",
    "livingConflicts",
    "federalBudget",
    "governmentApprovals",
    "militaryUnits",
  ].forEach((c) => db.collection(c));

  db.collectionMocks["crises"]!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([makeCrisis()]),
  });
  db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(makeInteraction());
  db.collectionMocks["livingConflicts"]!.findOne.mockResolvedValue(null);
  db.collectionMocks["federalBudget"]!.findOne.mockResolvedValue({
    countryId: "US",
    gdp: 1_000_000_000_000,
    treasuryBalance: 50_000_000_000,
  });
  db.collectionMocks["governmentApprovals"]!.findOne.mockResolvedValue({ approvalRating: 60 });

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: {
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
        homeState: "US-NY",
        currentOffice: { type: "president" },
      },
    },
  } as unknown as Awaited<ReturnType<typeof requireAuthWithCharacter>>);
});

describe("GET /api/crises/active-for-character — option availability", () => {
  it("marks an option the nation cannot support as ineligible, with the reason", async () => {
    const res = await get();
    const body = (await res.json()) as {
      crises: Array<{
        optionAvailability: Record<string, { eligible: boolean; reasons: string[] }> | null;
      }>;
    };

    const availability = body.crises[0]?.optionAvailability;
    expect(availability?.allied_support?.eligible).toBe(false);
    expect(availability?.allied_support?.reasons.join(" ")).toMatch(/military readiness 42/);
  });

  it("leaves an option with no campaign requirement eligible", async () => {
    const res = await get();
    const body = (await res.json()) as {
      crises: Array<{
        optionAvailability: Record<string, { eligible: boolean; reasons: string[] }> | null;
      }>;
    };

    expect(body.crises[0]?.optionAvailability?.allied_mediation?.eligible).toBe(true);
  });
});

describe("GET /api/crises/active-for-character — query volume", () => {
  it("loads the nation's capability once no matter how many global responses are open", async () => {
    // Capability is country-scoped: budget, approval and military rows are the
    // same for every crisis in one request. Reloading them per crisis multiplies
    // a militaryUnits scan across a feed every player polls each minute.
    const second = { ...makeCrisis(), _id: new ObjectId() };
    db.collectionMocks["crises"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeCrisis(), second]),
    });

    const res = await get();
    const body = (await res.json()) as { crises: unknown[] };

    expect(body.crises).toHaveLength(2);
    expect(db.collectionMocks["federalBudget"]!.findOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["governmentApprovals"]!.findOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["militaryUnits"]!.find).toHaveBeenCalledTimes(1);
  });
});

// ── Aid nodes outlive the flag that created them (audit) ───────────────────
// createCrisisInteraction promotes a choice node to an `aid` node only while
// crisisAidBillsEnabled is on, but the promoted tree is stored on the
// interaction. Turn the flag off and those nodes stay `aid` while the interact
// route refuses them with "Aid bills are not enabled" and the crisis page
// renders no controls. Advertising the prompt as actionable is then a lie.

describe("GET /api/crises/active-for-character — aid nodes with aid bills off", () => {
  const AID_NODE = {
    ...NODE,
    type: "aid" as const,
    requiredRoles: ["headOfState"],
    optionsByRole: undefined,
    options: [
      { optionId: "aid_skip", label: "No Aid", description: "No contribution.", effects: [] },
      { optionId: "aid_contribute", label: "Send Aid", description: "Contribute.", effects: [] },
    ],
  };

  function stubAidCrisis() {
    const crisis = {
      ...makeCrisis(),
      scope: "country",
      countryIds: ["US"],
      globalResponse: undefined,
      interactionDefinition: { decisionTree: [AID_NODE] },
    };
    db.collectionMocks["crises"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([crisis]),
    });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue({
      ...makeInteraction(),
      decisionTree: [AID_NODE],
    });
  }

  it("does not offer the prompt when aid bills are disabled", async () => {
    const { isCrisisAidBillsEnabled } = await import("@/lib/crises/featureFlag");
    vi.mocked(isCrisisAidBillsEnabled).mockResolvedValue(false);
    stubAidCrisis();

    const res = await get();
    const body = (await res.json()) as { crises: Array<{ canInteract: boolean }> };

    expect(body.crises).toHaveLength(0);
  });

  it("offers the prompt when aid bills are enabled", async () => {
    const { isCrisisAidBillsEnabled } = await import("@/lib/crises/featureFlag");
    vi.mocked(isCrisisAidBillsEnabled).mockResolvedValue(true);
    stubAidCrisis();

    const res = await get();
    const body = (await res.json()) as { crises: Array<{ canInteract: boolean }> };

    expect(body.crises).toHaveLength(1);
    expect(body.crises[0]!.canInteract).toBe(true);
  });
});

/**
 * Players reported active recessions they never saw. `shouldShowCrisisOnActionsPage`
 * dropped any crisis whose prompt the character could not take, so a Recession —
 * whose only node is gated on `headOfState` — was invisible to everyone in the
 * country but its leader, and invisible to the leader too once they answered,
 * while it went on draining GDP, employment, confidence and approval for the rest
 * of its run. It must stay on the page as an effects-only card.
 */
describe("GET /api/crises/active-for-character — an active crisis the character cannot act on", () => {
  const STIMULUS_NODE = {
    nodeId: "stimulus",
    type: "choice" as const,
    title: "Recession response",
    description: "The economy is in recession. What is your fiscal response?",
    requiredRoles: ["headOfState"],
    timeLimitMinutes: null,
    options: [
      { optionId: "stimulus_austerity", label: "Austerity", description: "Cut.", effects: [] },
    ],
    optionsByRole: undefined,
  };

  const RECESSION_EFFECT = {
    effectType: "tick" as const,
    targetType: "metric" as const,
    metricCategory: "economic",
    metricField: "gdpGrowth",
    sectorType: null,
    strategyId: null,
    value: -0.66,
    label: "GDP contraction from recession",
  };

  function stubRecession(interactionOverrides: Record<string, unknown> = {}) {
    db.collectionMocks["crises"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          ...makeCrisis(),
          name: "Recession",
          scope: "country",
          countryIds: ["US"],
          effects: [RECESSION_EFFECT],
          globalResponse: undefined,
          interactionDefinition: { decisionTree: [STIMULUS_NODE] },
        },
      ]),
    });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue({
      ...makeInteraction(),
      decisionTree: [STIMULUS_NODE],
      currentNodeId: "stimulus",
      ...interactionOverrides,
    });
  }

  /** Re-auth as an ordinary backbencher who holds no executive role. */
  async function authAsBackbencher() {
    ["governmentFormations", "electedOfficials"].forEach((c) => db.collection(c));
    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "backbencher",
        email: "backbencher@example.com",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: {
          _id: characterId,
          name: "Test Backbencher",
          countryId: "US",
          homeState: "US-NY",
          currentOffice: { type: "houseRep" },
        },
      },
    } as unknown as Awaited<ReturnType<typeof requireAuthWithCharacter>>);
  }

  it("shows the crisis to a player who cannot answer it, without the prompt", async () => {
    stubRecession();
    await authAsBackbencher();

    const res = await get();
    const body = (await res.json()) as {
      crises: Array<{
        crisis: { name: string; effects: unknown[] };
        currentNode: unknown;
        canInteract: boolean;
      }>;
    };

    expect(body.crises).toHaveLength(1);
    expect(body.crises[0]!.crisis.name).toBe("Recession");
    expect(body.crises[0]!.crisis.effects).toHaveLength(1);
    // The decision is not theirs, so it is stripped — but they still see the hit.
    expect(body.crises[0]!.canInteract).toBe(false);
    expect(body.crises[0]!.currentNode).toBeNull();
  });

  it("keeps the crisis on the leader's page after they have answered it", async () => {
    stubRecession({ resolvedAt: new Date(), currentNodeId: null });

    const res = await get();
    const body = (await res.json()) as {
      crises: Array<{ crisis: { name: string }; canInteract: boolean }>;
    };

    expect(body.crises).toHaveLength(1);
    expect(body.crises[0]!.crisis.name).toBe("Recession");
    expect(body.crises[0]!.canInteract).toBe(false);
  });

  it("still offers the prompt to the leader while it is unanswered", async () => {
    stubRecession();

    const res = await get();
    const body = (await res.json()) as {
      crises: Array<{ canInteract: boolean; currentNode: { nodeId: string } | null }>;
    };

    expect(body.crises).toHaveLength(1);
    expect(body.crises[0]!.canInteract).toBe(true);
    expect(body.crises[0]!.currentNode?.nodeId).toBe("stimulus");
  });
});

/**
 * The feed carries the same interaction document the crisis page reads, so it
 * has to redact the same things — otherwise the Actions poll is the cheaper way
 * to read a ledger the crisis page deliberately hides — and it has to put a
 * decision the character can actually take above the ambient cards that now
 * accompany it.
 */
describe("GET /api/crises/active-for-character — redaction and ordering", () => {
  const OTHERS_COVERT = {
    countryId: "RU",
    characterId: new ObjectId(),
    characterName: "Other Leader",
    nodeId: "response",
    optionId: "allied_support",
    optionLabel: "Support the alliance line",
    visibility: "covert" as const,
    respondedAt: new Date(),
  };

  it("redacts another government's covert choice", async () => {
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue({
      ...makeInteraction(),
      leaderResponses: [OTHERS_COVERT],
    });

    const res = await get();
    const body = (await res.json()) as {
      crises: Array<{
        interaction: { leaderResponses: Array<{ optionId: string; optionLabel: string }> } | null;
      }>;
    };

    const responses = body.crises[0]!.interaction!.leaderResponses;
    expect(responses[0]!.optionId).toBe("undisclosed");
    expect(responses[0]!.optionLabel).toBe("Undisclosed action");
  });

  it("sends no response ledger at all once the leader has answered", async () => {
    // Having answered, they can no longer act, so the entry survives only as an
    // ambient card and the whole interaction is stripped. The full ledger, with
    // their own covert choice legible, stays on the crisis page.
    db.collectionMocks["crises"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          ...makeCrisis(),
          effects: [{ effectType: "tick", targetType: "metric", value: -0.2, label: "drag" }],
        },
      ]),
    });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue({
      ...makeInteraction(),
      leaderResponses: [{ ...OTHERS_COVERT, countryId: "US" }],
    });

    const res = await get();
    const body = (await res.json()) as {
      crises: Array<{
        crisis: { interactionDefinition?: unknown };
        interaction: unknown;
        canInteract: boolean;
        currentNode: unknown;
      }>;
    };

    expect(body.crises).toHaveLength(1);
    expect(body.crises[0]!.canInteract).toBe(false);
    expect(body.crises[0]!.interaction).toBeNull();
    expect(body.crises[0]!.currentNode).toBeNull();
    expect(body.crises[0]!.crisis.interactionDefinition).toBeUndefined();
  });

  it("puts the decision the leader can take above the ambient cards", async () => {
    const ambientId = new ObjectId();
    db.collectionMocks["crises"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        // Ambient, and newer — it would sort first on recency alone.
        {
          ...makeCrisis(),
          _id: ambientId,
          name: "Trade War",
          scope: "global",
          startTurn: 99,
          effects: [{ effectType: "tick", targetType: "metric", value: -0.2, label: "drag" }],
          globalResponse: undefined,
          interactionDefinition: undefined,
        },
        { ...makeCrisis(), startTurn: 1 },
      ]),
    });
    db.collectionMocks["crisisInteractions"]!.findOne.mockImplementation(
      async (filter: { crisisId: ObjectId }) =>
        filter.crisisId.equals(crisisId) ? makeInteraction() : null
    );

    const res = await get();
    const body = (await res.json()) as {
      crises: Array<{ crisis: { name: string }; canInteract: boolean }>;
    };

    expect(body.crises).toHaveLength(2);
    expect(body.crises[0]!.canInteract).toBe(true);
    expect(body.crises[0]!.crisis.name).toBe("Berlin Crisis");
    expect(body.crises[1]!.crisis.name).toBe("Trade War");
  });
});

describe("GET /api/crises/active-for-character — a character with no country", () => {
  it("sends no response ledger at all", async () => {
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue({
      ...makeInteraction(),
      leaderResponses: [
        {
          countryId: "RU",
          characterId: new ObjectId(),
          characterName: "Other Leader",
          nodeId: "response",
          optionId: "allied_support",
          optionLabel: "Support the alliance line",
          visibility: "covert" as const,
          respondedAt: new Date(),
        },
      ],
    });
    db.collectionMocks["crises"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          ...makeCrisis(),
          globalResponse: undefined,
          effects: [{ effectType: "tick", targetType: "metric", value: -0.2, label: "drag" }],
        },
      ]),
    });
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "stateless",
        email: "stateless@example.com",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: {
          _id: characterId,
          name: "Stateless",
          countryId: undefined,
          homeState: undefined,
          currentOffice: { type: "president" },
        },
      },
    } as unknown as Awaited<ReturnType<typeof requireAuthWithCharacter>>);

    const res = await get();
    const body = (await res.json()) as {
      crises: Array<{ interaction: { leaderResponses: unknown[] } | null }>;
    };

    expect(body.crises).toHaveLength(1);
    expect(body.crises[0]!.interaction?.leaderResponses ?? []).toEqual([]);
  });
});
