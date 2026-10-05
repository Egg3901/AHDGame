/**
 * Controlled Japan reform, full statutory ballot map and sitting-capacity replay.
 * Uses synthetic regional support and bounded NPC representatives, not historical votes.
 */

import assert from "node:assert/strict";
import { JP_SHUGIIN_SEATS_1991 } from "@/lib/countries/jp/data/jpSeats";
import { JP_SHUGIIN_1994_CONSTITUENCIES } from "@/lib/countries/jp/data/jpShugiinConstituencies1994";
import {
  approveJapanShugiinReform,
  japanShugiinCurrentChamberCapacity,
  japanShugiinRulesForRegion,
  type JapanShugiinResolvedRegionalRule,
} from "@/lib/countries/jp/rules/shugiinElectoralLaw";
import {
  accumulateJapanBallots,
  type JapanBallotCandidate,
} from "@/lib/countries/jp/rules/shugiinBallotMath";
import {
  buildJapanMixedRegionalList,
  countJapanMixedShugiin,
} from "@/lib/countries/jp/rules/mixedShugiinCount";

const proposal = {
  preset: "1991-default",
  countryId: "JP",
  currentYear: 1994,
  turn: 145,
  billId: "controlled-reform",
};
assert.equal(
  approveJapanShugiinReform({ ...proposal, currentYear: 1993, outcome: "approved" }),
  null
);
assert.equal(approveJapanShugiinReform({ ...proposal, outcome: "rejected" }), null);
assert.equal(approveJapanShugiinReform({ ...proposal, outcome: "delayed" }), null);
const approved = approveJapanShugiinReform({ ...proposal, outcome: "approved" });
assert.ok(approved);
assert.equal(
  approveJapanShugiinReform({ ...proposal, outcome: "approved", current: approved }),
  approved
);

const resolved: Record<string, JapanShugiinResolvedRegionalRule> = {};
assert.equal(japanShugiinCurrentChamberCapacity(resolved), 512);
let seated = 0;
const rows = Object.entries(JP_SHUGIIN_SEATS_1991).map(([regionId, legacySeats], index) => {
  const frozenBefore = japanShugiinRulesForRegion("1991-default", regionId, legacySeats)!;
  const future = japanShugiinRulesForRegion("1991-default", regionId, legacySeats, approved)!;
  assert.equal(frozenBefore.law, "sntv-1991-v1");
  assert.equal(frozenBefore.totalSeats, legacySeats);
  const districtId = JP_SHUGIIN_1994_CONSTITUENCIES.find((row) => row.regionId === regionId)!.id;
  const candidates: Array<JapanBallotCandidate & { listOrder?: number }> = [
    { candidateId: `${regionId}:a`, partyId: "a", isNPP: true, votes: 40_000 },
    { candidateId: `${regionId}:b`, partyId: "b", isNPP: true, votes: 10_000 },
    ...(regionId === "KAN"
      ? [
          {
            candidateId: "dual-player",
            partyId: "a",
            constituencyId: districtId,
            listOrder: 1,
            votes: 6_000,
          },
          { candidateId: "list-only-player", partyId: "a", listOrder: 2, votes: 0 },
        ]
      : []),
  ];
  const ballots = accumulateJapanBallots({
    regionId,
    candidates,
    listVoteIncrements: { a: 40_000, b: 10_000 },
  });
  const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const result = countJapanMixedShugiin(
    {
      districtVotes: Object.fromEntries(
        Object.entries(ballots.constituencyVotes).map(([id, votes]) => [
          id,
          Object.entries(votes).map(([candidateId, count]) => ({
            candidateId,
            partyId: byId.get(candidateId)!.partyId,
            isNPP: byId.get(candidateId)!.isNPP,
            votes: count,
          })),
        ])
      ),
      listVotesByRegion: { [regionId]: ballots.listVotes },
      regionalLists: { [regionId]: buildJapanMixedRegionalList(candidates) },
    },
    regionId
  );
  assert.equal(result.vacancies.length, 0);
  assert.equal(result.totalSeats, future.totalSeats);
  assert.equal(
    Object.values(result.seatsByCandidate).reduce((sum, seats) => sum + seats, 0),
    future.totalSeats
  );
  if (regionId === "KAN") {
    assert.equal(result.seatsByCandidate["dual-player"], 1);
    assert.equal(result.seatsByCandidate["list-only-player"], 1);
    assert.equal(result.listWinners.KAN.includes("dual-player"), false);
  }
  seated += result.totalSeats;
  resolved[regionId] = {
    ruleVersion: future.law,
    totalSeats: future.totalSeats,
    districtSeats: future.districtSeats,
    listSeats: future.listSeats,
    electionId: `controlled-${regionId}`,
    cycle: 2,
    resolvedAtTurn: proposal.turn + index + 1,
  };
  return {
    regionId,
    frozenBeforeApproval: frozenBefore.totalSeats,
    futureDistrictSeats: future.districtSeats,
    futureListSeats: future.listSeats,
    seated: result.totalSeats,
    partyListSeats: result.partySeatsByRegion[regionId],
    sittingCapacityAfterResolution: japanShugiinCurrentChamberCapacity(resolved),
  };
});
assert.equal(seated, 500);
assert.equal(japanShugiinCurrentChamberCapacity(resolved), 500);
console.log(
  JSON.stringify(
    {
      issue: 2564,
      method: "Portable full-map ballot counter and progressive sitting-capacity replay",
      limitation:
        "Fixed synthetic regional support; no campaign-year world, historical microdistrict votes or policy feedback",
      statutoryDistricts: JP_SHUGIIN_1994_CONSTITUENCIES.length,
      initialSittingCapacity: 512,
      finalSittingCapacity: 500,
      rows,
    },
    null,
    2
  )
);
