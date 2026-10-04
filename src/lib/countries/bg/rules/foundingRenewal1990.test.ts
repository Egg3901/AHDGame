import { describe, expect, it } from "vitest";
import { BG_1990_LIST_DISTRICTS } from "../data/foundingDistricts1990";
import { buildBgFoundingSlates } from "./foundingSlates1990";
import { projectBgFoundingBallots, projectBgFoundingRunoff } from "./foundingBallots1990";
import { countBgFoundingElection } from "./foundingCount1990";
import {
  addBgFoundingRenewedNominee,
  addBgFoundingRenewedNpcSlate,
  bgFoundingOpenNominationDistricts,
} from "./foundingRenewal1990";

function fixture(two = false) {
  const regions = [...new Set(BG_1990_LIST_DISTRICTS.map((row) => row.regionId))];
  const candidates = regions.flatMap((regionId) =>
    (two ? ["a", "b"] : ["a"]).map((partyId, listOrder) => ({
      id: `${regionId}-${partyId}`,
      ownerId: `${regionId}-${partyId}`,
      isNpc: true,
      partyId,
      regionId,
      listOrder,
    }))
  );
  const { nominations } = buildBgFoundingSlates(candidates);
  const campaigns = regions.map((regionId) => ({
    regionId,
    registeredVoters: 100000,
    candidates: (two ? ["a", "b"] : ["a"]).map((partyId) => ({
      candidateId: `${regionId}-${partyId}`,
      votes: 10000,
    })),
  }));
  const first = projectBgFoundingBallots(campaigns, nominations);
  return { nominations, campaigns, first, count: countBgFoundingElection(first) };
}
describe("Bulgarian renewed direct nominations", () => {
  it("admits a new player to a failed single-candidate seat and preserves list votes and first ballots", () => {
    const data = fixture();
    const regionId = data.campaigns[0].regionId;
    const district = bgFoundingOpenNominationDistricts(data.count, data.first, regionId)[0];
    const person = {
      id: "new-player",
      candidateId: "new-player",
      ownerId: "new-owner",
      isNpc: false,
      partyId: "b",
      regionId,
    };
    const nominations = addBgFoundingRenewedNominee({ ...data, person, constituencyId: district });
    expect(nominations.lists).toBe(data.nominations.lists);
    const renewed = data.campaigns.map((row) =>
      row.regionId === regionId
        ? {
            ...row,
            candidates: [...row.candidates, { candidateId: person.candidateId, votes: 20000 }],
          }
        : row
    );
    const ballots = projectBgFoundingRunoff(renewed, nominations, data.first);
    expect(ballots.lists).toBe(data.first.lists);
    expect(ballots.constituencies.find((row) => row.id === district)?.first).toBe(
      data.first.constituencies.find((row) => row.id === district)?.first
    );
    expect(countBgFoundingElection(ballots).constituencyWinners[district]).toBe(person.id);
    expect(() =>
      addBgFoundingRenewedNominee({ ...data, nominations, person, constituencyId: district })
    ).toThrow("already belongs");
  });
  it("refuses top-two admission, regional changes and a second same-party district nominee", () => {
    const data = fixture();
    const regionId = data.campaigns[0].regionId;
    const district = bgFoundingOpenNominationDistricts(data.count, data.first, regionId)[0];
    const person = {
      id: "new",
      candidateId: "new",
      ownerId: "new",
      isNpc: false,
      partyId: "a",
      regionId,
    };
    expect(() =>
      addBgFoundingRenewedNominee({ ...data, person, constituencyId: district })
    ).toThrow("multiple nominees");
    expect(() =>
      addBgFoundingRenewedNominee({
        ...data,
        person: { ...person, partyId: "b", regionId: data.campaigns[1].regionId },
        constituencyId: district,
      })
    ).toThrow("does not admit");
    const two = fixture(true);
    expect(bgFoundingOpenNominationDistricts(two.count, two.first)).toEqual([]);
    expect(() => addBgFoundingRenewedNominee({ ...two, person, constituencyId: district })).toThrow(
      "does not admit"
    );
  });
  it("supplies bounded direct-only NPC people under one existing financial owner", () => {
    const data = fixture();
    const regionId = data.campaigns[0].regionId;
    const owner = { candidateId: "new-npc", ownerId: "existing-npc", partyId: "b", regionId };
    const nominations = addBgFoundingRenewedNpcSlate({ ...data, owner });
    const people = nominations.people.filter((person) => person.ownerId === owner.ownerId);
    expect(people).toHaveLength(
      bgFoundingOpenNominationDistricts(data.count, data.first, regionId).length
    );
    expect(new Set(people.map((person) => person.candidateId))).toEqual(
      new Set([owner.candidateId])
    );
    expect(nominations.lists).toBe(data.nominations.lists);
    expect(() => addBgFoundingRenewedNpcSlate({ ...data, nominations, owner })).toThrow("reuses");
  });
  it("does not reopen a constituency already resolved on the renewed ballot", () => {
    const data = fixture();
    const ballots = projectBgFoundingRunoff(data.campaigns, data.nominations, data.first);
    const count = countBgFoundingElection(ballots);
    expect(count.kind).toBe("certified");
    expect(bgFoundingOpenNominationDistricts(count, data.first)).toEqual([]);
  });
});
