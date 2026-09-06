import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import {
  PRIMARY_LOCAL_ATTACK_COST_FUNDS,
  PRIMARY_LOCAL_ATTACK_FAV_POINTS,
  PRIMARY_VOTE_SUPPRESSION_COST_FUNDS,
} from "@/lib/electionEngine/constants";

vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/elections/phases", () => ({ isPrimaryEnded: vi.fn() }));
vi.mock("@/lib/elections/primaryPartyDetail", () => ({
  buildPrimaryViewerCampaign: vi.fn(),
}));

const ELECTION_ID = new ObjectId();
const ME = new ObjectId();
const RIVAL = new ObjectId();
const MY_ROW = new ObjectId();
const RIVAL_ROW = new ObjectId();

const ELECTION = {
  _id: ELECTION_ID,
  electionType: "president",
  countryId: "US",
  status: "active",
} as never;

const CHARACTER = { _id: ME, name: "Filer", party: "1", actions: 25, countryId: "US" } as never;

type Rows = Record<string, Record<string, unknown>[]>;

/** Collection-name-dispatching stub with the cursor surface the builder uses. */
function stubDb(rows: Rows = {}): Db {
  const get = (n: string) => rows[n] ?? [];
  return {
    collection: (name: string) => {
      const cursor = {
        toArray: async () => get(name),
        project: () => cursor,
        sort: () => cursor,
        limit: () => cursor,
      };
      return {
        find: () => cursor,
        findOne: async () => get(name)[0] ?? null,
      };
    },
  } as unknown as Db;
}

function candidateRow(id: ObjectId, characterId: ObjectId, name: string) {
  return {
    _id: id,
    electionId: ELECTION_ID,
    characterId,
    characterName: name,
    party: "1",
    status: "active",
    isNPP: false,
  };
}

const ROSTER = [candidateRow(MY_ROW, ME, "Filer"), candidateRow(RIVAL_ROW, RIVAL, "Rival Filer")];

function attackRow(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    electionId: ELECTION_ID,
    actorCandidateId: MY_ROW,
    targetCandidateId: RIVAL_ROW,
    targetCharacterId: RIVAL,
    stateId: "IA",
    kind: "localFavorability",
    magnitude: 0.4,
    shieldApplied: 0,
    appliedTurn: 10,
    expiresTurn: 18,
    createdAt: new Date(),
    ...over,
  };
}

async function build(rows: Rows, character: unknown = CHARACTER) {
  const { buildStateOperations } = await import("./primaryStateOperations");
  return buildStateOperations(stubDb(rows), {
    election: ELECTION,
    character: character as never,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { getGameTime } = await import("@/lib/time/gameTime");
  vi.mocked(getGameTime).mockResolvedValue({ currentTurn: 12, effectiveNow: new Date() } as never);

  const { isPrimaryEnded } = await import("@/lib/elections/phases");
  vi.mocked(isPrimaryEnded).mockReturnValue(false);

  const { buildPrimaryViewerCampaign } = await import("@/lib/elections/primaryPartyDetail");
  vi.mocked(buildPrimaryViewerCampaign).mockResolvedValue({
    currentCampaignState: "IA",
    currentTicks: 3,
  } as never);
});

describe("buildStateOperations", () => {
  it("offers nothing once the primary has closed", async () => {
    const { isPrimaryEnded } = await import("@/lib/elections/phases");
    vi.mocked(isPrimaryEnded).mockReturnValue(true);
    expect(await build({ electionCandidates: ROSTER })).toBeNull();
  });

  it("offers nothing on a race that is not a US presidential one", async () => {
    const { buildStateOperations } = await import("./primaryStateOperations");
    const senate = { ...(ELECTION as object), electionType: "senate" };
    expect(
      await buildStateOperations(stubDb({ electionCandidates: ROSTER }), {
        election: senate as never,
        character: CHARACTER,
      })
    ).toBeNull();
  });

  it("offers nothing to someone with no candidacy in the race", async () => {
    expect(
      await build({ electionCandidates: [candidateRow(RIVAL_ROW, RIVAL, "Rival Filer")] })
    ).toBeNull();
  });

  it("lists every rival but never the viewer", async () => {
    const view = await build({ electionCandidates: ROSTER });
    expect(view?.opponents.map((o) => o.name)).toEqual(["Rival Filer"]);
  });

  it("offers both attacks, in the order the panel shows them", async () => {
    // Turnout suppression was a third here and was pulled before release: it
    // measured 0.00pp of the delegate count at every price simulated.
    const view = await build({ electionCandidates: ROSTER });
    expect(view?.attacks.map((a) => a.kind)).toEqual(["localFavorability", "voteSuppression"]);
  });

  it("prices each attack from the constants, not a literal", async () => {
    const view = await build({ electionCandidates: ROSTER });
    const local = view?.attacks.find((a) => a.kind === "localFavorability");
    expect(local?.costFunds).toBe(PRIMARY_LOCAL_ATTACK_COST_FUNDS);
    expect(local?.description).toContain(String(PRIMARY_LOCAL_ATTACK_FAV_POINTS));
    expect(view?.attacks.find((a) => a.kind === "voteSuppression")?.costFunds).toBe(
      PRIMARY_VOTE_SUPPRESSION_COST_FUNDS
    );
  });

  it("says which attacks Rapid Response covers", async () => {
    // The shield line has to be honest: it blunts two of the three.
    const view = await build({ electionCandidates: ROSTER });
    expect(view?.attacks.filter((a) => a.shielded).map((a) => a.kind)).toEqual([
      "localFavorability",
      "voteSuppression",
    ]);
  });

  it("names the country, so the group chooser offers the right vocabulary", async () => {
    const view = await build({ electionCandidates: ROSTER });
    expect(view?.countryId).toBe("US");
  });

  it("carries the war chest, which is the pool an attack is charged to", async () => {
    // `positives.camp.playerFunds` is the candidate's own balance and pays for
    // the home-state surge; gating an attack on it would compare the wrong pool.
    const view = await build({
      electionCandidates: ROSTER,
      campaigns: [{ _id: new ObjectId(), candidateId: ME, funds: 1_200_000 }],
    });
    expect(view?.campaignFunds).toBe(1_200_000);
  });

  it("quotes the attack in the campaign's own currency", async () => {
    const view = await build({
      electionCandidates: ROSTER,
      exchangeRates: [{ currencyCode: "USD", rate: 2 }],
    });
    expect(view?.attacks.find((a) => a.kind === "localFavorability")?.costFunds).toBe(
      PRIMARY_LOCAL_ATTACK_COST_FUNDS * 2
    );
    // The copy has to move with the price, or the panel quotes anchor units.
    expect(view?.attacks.find((a) => a.kind === "voteSuppression")?.description).toContain(
      (PRIMARY_VOTE_SUPPRESSION_COST_FUNDS * 2).toLocaleString("en-US")
    );
    expect(view?.campaignFxRate).toBe(2);
  });

  it("quotes the presence ladder in the campaign's own currency too", async () => {
    // stateOrgLevelCost is anchor-denominated; the war chest is not.
    const plain = await build({
      electionCandidates: ROSTER,
      characterStateOrg: [
        { _id: new ObjectId(), characterId: ME, stateId: "NH", level: 3, totalInvested: 0 },
      ],
    });
    const doubled = await build({
      electionCandidates: ROSTER,
      characterStateOrg: [
        { _id: new ObjectId(), characterId: ME, stateId: "NH", level: 3, totalInvested: 0 },
      ],
      exchangeRates: [{ currencyCode: "USD", rate: 2 }],
    });
    expect(doubled?.positives.presence[0].nextCost).toBe(
      (plain?.positives.presence[0].nextCost ?? 0) * 2
    );
  });

  it("reports what the viewer has live against a rival, named by state", async () => {
    const view = await build({
      electionCandidates: ROSTER,
      primaryStateActions: [attackRow()],
      states: [{ _id: "IA", name: "Iowa" }],
    });
    expect(view?.opponents[0].liveAgainstThem).toHaveLength(1);
    expect(view?.opponents[0].liveAgainstThem[0].stateName).toBe("Iowa");
    expect(view?.liveAgainstYou).toHaveLength(0);
  });

  it("names who is attacking the viewer, so a hit can be traced", async () => {
    const view = await build({
      electionCandidates: ROSTER,
      primaryStateActions: [
        attackRow({
          actorCandidateId: RIVAL_ROW,
          targetCandidateId: MY_ROW,
          targetCharacterId: ME,
          stateId: "NH",
        }),
      ],
      states: [{ _id: "NH", name: "New Hampshire" }],
    });
    expect(view?.liveAgainstYou).toHaveLength(1);
    expect(view?.liveAgainstYou[0].actorName).toBe("Rival Filer");
    expect(view?.liveAgainstYou[0].stateName).toBe("New Hampshire");
    expect(view?.opponents[0].liveAgainstThem).toHaveLength(0);
  });

  it("lists the states the viewer has presence in, strongest first", async () => {
    const view = await build({
      electionCandidates: ROSTER,
      characterStateOrg: [
        { _id: new ObjectId(), characterId: ME, stateId: "IA", level: 2, totalInvested: 0 },
        { _id: new ObjectId(), characterId: ME, stateId: "NH", level: 5, totalInvested: 0 },
      ],
    });
    expect(view?.positives.presence.map((p) => p.stateId)).toEqual(["NH", "IA"]);
    expect(view?.positives.presence[0].nextCost).toBeGreaterThan(0);
  });

  it("opens canvassing only once the viewer is camped somewhere", async () => {
    const view = await build({ electionCandidates: ROSTER });
    expect(view?.positives.canvass.available).toBe(true);
    expect(view?.positives.canvass.stateId).toBe("IA");
  });

  it("says why canvassing is closed when the viewer is camped nowhere", async () => {
    const { buildPrimaryViewerCampaign } = await import("@/lib/elections/primaryPartyDetail");
    vi.mocked(buildPrimaryViewerCampaign).mockResolvedValue({
      currentCampaignState: null,
      currentTicks: 0,
    } as never);
    const view = await build({ electionCandidates: ROSTER });
    expect(view?.positives.canvass.available).toBe(false);
    expect(view?.positives.canvass.reason).toMatch(/camp/i);
  });

  it("gives each candidate their own colour, so the field is not one block", async () => {
    const view = await build({ electionCandidates: ROSTER });
    expect(view?.opponents[0].color).toMatch(/^#/);
  });
});
