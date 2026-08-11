/**
 * Bug 1 (fix/prez-registration): the presidential vote engine must factor
 * `statePartyOrg.registration` into per-state vote allocation, the same way
 * `tallyManagement.ts` does for down-ballot races.
 *
 * `accumulatePresidentVoteTurn` builds `partyOrgByParty` from `organization`
 * but historically never built/passed `regByParty`, so the legacy engine's
 * `regResistanceMultiplier` always saw `undefined` → neutral 1.0× for every
 * party. Registration had zero effect on presidential margins.
 *
 * This test runs the engine twice with identical inputs except
 * `statePartyOrg.registration`, and asserts the entrenched party's national
 * vote share rises. Fails before the fix (no diff); passes after.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { demographicCategories } from "@/lib/seeds/demographicCategories";
import { stateDemographics } from "@/lib/seeds/stateDemographics";
import { ELECTORAL_VOTE_UNITS } from "@/lib/constants/states";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const uniqueStateIds = [...new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId))];

const STATE_POP_DEFAULT = 5_000_000;

interface HarnessOpts {
  electionId: ObjectId;
  demId: string;
  repId: string;
  startTime: Date;
  endTime: Date;
  /** Optional per-party registration applied to every state's statePartyOrg rows. */
  registration?: { democrat: number; republican: number };
}

function buildMockDb(opts: HarnessOpts) {
  const { electionId, demId, repId, startTime, endTime, registration } = opts;
  const charDemId = new ObjectId();
  const charRepId = new ObjectId();

  const statePartyOrgs = uniqueStateIds.flatMap((stateId) => [
    {
      _id: `${stateId}_us_democrat`,
      stateId,
      countryId: "US",
      partyId: "democrat",
      organization: 25,
      ...(registration ? { registration: registration.democrat } : {}),
    },
    {
      _id: `${stateId}_us_republican`,
      stateId,
      countryId: "US",
      partyId: "republican",
      organization: 25,
      ...(registration ? { registration: registration.republican } : {}),
    },
  ]);

  const states = uniqueStateIds.map((id) => ({
    _id: id,
    name: id,
    population: STATE_POP_DEFAULT,
    gdp: 0,
    houseDistricts: 1,
    region: "Northeast",
  }));

  const initialTotalVotesByUnit: Record<string, Record<string, number>> = {};
  for (const unit of ELECTORAL_VOTE_UNITS) {
    initialTotalVotesByUnit[unit.unitId] = { [demId]: 0, [repId]: 0 };
  }

  const candidates = [
    {
      _id: new ObjectId(demId),
      electionId,
      characterId: charDemId,
      characterName: "Dem Candidate",
      party: "democrat",
      isNPP: false,
      status: "active",
    },
    {
      _id: new ObjectId(repId),
      electionId,
      characterId: charRepId,
      characterName: "Rep Candidate",
      party: "republican",
      isNPP: false,
      status: "active",
    },
  ];

  // Symmetric candidate stats — isolates registration as the only asymmetry.
  const characters = [
    {
      _id: charDemId,
      policies: { economic: -2, social: -2 },
      favorability: 60,
      politicalInfluence: 50,
      nationalInfluence: 50,
    },
    {
      _id: charRepId,
      policies: { economic: 2, social: 2 },
      favorability: 60,
      politicalInfluence: 50,
      nationalInfluence: 50,
    },
  ];

  const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });

  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "electionVoteTallies") {
      return {
        findOne: vi.fn().mockResolvedValue({
          electionId,
          totalVotes: { [demId]: 0, [repId]: 0 },
          totalVotesByUnit: initialTotalVotesByUnit,
          unitTurnSnapshots: {},
          createdAt: startTime,
        }),
        updateOne,
      };
    }
    if (name === "electionCandidates") {
      return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(candidates) }) };
    }
    if (name === "elections") {
      return {
        findOne: vi.fn().mockResolvedValue({
          _id: electionId,
          startTime,
          endTime,
          electionType: "president",
          countryId: "US",
        }),
      };
    }
    if (name === "demographicCategories") {
      return {
        find: vi
          .fn()
          .mockReturnValue({ toArray: vi.fn().mockResolvedValue(demographicCategories) }),
      };
    }
    if (name === "states") {
      return {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(
            uniqueStateIds.map(
              (id) =>
                states.find((s) => s._id === id) ?? {
                  _id: id,
                  population: STATE_POP_DEFAULT,
                  gdp: 0,
                  houseDistricts: 1,
                  region: "Northeast",
                }
            )
          ),
        }),
      };
    }
    if (name === "stateDemographics") {
      return {
        find: vi.fn().mockReturnValue({
          toArray: vi
            .fn()
            .mockResolvedValue(
              uniqueStateIds
                .map((id) => stateDemographics.find((d) => d._id === id))
                .filter(Boolean)
            ),
        }),
      };
    }
    if (name === "statePartyOrg") {
      return {
        find: vi.fn().mockReturnValue({
          toArray: vi
            .fn()
            .mockResolvedValue(statePartyOrgs.filter((o) => uniqueStateIds.includes(o.stateId))),
        }),
      };
    }
    if (name === "characters") {
      return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(characters) }) };
    }
    if (name === "politicalParties") {
      return {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { _id: "democrat", economicPosition: -2, socialPosition: -2 },
            { _id: "republican", economicPosition: 2, socialPosition: 2 },
          ]),
        }),
      };
    }
    if (name === "countryState") {
      return {
        findOne: vi.fn().mockResolvedValue({
          _id: "US",
          countryId: "US",
          governmentType: "presidential",
          rulingPartyId: null,
          opsVoteMultipliers: null,
          hasLeaderConfidenceModel: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      };
    }
    // Catch-all: empty cursor for any other collection the engine reads
    // (stateMetrics, campaigns, npps, partyGroupFavorability, governorEndorsements,
    // characterStateOrg, stateDemographicTurnout, ...).
    return {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        toArray: vi.fn().mockResolvedValue([]),
      }),
    };
  });

  return { collection, updateOne };
}

async function runAndGetDemShare(opts: HarnessOpts): Promise<number> {
  const { collection, updateOne } = buildMockDb(opts);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({ collection } as never);

  const { accumulatePresidentVoteTurn } = await import("./presidentialElectionEngine");
  await accumulatePresidentVoteTurn(opts.electionId, 1, new Date("2024-11-03T12:00:00Z"));

  const [, update] = updateOne.mock.calls[0];
  const totalVotes = update.$set.totalVotes as Record<string, number>;
  const dem = totalVotes[opts.demId] ?? 0;
  const rep = totalVotes[opts.repId] ?? 0;
  const total = dem + rep;
  return total > 0 ? (dem / total) * 100 : 0;
}

describe("presidential engine — registration entrenchment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("higher Democratic registration raises the Democratic national vote share", async () => {
    const base = {
      demId: new ObjectId().toString(),
      repId: new ObjectId().toString(),
      startTime: new Date("2024-11-01T00:00:00Z"),
      endTime: new Date("2024-11-05T00:00:00Z"),
    };

    const baselineShare = await runAndGetDemShare({
      ...base,
      electionId: new ObjectId(),
      // No registration → both parties degrade to the neutral baseline.
    });

    const entrenchedShare = await runAndGetDemShare({
      ...base,
      electionId: new ObjectId(),
      registration: { democrat: 90, republican: 10 },
    });

    // The entrenched Democratic party should peel/hold meaningfully more of
    // the national vote than the no-registration baseline.
    expect(entrenchedShare).toBeGreaterThan(baselineShare + 0.5);
    // …but Reg is a slow partisan baseline, not a wall (Phase 0.5 §4.2). Even
    // at the 90/10 extreme the tilt must stay modest — guard against a future
    // mis-calibration that lets registration alone swing the whole race.
    expect(entrenchedShare).toBeLessThan(baselineShare + 12);
  });

  it("leaves the result unchanged when no registration data is present", async () => {
    const base = {
      demId: new ObjectId().toString(),
      repId: new ObjectId().toString(),
      startTime: new Date("2024-11-01T00:00:00Z"),
      endTime: new Date("2024-11-05T00:00:00Z"),
    };

    const a = await runAndGetDemShare({ ...base, electionId: new ObjectId() });
    const b = await runAndGetDemShare({ ...base, electionId: new ObjectId() });

    // Backward-compat: absent registration degrades to the neutral 1.0× for
    // every party, so two no-reg runs are byte-identical.
    expect(a).toBe(b);
  });
});
