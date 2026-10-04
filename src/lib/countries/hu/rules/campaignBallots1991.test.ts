import { describe, expect, it } from "vitest";
import { HU_1991_TERRITORIAL_DISTRICTS } from "../data/electoralDistricts1991";
import { buildHu1991Slates } from "./slates1991";
import { countHuMixed1991 } from "./mixedElection1991";
import { settleHu1991Mandates } from "./mandates1991";
import {
  projectHu1991CampaignBallots,
  projectHu1991Runoff,
  type Hu1991RegionalCampaign,
} from "./campaignBallots1991";
function fixture(
  parties: number = 2,
  votes: readonly number[] = [4000, 2000],
  registeredVoters: number = 10000
) {
  const regions = [...new Set(HU_1991_TERRITORIAL_DISTRICTS.map((row) => row.regionId))];
  const actors = regions.flatMap((regionId) =>
    Array.from({ length: parties }, (_, index) => ({
      id: `${regionId}:${index}`,
      ownerId: `${regionId}:owner:${index}`,
      isNpc: true,
      partyId: `party-${index}`,
      regionId,
      filingOrder: index,
    }))
  );
  const nominations = buildHu1991Slates(actors).nominations;
  const campaigns: Hu1991RegionalCampaign[] = regions.map((regionId) => ({
    regionId,
    registeredVoters,
    candidates: actors
      .filter((row) => row.regionId === regionId)
      .map((row, index) => ({ candidateId: row.id, votes: votes[index] })),
  }));
  return { actors, nominations, campaigns };
}

describe("Hungarian bounded campaign geography and genuine second rounds", () => {
  it("preserves first-round support and electors over all 176 districts and 20 counties", () => {
    const { nominations, campaigns } = fixture();
    const ballots = projectHu1991CampaignBallots(campaigns, nominations);
    expect(ballots.constituencies).toHaveLength(176);
    expect(ballots.territorial).toHaveLength(20);
    expect(ballots.constituencies.reduce((sum, row) => sum + row.first.registeredVoters, 0)).toBe(
      60000
    );
    expect(ballots.territorial.reduce((sum, row) => sum + row.first.registeredVoters, 0)).toBe(
      60000
    );
    expect(ballots.constituencies.reduce((sum, row) => sum + row.first.ballotsCast, 0)).toBe(36000);
    expect(ballots.territorial.reduce((sum, row) => sum + row.first.ballotsCast, 0)).toBe(36000);
    for (const [index, total] of [24000, 12000].entries())
      expect(
        ballots.territorial
          .flatMap((row) => row.first.lists)
          .filter((row) => row.partyId === `party-${index}`)
          .reduce((sum, row) => sum + row.votes, 0)
      ).toBe(total);
    const count = countHuMixed1991(ballots);
    if (count.kind !== "counted") throw new Error("Two-party fixture has first-round majorities");
    expect(settleHu1991Mandates(count, nominations).mandates).toHaveLength(386);
  });
  it("does not create a second-round majority from unchanged first-round votes", () => {
    const { nominations, campaigns } = fixture(3, [2000, 2000, 2000]);
    const first = projectHu1991CampaignBallots(campaigns, nominations);
    const pending = countHuMixed1991(first);
    expect(pending.kind).toBe("pending");
    if (pending.kind !== "pending") throw new Error("Three-way fixture requires second rounds");
    expect(Object.keys(pending.constituencyRunoffs)).toHaveLength(176);
    expect(pending.territorialRunoffs).toEqual([]);
    const next = campaigns.map((row) => ({
      ...row,
      candidates: row.candidates.map((candidate, index) => ({
        ...candidate,
        votes: index === 0 ? 4000 : index === 1 ? 2000 : 0,
      })),
    }));
    const second = projectHu1991Runoff(first, pending, next, nominations);
    expect(second.territorial).toEqual(first.territorial);
    expect(
      second.constituencies.every((row, index) => row.first === first.constituencies[index].first)
    ).toBe(true);
    const counted = countHuMixed1991(second);
    expect(counted.kind).toBe("counted");
    if (counted.kind !== "counted") throw new Error("Valid second rounds must close");
    expect(counted.constituencySeats["party-0"]).toBe(176);
    expect(settleHu1991Mandates(counted, nominations).mandates).toHaveLength(386);
  });
  it("freezes electorate and candidates even when renewed campaign registration changes", () => {
    const { nominations, campaigns } = fixture(4, [2300, 2300, 800, 600]);
    const first = projectHu1991CampaignBallots(campaigns, nominations);
    const pending = countHuMixed1991(first);
    if (pending.kind !== "pending") throw new Error("Fixture needs a runoff");
    const next = campaigns.map((row) => ({
      ...row,
      registeredVoters: 20000,
      candidates: row.candidates.map((candidate, index) => ({
        ...candidate,
        votes: index === 3 ? 5000 : 100,
      })),
    }));
    const second = projectHu1991Runoff(first, pending, next, nominations);
    for (const row of second.constituencies) {
      expect(row.second?.registeredVoters).toBe(row.first.registeredVoters);
      expect(
        row.second?.candidates.every((candidate) =>
          pending.constituencyRunoffs[row.id].includes(candidate.candidateId)
        )
      ).toBe(true);
      expect(row.second?.candidates.some((candidate) => candidate.partyId === "party-3")).toBe(
        false
      );
    }
  });
  it("keeps zero participation pending instead of manufacturing ballots", () => {
    const { nominations, campaigns } = fixture(2, [0, 0]);
    const projected = projectHu1991CampaignBallots(campaigns, nominations);
    expect(projected.constituencies.every((row) => row.first.ballotsCast === 0)).toBe(true);
    expect(projected.territorial.every((row) => row.first.ballotsCast === 0)).toBe(true);
    const count = countHuMixed1991(projected);
    expect(count.kind).toBe("pending");
  });
  it("conserves turnout and every party vote at full participation despite integer county boundaries", () => {
    const { nominations, campaigns } = fixture(3, [3333, 3333, 3334]);
    const projected = projectHu1991CampaignBallots(campaigns, nominations);
    expect(
      projected.constituencies.every((row) => row.first.ballotsCast <= row.first.registeredVoters)
    ).toBe(true);
    expect(
      projected.territorial.every((row) => row.first.ballotsCast <= row.first.registeredVoters)
    ).toBe(true);
    expect(projected.territorial.reduce((sum, row) => sum + row.first.ballotsCast, 0)).toBe(60000);
    for (const [index, total] of [19998, 19998, 20004].entries())
      expect(
        projected.territorial
          .flatMap((row) => row.first.lists)
          .filter((row) => row.partyId === `party-${index}`)
          .reduce((sum, row) => sum + row.votes, 0)
      ).toBe(total);
    const reordered = [...campaigns]
      .reverse()
      .map((row) => ({ ...row, candidates: [...row.candidates].reverse() }));
    expect(projectHu1991CampaignBallots(reordered, nominations)).toEqual(projected);
  });
  it("rejects missing regions, impossible turnout and foreign candidate identities", () => {
    const { nominations, campaigns } = fixture();
    expect(() => projectHu1991CampaignBallots(campaigns.slice(1), nominations)).toThrow(
      /six regions/
    );
    expect(() =>
      projectHu1991CampaignBallots(
        campaigns.map((row) => ({ ...row, registeredVoters: 5000 })),
        nominations
      )
    ).toThrow(/exceeds/);
    const unknown = structuredClone(campaigns);
    unknown[0].candidates[0].candidateId = "foreign";
    expect(() => projectHu1991CampaignBallots(unknown, nominations)).toThrow(/unknown/);
  });
});
