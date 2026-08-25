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
