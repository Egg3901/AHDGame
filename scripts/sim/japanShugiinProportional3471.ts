/**
 * Issue #3471: deterministic JP Shugiin proportional-seat qualification.
 * Uses aggregate synthetic ballots shaped like the user-provided screenshots.
 */
import assert from "node:assert/strict";
import { JP_SHUGIIN_1994_CONSTITUENCIES } from "@/lib/countries/jp/data/jpShugiinConstituencies1994";
import { countJapanMixedShugiin } from "@/lib/countries/jp/rules/mixedShugiinCount";
import { allocateSeats, sntvSeats } from "@/lib/turn/election/seatAllocation";

function sumSeats(seats: Readonly<Record<string, number>>): number {
  return Object.values(seats).reduce((sum, count) => sum + count, 0);
}

const chugokuCandidates = [{ id: "party-a", party: "party-a", votes: 91_818 }];
const chugokuBaseline = sntvSeats(chugokuCandidates, 34);
const chugokuCandidate = allocateSeats(
  "shugiin",
  "CGK",
  34,
  chugokuCandidates,
  91_818,
  undefined,
  undefined,
  undefined,
  "JP",
  "sntv"
).seatsEstimate;
assert.equal(sumSeats(chugokuBaseline), 1);
assert.equal(sumSeats(chugokuCandidate), 34);

const tohokuCandidates = [
  { id: "party-a", party: "party-a", votes: 56_988 },
  { id: "party-b", party: "party-b", votes: 56_830 },
  { id: "independent-a", party: "independent", votes: 1_203 },
  { id: "independent-b", party: "independent", votes: 1_148 },
  { id: "independent-c", party: "independent", votes: 61 },
];
const tohokuVotes = tohokuCandidates.reduce((sum, candidate) => sum + candidate.votes, 0);
const tohokuBaseline = sntvSeats(tohokuCandidates, 50);
const tohokuCandidate = allocateSeats(
  "shugiin",
  "TOH",
  50,
  tohokuCandidates,
  tohokuVotes,
  undefined,
  undefined,
  undefined,
  "JP",
  "sntv"
).seatsEstimate;
assert.equal(sumSeats(tohokuBaseline), 5);
assert.deepEqual(tohokuCandidate, {
  "party-a": 25,
  "party-b": 25,
  "independent-a": 0,
  "independent-b": 0,
  "independent-c": 0,
});

const thresholdCandidates = [
  { id: "major", party: "major", votes: 890 },
  { id: "boundary", party: "boundary", votes: 100 },
  { id: "minor", party: "minor", votes: 10 },
];
const thresholdCandidate = allocateSeats(
  "shugiin",
  "CGK",
  34,
  thresholdCandidates,
  1_000,
  undefined,
  undefined,
  undefined,
  "JP",
  "pr_hareQuota"
).seatsEstimate;
assert.deepEqual(thresholdCandidate, { major: 31, boundary: 3, minor: 0 });

const mixedRegion = "TOH";
const mixedDistricts = JP_SHUGIIN_1994_CONSTITUENCIES.filter(
  (district) => district.regionId === mixedRegion
);
const mixed = countJapanMixedShugiin(
  {
    districtVotes: Object.fromEntries(
      mixedDistricts.map((district) => [
        district.id,
        [{ candidateId: `direct:${district.id}`, partyId: "major", votes: 1 }],
      ])
    ),
    listVotesByRegion: {
      [mixedRegion]: { major: 890, boundary: 100, minor: 10 },
    },
    regionalLists: {
      [mixedRegion]: [
        { candidateId: "major-npp", partyId: "major", listOrder: 1, isNPP: true },
        {
          candidateId: "boundary-npp",
          partyId: "boundary",
          listOrder: 1,
          isNPP: true,
        },
        { candidateId: "minor-npp", partyId: "minor", listOrder: 1, isNPP: true },
      ],
    },
  },
  mixedRegion
);
assert.deepEqual(mixed.partySeatsByRegion[mixedRegion], { major: 15, boundary: 1, minor: 0 });
assert.equal(mixed.listWinners[mixedRegion].length, 16);

console.log(
  JSON.stringify(
    {
      issue: 3471,
      method: "Deterministic aggregate ballot replay through production portable rules",
      limitation:
        "Aggregate regional vote shapes only; no campaign trajectory, historical microdistrict model, or production write",
      scenarios: {
        screenshotChugokuShape: {
          seats: 34,
          votes: 91_818,
          formerSntvFilledSeats: sumSeats(chugokuBaseline),
          proportionalFilledSeats: sumSeats(chugokuCandidate),
          allocation: chugokuCandidate,
        },
        screenshotTohokuShape: {
          seats: 50,
          votes: tohokuVotes,
          formerSntvFilledSeats: sumSeats(tohokuBaseline),
          proportionalFilledSeats: sumSeats(tohokuCandidate),
          allocation: tohokuCandidate,
        },
        thresholdBoundary: {
          seats: 34,
          sharesPct: { major: 89, boundary: 10, minor: 1 },
          allocation: thresholdCandidate,
        },
        mixedRegionalListThreshold: {
          seats: 16,
          sharesPct: { major: 89, boundary: 10, minor: 1 },
          allocation: mixed.partySeatsByRegion[mixedRegion],
        },
      },
    },
    null,
    2
  )
);
