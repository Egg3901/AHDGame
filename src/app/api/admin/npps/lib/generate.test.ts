import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const generateNppMock = vi.fn();

vi.mock("@/lib/npp/generator", () => ({
  generateNPP: (args: unknown) => {
    generateNppMock(args);
    const { state, countryId } = args as { state: string; countryId: string };
    return Promise.resolve({
      _id: new ObjectId(),
      sequentialId: 0,
      name: "Test NPP",
      countryId,
      homeState: state,
      politicalInfluence: 10,
      favorability: 50,
      policies: { economic: 0, social: 0 },
      party: "test",
      currentOffice: null,
      personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
      generatedAt: new Date(),
      retiredAt: null,
      influenceState: { totalTimesInfluenced: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  },
  calculateQualityBonus: vi.fn().mockReturnValue(0),
  calculateNPPsToGenerate: vi.fn().mockReturnValue(1),
}));

vi.mock("@/lib/db/sequentialId", () => ({
  getNextSequentialId: vi.fn().mockResolvedValue(12345),
}));

import { handleGenerateNPPs } from "./generate";

interface ElectionFixture {
  _id: ObjectId;
  countryId: string;
  electionType: string;
  state: string;
  status: string;
}

interface PartyFixture {
  sequentialId: number;
  countryId: string;
  isDefault: boolean;
  name: string;
}

function setupMocks(db: MockDb, elections: ElectionFixture[], parties: PartyFixture[]) {
  // elections.find().toArray()
  const electionsCol = db.collection("elections");
  electionsCol.find = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue(elections),
  });
  // politicalParties.find({ isDefault: true }).toArray()
  const partiesCol = db.collection("politicalParties");
  partiesCol.find = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue(parties),
  });
  // electionCandidates.findOne returns null (no existing candidate)
  const candidatesCol = db.collection("electionCandidates");
  candidatesCol.findOne = vi.fn().mockResolvedValue(null);
  // statePartyOrg.findOne returns null (default org)
  const orgCol = db.collection("statePartyOrg");
  orgCol.findOne = vi.fn().mockResolvedValue(null);
}

describe("handleGenerateNPPs (country-agnostic dispatch)", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    generateNppMock.mockClear();
  });

  it("generates DE NPPs for DE Bundestag elections by default", async () => {
    setupMocks(
      db,
      [
        {
          _id: new ObjectId(),
          countryId: "DE",
          electionType: "bundestag",
          state: "BE",
          status: "upcoming",
        },
      ],
      [
        { sequentialId: 10, countryId: "DE", isDefault: true, name: "SPD" },
        { sequentialId: 11, countryId: "DE", isDefault: true, name: "CDU" },
      ]
    );

    await handleGenerateNPPs(db as never, undefined, undefined, undefined);

    const calls = generateNppMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((a) => a.countryId === "DE")).toBe(true);
    const offices = calls.map((a) => a.targetOffice as { type: string; state: string });
    expect(offices.some((o) => o.type === "bundestag" && o.state === "BE")).toBe(true);
  });

  it("dispatches JP shugiin elections to a shugiin targetOffice", async () => {
    setupMocks(
      db,
      [
        {
          _id: new ObjectId(),
          countryId: "JP",
          electionType: "shugiin",
          state: "TKY",
          status: "upcoming",
        },
      ],
      [
        { sequentialId: 20, countryId: "JP", isDefault: true, name: "LDP" },
        { sequentialId: 21, countryId: "JP", isDefault: true, name: "CDP" },
      ]
    );

    await handleGenerateNPPs(db as never, undefined, undefined, undefined);

    const calls = generateNppMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const offices = calls.map((a) => a.targetOffice as { type: string; state: string });
    expect(offices.some((o) => o.type === "shugiin" && o.state === "TKY")).toBe(true);
  });

  it("dispatches UK regionalCouncil elections to regionalCouncil targetOffice", async () => {
    setupMocks(
      db,
      [
        {
          _id: new ObjectId(),
          countryId: "UK",
          electionType: "regionalCouncil",
          state: "LON",
          status: "upcoming",
        },
      ],
      [
        { sequentialId: 30, countryId: "UK", isDefault: true, name: "Labour" },
        { sequentialId: 31, countryId: "UK", isDefault: true, name: "Conservative" },
      ]
    );

    await handleGenerateNPPs(db as never, undefined, undefined, undefined);

    const calls = generateNppMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const offices = calls.map((a) => a.targetOffice as { type: string; state: string });
    expect(offices.some((o) => o.type === "regionalCouncil" && o.state === "LON")).toBe(true);
  });

  it("does not cross-pollinate parties across countries", async () => {
    setupMocks(
      db,
      [
        {
          _id: new ObjectId(),
          countryId: "DE",
          electionType: "bundestag",
          state: "BE",
          status: "upcoming",
        },
        {
          _id: new ObjectId(),
          countryId: "US",
          electionType: "house",
          state: "CA",
          status: "upcoming",
        },
      ],
      [
        { sequentialId: 1, countryId: "US", isDefault: true, name: "Democratic" },
        { sequentialId: 2, countryId: "US", isDefault: true, name: "Republican" },
        { sequentialId: 10, countryId: "DE", isDefault: true, name: "SPD" },
        { sequentialId: 11, countryId: "DE", isDefault: true, name: "CDU" },
      ]
    );

    await handleGenerateNPPs(db as never, undefined, undefined, undefined);

    const calls = generateNppMock.mock.calls.map(
      (c) =>
        c[0] as { state: string; countryId: string; targetOffice: { type: string; state: string } }
    );

    // Every call's countryId must match its state's country
    for (const call of calls) {
      const expectedCountry = call.state === "BE" ? "DE" : "US";
      expect(call.countryId).toBe(expectedCountry);
    }
  });

  it("legacy partyFilter resolves countryId from the party doc", async () => {
    setupMocks(
      db,
      [
        {
          _id: new ObjectId(),
          countryId: "DE",
          electionType: "bundestag",
          state: "BE",
          status: "upcoming",
        },
      ],
      [{ sequentialId: 10, countryId: "DE", isDefault: true, name: "SPD" }]
    );

    await handleGenerateNPPs(db as never, undefined, ["10"], undefined);

    const calls = generateNppMock.mock.calls.map((c) => c[0] as { countryId: string });
    expect(calls.some((a) => a.countryId === "DE")).toBe(true);
  });
});
