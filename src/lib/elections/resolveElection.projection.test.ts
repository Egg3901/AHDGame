/**
 * Regression for #2168: election summary views must not deserialize full
 * 31KB NPP stance maps (or full character / gameState documents) to render
 * candidate summary cards.
 *
 * Strategy: synthetic representative data (an NPP whose
 * `policies.domainPositions` is ~30KB, like production) through the real
 * `resolveElections` / `resolveElection` / `fetchDepsForElection` paths with
 * a mock Db that captures `find` options. The defect is observable as
 * missing `projection` args on the summary-mode reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  makeCandidate,
  makeCharacter,
  makeElection,
  makeNPP,
  makeParty,
} from "@/lib/test-utils/factories";
import { getGameTime } from "@/lib/time/gameTime";
import { fetchDepsForElection } from "./enrichElection";
import { resolveElection, resolveElections } from "./resolveElection";

vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(() => {
    throw new Error("Unexpected ambient database read");
  }),
}));
// These fixtures are Senate primaries; district resolution is not reached.
vi.mock("@/lib/redistricting/districtedHouseResolution", () => ({
  districtedHouseResolution: vi.fn(() => {
    throw new Error("Unexpected district resolution");
  }),
}));

const HEAVY_DOMAIN_POSITIONS: Record<string, number> = {};
for (let i = 0; i < 1500; i++) {
  HEAVY_DOMAIN_POSITIONS[`policy_domain_${i}_stance`] = (i % 201) - 100;
}

// Apply the actual requested read shape so enrichment assertions cannot pass
// merely because a mock returned fields the database would have omitted.
function projectFixture(doc: object, projection?: Record<string, number>): object {
  if (!projection) return doc;
  const input = doc as Record<string, unknown>;
  if (projection["policies.domainPositions"] === 0) {
    const policies = { ...(input.policies as Record<string, unknown>) };
    delete policies.domainPositions;
    return { ...input, policies };
  }
  const output: Record<string, unknown> = { _id: input._id };
  for (const [field, included] of Object.entries(projection)) {
    if (!included) continue;
    const [parent, child] = field.split(".");
    if (child) {
      const nested = input[parent] as Record<string, unknown> | undefined;
      output[parent] = { ...(output[parent] as object), [child]: nested?.[child] };
    } else if (parent in input) output[parent] = input[parent];
  }
  return output;
}

function setupSummaryWorld() {
  const db = createMockDb();
  // Active primary: displayCandidates keeps the whole field (upcoming races
  // go through general-phase top-N dedup, which would drop a candidate).
  const election = makeElection({
    electionType: "senate",
    state: "CA",
    status: "active",
    startTurn: 1,
    primaryEndTurn: 30,
  });

  const char = makeCharacter({
    name: "Player One",
    party: "1",
    homeState: "CA",
    avatarUrl: "https://cdn.test/avatar.png",
    sequentialId: 42,
    policies: { economic: 2, social: -1 },
    favorability: 60,
    politicalInfluence: 40,
    nationalInfluence: 10,
    partyInfluence: 20,
    infamy: 5,
  });
  const npp = makeNPP({
    name: "NPP Ron",
    party: "1",
    homeState: "CA",
    sequentialId: 7,
    avatarUrl: "https://cdn.test/npp.png",
    policies: { economic: -2, social: 1, domainPositions: HEAVY_DOMAIN_POSITIONS },
    favorability: 55,
    politicalInfluence: 30,
  });
  const playerCandidate = makeCandidate({
    electionId: election._id,
    characterId: char._id,
    characterName: "Player One",
    party: "1",
    status: "active",
    isNPP: false,
  });
  const nppCandidate = makeCandidate({
    electionId: election._id,
    characterId: new ObjectId(),
    characterName: "NPP Ron",
    party: "1",
    status: "active",
    isNPP: true,
    nppId: npp._id,
  });
  const party = makeParty({
    sequentialId: 1,
    name: "Democrats",
    abbreviation: "DEM",
    color: "#0000FF",
    economicPosition: 0,
    socialPosition: 0,
  });
  const gameStateDoc = {
    _id: "current",
    preset: "1990",
    currentYear: 1992,
    currentTurn: 10,
    isActive: true,
  };

  const col = (name: string) => db.collection(name);
  col("electionCandidates").find.mockReturnValue({
    toArray: async () => [playerCandidate, nppCandidate],
  });
  col("characters").find.mockImplementation(
    (_filter: unknown, options?: { projection?: Record<string, number> }) => ({
      toArray: async () => [projectFixture(char, options?.projection)],
    })
  );
  col("npps").find.mockImplementation(
    (_filter: unknown, options?: { projection?: Record<string, number> }) => ({
      toArray: async () => [projectFixture(npp, options?.projection)],
    })
  );
  col("politicalParties").find.mockReturnValue({ toArray: async () => [party] });
  col("electionVoteTallies").find.mockReturnValue({ toArray: async () => [] });
  col("gameState").findOne.mockImplementation(
    async (_filter: unknown, options?: { projection?: Record<string, number> }) =>
      projectFixture(gameStateDoc, options?.projection)
  );
  col("elections").findOne.mockResolvedValue(election);

  return { db, election, char, npp, playerCandidate, nppCandidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGameTime).mockResolvedValue({
    currentTurn: 10,
    effectiveNow: new Date("2025-06-15T00:00:00Z"),
  } as never);
});

/** True when the projection guarantees `policies.domainPositions` never crosses the wire. */
function omitsDomainPositions(projection: unknown): boolean {
  if (!projection || typeof projection !== "object") return false;
  const entries = Object.entries(projection as Record<string, unknown>);
  if (entries.length === 0) return false;
  // Exclusion style must name the heavy field; pure inclusion style omits it implicitly.
  if (entries.some(([, v]) => v === 0)) {
    return (projection as Record<string, unknown>)["policies.domainPositions"] === 0;
  }
  return true;
}

describe("issue #2168 summary projections", () => {
  it("documents the defect magnitude: synthetic stance map is tens of KB", () => {
    const bytes = Buffer.byteLength(JSON.stringify(HEAVY_DOMAIN_POSITIONS));
    expect(bytes).toBeGreaterThan(20_000);
  });

  it("resolveElections summary omits policies.domainPositions from every NPP read", async () => {
    const { db, election } = setupSummaryWorld();
    await resolveElections(db as unknown as Db, [election], {
      view: "summary",
      userId: null,
    });
    const calls = (db as MockDb).collectionMocks["npps"].find.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, options] of calls) {
      expect(options?.projection, "NPP read must project away the stance map").toSatisfy(
        omitsDomainPositions
      );
    }
  });

  it("resolveElections summary projects the candidate-batch character read", async () => {
    const { db, election } = setupSummaryWorld();
    await resolveElections(db as unknown as Db, [election], {
      view: "summary",
      userId: null,
    });
    const calls = (db as MockDb).collectionMocks["characters"].find.mock.calls;
    const batchCall = calls.find(([filter]) => filter && "_id" in (filter as object));
    expect(batchCall, "expected a batch character read by _id").toBeDefined();
    expect(batchCall![1]?.projection).toMatchObject({
      name: 1,
      party: 1,
      favorability: 1,
      politicalInfluence: 1,
      nationalInfluence: 1,
      partyInfluence: 1,
      infamy: 1,
      homeState: 1,
      avatarUrl: 1,
      sequentialId: 1,
      countryId: 1,
      currentOffice: 1,
      targetedAds: 1,
      "policies.economic": 1,
      "policies.social": 1,
    });
  });

  it("resolveElections summary projects the gameState read", async () => {
    const { db, election } = setupSummaryWorld();
    await resolveElections(db as unknown as Db, [election], {
      view: "summary",
      userId: null,
    });
    const calls = (db as MockDb).collectionMocks["gameState"].findOne.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][1]?.projection).toMatchObject({
      preset: 1,
      currentYear: 1,
      redistrictingEnabled: 1,
    });
  });

  it("resolveElection single-summary projects gameState, characters and NPPs", async () => {
    const { db, election } = setupSummaryWorld();
    const result = await resolveElection(db as unknown as Db, election._id.toString(), {
      view: "summary",
      userId: null,
    });
    expect(result).not.toBeNull();
    const mocks = (db as MockDb).collectionMocks;
    expect(mocks["gameState"].findOne.mock.calls[0][1]?.projection).toBeDefined();
    for (const [, options] of mocks["npps"].find.mock.calls) {
      expect(options?.projection).toSatisfy(omitsDomainPositions);
    }
    const batchCall = mocks["characters"].find.mock.calls.find(
      ([filter]) => filter && "_id" in (filter as object)
    );
    expect(batchCall?.[1]?.projection).toBeDefined();
  });

  it("summary enrichment still renders every candidate field from projected docs", async () => {
    const { db, election } = setupSummaryWorld();
    const [resolved] = await resolveElections(db as unknown as Db, [election], {
      view: "summary",
      userId: null,
    });
    expect(resolved).toBeDefined();
    const byName = new Map(resolved.candidates.map((c) => [c.characterName, c]));
    expect(byName.get("NPP Ron")?.economicPosition).toBe(-2);
    expect(byName.get("NPP Ron")?.socialPosition).toBe(1);
    expect(byName.get("NPP Ron")?.favorability).toBe(55);
    expect(byName.get("NPP Ron")?.avatarUrl).toBe("https://cdn.test/npp.png");
    expect(byName.get("Player One")?.economicPosition).toBe(2);
    expect(byName.get("Player One")?.favorability).toBe(60);
    expect(byName.get("Player One")?.avatarUrl).toBe("https://cdn.test/avatar.png");
    expect(resolved.polling).not.toBeNull();
    expect(resolved.byParty).toHaveLength(1);
    expect(resolved.incumbent).toBeNull();
  });

  it("fetchDepsForElection full view keeps character and NPP reads unprojected", async () => {
    const { db, election } = setupSummaryWorld();
    await fetchDepsForElection(db as unknown as Db, election, "full");
    const mocks = (db as MockDb).collectionMocks;
    for (const [, options] of mocks["npps"].find.mock.calls) {
      expect(options?.projection ?? null).toBeNull();
    }
    for (const [, options] of mocks["characters"].find.mock.calls) {
      // The single-seat incumbent lookup carries its own narrow projection;
      // the candidate batch read must stay whole in full view.
      if (options?.projection) {
        expect(options.projection).toMatchObject({ name: 1, party: 1 });
      }
    }
    const batchCall = mocks["characters"].find.mock.calls.find(
      ([filter]) => filter && "_id" in (filter as object)
    );
    expect(batchCall?.[1]?.projection ?? null).toBeNull();
  });
});
