import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/elections/phases", () => ({ isPrimaryEnded: vi.fn() }));
vi.mock("@/lib/elections/primaryPartyDetail", () => ({
  buildPrimaryViewerCampaign: vi.fn(),
}));

const ELECTION_ID = new ObjectId();
const CHAR_ID = new ObjectId();

const ELECTION = {
  _id: ELECTION_ID,
  electionType: "president",
  countryId: "US",
  status: "active",
} as never;

const CHARACTER = { _id: CHAR_ID, name: "Filer", actions: 25, countryId: "US" } as never;

/** Minimal stub: the builder reads one candidate row, the states and gameState. */
function stubDb(over: { candidate?: unknown | null } = {}): Db {
  const candidate =
    over.candidate === undefined
      ? { _id: new ObjectId(), primaryCampaignState: "IA", travelState: "OH" }
      : over.candidate;
  return {
    collection: (name: string) => ({
      findOne: async () =>
        name === "electionCandidates"
          ? candidate
          : name === "gameState"
            ? { _id: "current", preset: "1953-default" }
            : null,
      find: () => ({
        toArray: async () =>
          name === "states"
            ? [
                { _id: "IA", name: "Iowa" },
                { _id: "OH", name: "Ohio" },
              ]
            : [],
      }),
    }),
  } as unknown as Db;
}

async function build(db: Db, election: unknown = ELECTION, character: unknown = CHARACTER) {
  const { buildCampaignStatePresence } = await import("./campaignStatePresence");
  return buildCampaignStatePresence(db, {
    election: election as never,
    character: character as never,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { getGameTime } = await import("@/lib/time/gameTime");
  vi.mocked(getGameTime).mockResolvedValue({ currentTurn: 20, effectiveNow: new Date() } as never);

  const { buildPrimaryViewerCampaign } = await import("@/lib/elections/primaryPartyDetail");
  vi.mocked(buildPrimaryViewerCampaign).mockResolvedValue({
    currentCampaignState: "IA",
    currentTicks: 3,
  } as never);
});

async function setPhase(ended: boolean) {
  const { isPrimaryEnded } = await import("@/lib/elections/phases");
  vi.mocked(isPrimaryEnded).mockReturnValue(ended);
}

describe("buildCampaignStatePresence", () => {
  it("offers camping and the surge while the primary is running", async () => {
    await setPhase(false);
    const presence = await build(stubDb());

    expect(presence?.phase).toBe("primary");
    expect(presence?.currentStateId).toBe("IA");
    expect(presence?.currentStateName).toBe("Iowa");
    expect(presence?.primary?.currentCampaignState).toBe("IA");
  });

  it("offers travel once the primary is over, reading the travel state", async () => {
    await setPhase(true);
    const presence = await build(stubDb());

    expect(presence?.phase).toBe("general");
    expect(presence?.currentStateId).toBe("OH");
    expect(presence?.currentStateName).toBe("Ohio");
    // Camp and surge belong to the primary; the general has travel instead.
    expect(presence?.primary).toBeNull();
  });

  it("names and prices every state it offers", async () => {
    await setPhase(true);
    const presence = await build(stubDb());

    const iowa = presence?.states.find((s) => s.id === "IA");
    expect(iowa?.name).toBe("Iowa");
    expect(iowa?.actionCost).toBeGreaterThan(0);
    expect(presence?.states.length).toBeGreaterThan(40);
  });

  it("reports nowhere for a candidate who has not moved yet", async () => {
    await setPhase(true);
    const presence = await build(stubDb({ candidate: { _id: new ObjectId() } }));
    expect(presence?.currentStateId).toBeNull();
    expect(presence?.currentStateName).toBeNull();
  });

  it("offers nothing to someone who is not a candidate in this race", async () => {
    await setPhase(true);
    expect(await build(stubDb({ candidate: null }))).toBeNull();
  });

  it("offers nothing on a race that is not a US presidential one", async () => {
    await setPhase(true);
    const senate = { ...(ELECTION as object), electionType: "senate" };
    expect(await build(stubDb(), senate)).toBeNull();

    const abroad = { ...(ELECTION as object), countryId: "FR" };
    expect(await build(stubDb(), abroad)).toBeNull();
  });

  it("offers nothing on a race that is not running", async () => {
    await setPhase(true);
    const concluded = { ...(ELECTION as object), status: "completed" };
    expect(await build(stubDb(), concluded)).toBeNull();
  });

  it("offers nothing to a signed-out viewer", async () => {
    await setPhase(true);
    expect(await build(stubDb(), ELECTION, null)).toBeNull();
  });
});
