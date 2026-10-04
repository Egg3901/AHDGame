import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db, type Filter, type UpdateFilter } from "mongodb";
import type {
  ElectedOfficial,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
} from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/perpetualElections/shared", () => ({
  countryElectionsLive: vi.fn().mockResolvedValue(false),
  ensureRegionalDelegateElections: vi.fn(),
  ensureRegionalGovernorElections: vi.fn(),
  seatsFromRegionField: vi.fn(),
}));
vi.mock("@/lib/nppAutonomy/featureFlag", () => ({
  isNppAutonomyActive: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/turn/perpetualElections/engine", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/turn/perpetualElections/engine")>()),
  getCurrentTurnAndCtx: vi.fn().mockResolvedValue({
    currentTurn: 1,
    ctx: { preset: "1991-default", startingYear: 1991 },
  }),
}));
vi.mock("@/lib/singleplayer", () => ({ isSingleplayer: vi.fn(() => false) }));
vi.mock("@/lib/cabinetTransition", () => ({
  clearCabinetOnTransition: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/elections/liveResults/captureResultSnapshot", () => ({
  captureElectionResultSnapshot: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/analytics/officeTransitionAnalytics", () => ({
  captureOfficeTransition: vi.fn().mockResolvedValue(undefined),
}));
import { clearCabinetOnTransition } from "@/lib/cabinetTransition";
import { getCurrentTurnAndCtx } from "@/lib/turn/perpetualElections/engine";
import { ensureBRPresidentialElection } from "./perpetual";
import { resolveBrazilPresidentialElection } from "../resolvePresidentialElection";

const now = new Date("2026-10-04T03:00:00Z");
let mock: MockDb;
let races: Election[];
let nominees: ElectionCandidate[];
let president: Partial<ElectedOfficial> | null;
const government: Record<string, unknown> = {};

beforeEach(async () => {
  vi.clearAllMocks();
  mock = createMockDb();
  races = [];
  nominees = [];
  president = null;
  for (const key of Object.keys(government)) delete government[key];
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(mock as unknown as Db);
  vi.mocked(getCurrentTurnAndCtx).mockResolvedValue({
    currentTurn: 1,
    currentYear: 1991,
    ctx: { preset: "1991-default", startingYear: 1991 },
  });
  mock.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
  mock.collection("elections").findOne.mockImplementation(async (filter: Filter<Election>) => {
    if (filter.status === "resolved")
      return races.findLast((race) => race.status === "resolved") ?? null;
    return races.find((race) => race.status !== "resolved") ?? null;
  });
  mock
    .collection("elections")
    .updateOne.mockImplementation(
      async (_filter: Filter<Election>, update: UpdateFilter<Election>) => {
        races.push({ _id: new ObjectId(), ...update.$setOnInsert } as Election);
        return { matchedCount: 0, upsertedCount: 1 };
      }
    );
  mock
    .collection("electionCandidates")
    .find()
    .toArray.mockImplementation(async () => nominees);
  mock
    .collection("electedOfficials")
    .findOne.mockImplementation(async (filter: Filter<ElectedOfficial>) =>
      filter.officeType === "president" ? president : null
    );
  mock
    .collection("electedOfficials")
    .updateOne.mockImplementation(
      async (filter: Filter<ElectedOfficial>, update: UpdateFilter<ElectedOfficial>) => {
        if (filter.officeType === "president")
          president = { officeType: "president", ...update.$set };
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );
  mock
    .collection("governmentFormations")
    .updateOne.mockImplementation(
      async (_filter: Filter<GovernmentFormation>, update: UpdateFilter<GovernmentFormation>) => {
        Object.assign(government, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );
});

function ballot(
  election: Election,
  incumbentId: ObjectId,
  oppositionId: ObjectId,
  votes: number[]
) {
  nominees = [incumbentId, oppositionId, new ObjectId()].map((id, index) => ({
    _id: new ObjectId(),
    electionId: election._id,
    countryId: "BR",
    nppId: id,
    isNPP: true,
    party: ["incumbent", "opposition", "third"][index],
    characterName: `Nominee ${index}`,
    status: "active",
  })) as ElectionCandidate[];
  return {
    _id: new ObjectId(),
    electionId: election._id,
    totalVotes: Object.fromEntries(
      nominees.map((nominee, index) => [String(nominee._id), votes[index]])
    ),
  } as ElectionVoteTally;
}

describe("Brazil background renewal through real spawning, resolution and seating", () => {
  it.each([false, true])(
    "renews or fills the first term, then transfers power (initially vacant: %s)",
    async (vacant) => {
      const incumbentId = new ObjectId();
      const oppositionId = new ObjectId();
      if (!vacant) president = { nppId: incumbentId, party: "incumbent", isNPP: true };
      await ensureBRPresidentialElection(now, 1);
      const first = races[0];
      expect(first).toMatchObject({ cycle: 1, endTurn: 192, brazilPresidentialMode: "majority" });
      expect(
        await resolveBrazilPresidentialElection(
          mock as unknown as Db,
          first,
          ballot(first, incumbentId, oppositionId, [60, 25, 15]),
          now,
          192
        )
      ).toBe(true);
      expect(president).toMatchObject({ nppId: incumbentId, party: "incumbent" });
      expect(government).toMatchObject({
        presidentNppId: incumbentId,
        pmNppId: incumbentId,
        governingPartyId: "incumbent",
        formationType: null,
        formedTurn: 192,
      });
      expect(clearCabinetOnTransition).toHaveBeenCalledTimes(vacant ? 1 : 0);

      // The outer resolution coordinator marks a finished race resolved.
      first.status = "resolved";
      first.updatedAt = now;
      await ensureBRPresidentialElection(new Date(now.getTime() + 3600000), 193);
      const second = races[1];
      expect(second).toMatchObject({ cycle: 2, endTurn: 384, brazilPresidentialMode: "majority" });
      expect(
        await resolveBrazilPresidentialElection(
          mock as unknown as Db,
          second,
          ballot(second, incumbentId, oppositionId, [30, 55, 15]),
          now,
          384
        )
      ).toBe(true);
      expect(president).toMatchObject({ nppId: oppositionId, party: "opposition" });
      expect(government).toMatchObject({
        presidentNppId: oppositionId,
        pmNppId: oppositionId,
        governingPartyId: "opposition",
        formationType: null,
        formedTurn: 384,
      });
      expect(clearCabinetOnTransition).toHaveBeenCalledTimes(vacant ? 2 : 1);
      expect(mock.collection("electionVoteTallies").updateOne).toHaveBeenCalledWith(
        { electionId: second._id },
        {
          $set: expect.objectContaining({
            finalized: true,
            executiveSeatingPending: false,
            resolvedAtTurn: 384,
          }),
        }
      );
    }
  );
});
