import { describe, expect, it } from "vitest";
import { huRegions1991 } from "../data/huRegions1991";
import { buildHuMixedPlan } from "./mixedElectionPlan";
import {
  buildHuModernAssembly,
  settleHuModernAssembly,
  type HuModernCandidate,
} from "./modernAssembly2011";
function fixture(player = false) {
  const candidates: HuModernCandidate[] = huRegions1991.flatMap((region, index) => [
    {
      id: `${region._id}:a`,
      ownerId: `${region._id}:owner-a`,
      partyId: "a",
      regionId: String(region._id),
      isNpc: true,
      votes: 100000,
    },
    {
      id: `${region._id}:b`,
      ownerId: `${region._id}:owner-b`,
      partyId: "b",
      regionId: String(region._id),
      isNpc: true,
      votes: 50000,
    },
    ...(player && index === 0
      ? [
          {
            id: "player",
            ownerId: "player-owner",
            partyId: "a",
            regionId: String(region._id),
            isNpc: false,
            votes: 999999,
          },
        ]
      : []),
  ]);
  const plan = buildHuMixedPlan(
    huRegions1991.map((row) => ({ id: String(row._id), population: row.population })),
    huRegions1991.map((region) => ({
      electionId: String(region._id),
      regionId: String(region._id),
      candidates: candidates
        .filter((row) => row.regionId === String(region._id))
        .map((row) => ({ candidateId: row.id, partyId: row.partyId, votes: row.votes })),
    }))
  );
  return { candidates, plan };
}
describe("Modern Hungarian whole-Assembly person plan", () => {
  it("installs106 constituency and93 national mandates from twelve existing owners", () => {
    const { candidates, plan } = fixture();
    const result = buildHuModernAssembly(plan, candidates)!;
    expect(result.installed.mandates).toHaveLength(199);
    expect(result.installed.mandates.filter((row) => row.tier === "constituency")).toHaveLength(
      106
    );
    expect(result.installed.mandates.filter((row) => row.tier === "national")).toHaveLength(93);
    expect(new Set(result.people.map((row) => row.ownerId)).size).toBe(12);
    expect(new Set(result.people.map((row) => row.id)).size).toBe(result.people.length);
    expect(result.people.length).toBeLessThanOrEqual(558);
  });
  it("keeps a heavily voted player at one seat without changing party quotas", () => {
    const { candidates, plan } = fixture(true);
    const result = buildHuModernAssembly(plan, candidates)!;
    expect(result.installed.mandates.filter((row) => !row.isNpc)).toHaveLength(1);
    expect(result.installed.candidateSeats.player).toBe(1);
    expect(result.installed.mandates).toHaveLength(199);
    expect(result.installed.partySeats).toEqual(plan.result.totalSeats);
  });
  it("rejects duplicate player or NPC owners across regional filings", () => {
    const { candidates, plan } = fixture(true);
    candidates[0].ownerId = candidates[1].ownerId;
    expect(() => buildHuModernAssembly(plan, candidates)).toThrow();
  });
  it("keeps a withdrawn direct winner vacant while replacing national seats from the original slate", () => {
    const { candidates, plan } = fixture();
    const result = buildHuModernAssembly(plan, candidates)!;
    const direct = result.installed.mandates.find((row) => row.tier === "constituency")!;
    const national = result.installed.mandates.find((row) => row.tier === "national")!;
    const final = settleHuModernAssembly(
      result.installed,
      result.people,
      new Set([direct.personId, national.personId])
    );
    expect(final.mandates).toHaveLength(198);
    expect(final.vacancies).toEqual([
      { tier: "constituency", districtId: direct.districtId, partyId: direct.partyId },
    ]);
    expect(
      final.mandates.some(
        (row) => row.personId === direct.personId || row.personId === national.personId
      )
    ).toBe(false);
    expect(new Set(final.mandates.map((row) => row.personId)).size).toBe(198);
  });
});
