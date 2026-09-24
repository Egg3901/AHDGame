import { regBaselineMultiplier } from "../../src/lib/electionEngine/electionFormulaFactors";
import { largestRemainderSeats } from "../../src/lib/turn/election/seatAllocation";

interface PartySnapshot {
  party: string;
  voteShare: number;
  seats: number;
  seededRegistrationShare?: number;
  currentRegistration: number;
}

interface RegionSnapshot {
  region: string;
  seats: number;
  totalVotes: number;
  parties: PartySnapshot[];
}

/**
 * Aggregate, non-player live snapshot captured read-only on 2026-09-24 during
 * the first general-election slice of UK Commons cycle 5. Values are rounded
 * to six decimals, which is more precision than the player-facing display.
 */
const SNAPSHOT: RegionSnapshot[] = [
  {
    region: "EAE",
    seats: 47,
    totalVotes: 202_610,
    parties: [
      {
        party: "CON",
        voteShare: 19.361335,
        seats: 0,
        seededRegistrationShare: 54,
        currentRegistration: 52.02637,
      },
      {
        party: "LAB",
        voteShare: 33.642466,
        seats: 19,
        seededRegistrationShare: 43,
        currentRegistration: 29.906924,
      },
      { party: "LD", voteShare: 25.029367, seats: 15, currentRegistration: 13.413298 },
      { party: "TRP", voteShare: 21.966833, seats: 13, currentRegistration: 4.491308 },
    ],
  },
  {
    region: "EMI",
    seats: 37,
    totalVotes: 150_630,
    parties: [
      {
        party: "CON",
        voteShare: 17.229636,
        seats: 0,
        seededRegistrationShare: 47,
        currentRegistration: 21.556657,
      },
      {
        party: "LAB",
        voteShare: 23.065126,
        seats: 10,
        seededRegistrationShare: 50,
        currentRegistration: 49.427068,
      },
      { party: "LD", voteShare: 20.777402, seats: 9, currentRegistration: 8.412291 },
      { party: "TRP", voteShare: 38.927836, seats: 18, currentRegistration: 20.54938 },
    ],
  },
  {
    region: "LON",
    seats: 91,
    totalVotes: 482_929,
    parties: [
      {
        party: "CON",
        voteShare: 19.200338,
        seats: 0,
        seededRegistrationShare: 46,
        currentRegistration: 32.872639,
      },
      {
        party: "LAB",
        voteShare: 27.435917,
        seats: 51,
        seededRegistrationShare: 51,
        currentRegistration: 33.621644,
      },
      { party: "LD", voteShare: 16.980757, seats: 0, currentRegistration: 15.072469 },
      { party: "TRP", voteShare: 15.168689, seats: 0, currentRegistration: 4.583488 },
      { party: "WPGB", voteShare: 21.214299, seats: 40, currentRegistration: 13.845011 },
    ],
  },
  {
    region: "NEE",
    seats: 27,
    totalVotes: 133_578,
    parties: [
      {
        party: "CON",
        voteShare: 6.971956,
        seats: 0,
        seededRegistrationShare: 37,
        currentRegistration: 14.29561,
      },
      {
        party: "LAB",
        voteShare: 13.485005,
        seats: 0,
        seededRegistrationShare: 61,
        currentRegistration: 15.714756,
      },
      { party: "LD", voteShare: 46.241147, seats: 19, currentRegistration: 41.087996 },
      { party: "TRP", voteShare: 20.291515, seats: 8, currentRegistration: 15.073404 },
      { party: "WPGB", voteShare: 13.010376, seats: 0, currentRegistration: 13.823234 },
    ],
  },
  {
    region: "NIR",
    seats: 12,
    totalVotes: 71_009,
    parties: [
      {
        party: "CON",
        voteShare: 17.164021,
        seats: 0,
        seededRegistrationShare: 63,
        currentRegistration: 22.159218,
      },
      {
        party: "LAB",
        voteShare: 1.929333,
        seats: 0,
        seededRegistrationShare: 0,
        currentRegistration: 29.916346,
      },
      { party: "LD", voteShare: 21.049444, seats: 3, currentRegistration: 28.062548 },
      { party: "WPGB", voteShare: 59.857201, seats: 9, currentRegistration: 17.639749 },
    ],
  },
  {
    region: "NWE",
    seats: 75,
    totalVotes: 352_564,
    parties: [
      {
        party: "CON",
        voteShare: 11.15996,
        seats: 0,
        seededRegistrationShare: 46,
        currentRegistration: 9.277178,
      },
      {
        party: "LAB",
        voteShare: 30.623943,
        seats: 26,
        seededRegistrationShare: 52,
        currentRegistration: 41.328846,
      },
      { party: "LD", voteShare: 35.541349, seats: 30, currentRegistration: 31.916419 },
      { party: "TRP", voteShare: 22.674748, seats: 19, currentRegistration: 17.398007 },
    ],
  },
  {
    region: "SCO",
    seats: 71,
    totalVotes: 264_333,
    parties: [
      {
        party: "CON",
        voteShare: 25.839377,
        seats: 18,
        seededRegistrationShare: 48,
        currentRegistration: 28.794968,
      },
      {
        party: "LAB",
        voteShare: 46.230701,
        seats: 34,
        seededRegistrationShare: 48,
        currentRegistration: 51.900559,
      },
      {
        party: "LD",
        voteShare: 1.245777,
        seats: 0,
        seededRegistrationShare: 0,
        currentRegistration: 4.673111,
      },
      { party: "TRP", voteShare: 26.684145, seats: 19, currentRegistration: 14.587453 },
    ],
  },
  {
    region: "SEE",
    seats: 81,
    totalVotes: 290_336,
    parties: [
      {
        party: "CON",
        voteShare: 24.07762,
        seats: 23,
        seededRegistrationShare: 58,
        currentRegistration: 43.241484,
      },
      {
        party: "LAB",
        voteShare: 31.996377,
        seats: 32,
        seededRegistrationShare: 39,
        currentRegistration: 45.435474,
      },
      { party: "LD", voteShare: 16.884231, seats: 0, currentRegistration: 6.389108 },
      { party: "TRP", voteShare: 27.041772, seats: 26, currentRegistration: 4.83846 },
    ],
  },
  {
    region: "SWE",
    seats: 43,
    totalVotes: 150_986,
    parties: [
      {
        party: "CON",
        voteShare: 14.6146,
        seats: 0,
        seededRegistrationShare: 53,
        currentRegistration: 16.229648,
      },
      {
        party: "LAB",
        voteShare: 47.801121,
        seats: 29,
        seededRegistrationShare: 41,
        currentRegistration: 59.945971,
      },
      { party: "LD", voteShare: 15.086829, seats: 0, currentRegistration: 8.053834 },
      { party: "TRP", voteShare: 22.49745, seats: 14, currentRegistration: 15.688471 },
    ],
  },
  {
    region: "WAL",
    seats: 36,
    totalVotes: 111_956,
    parties: [
      {
        party: "CON",
        voteShare: 5.841581,
        seats: 0,
        seededRegistrationShare: 31,
        currentRegistration: 16.533521,
      },
      {
        party: "LAB",
        voteShare: 25.609168,
        seats: 11,
        seededRegistrationShare: 60,
        currentRegistration: 43.409175,
      },
      { party: "LD", voteShare: 8.272893, seats: 0, currentRegistration: 9.034056 },
      { party: "TRP", voteShare: 60.276359, seats: 25, currentRegistration: 30.939588 },
    ],
  },
  {
    region: "WMI",
    seats: 53,
    totalVotes: 240_006,
    parties: [
      {
        party: "CON",
        voteShare: 12.542186,
        seats: 0,
        seededRegistrationShare: 49,
        currentRegistration: 23.166458,
      },
      {
        party: "LAB",
        voteShare: 17.662475,
        seats: 0,
        seededRegistrationShare: 49,
        currentRegistration: 31.639143,
      },
      { party: "LD", voteShare: 30.594652, seats: 23, currentRegistration: 33.372448 },
      { party: "TRP", voteShare: 39.200687, seats: 30, currentRegistration: 11.715488 },
    ],
  },
  {
    region: "YHU",
    seats: 52,
    totalVotes: 218_317,
    parties: [
      {
        party: "CON",
        voteShare: 9.941965,
        seats: 0,
        seededRegistrationShare: 44,
        currentRegistration: 11.337632,
      },
      {
        party: "LAB",
        voteShare: 22.47191,
        seats: 13,
        seededRegistrationShare: 54,
        currentRegistration: 26.944328,
      },
      { party: "LD", voteShare: 43.657159, seats: 25, currentRegistration: 42.802702 },
      { party: "TRP", voteShare: 23.928966, seats: 14, currentRegistration: 18.899277 },
    ],
  },
];

interface ProjectedParty extends PartySnapshot {
  projectedShare: number;
  projectedSeats: number;
}

function projectRegion(region: RegionSnapshot): ProjectedParty[] {
  const raw = region.parties.map((party) => {
    const oldBaseline = regBaselineMultiplier(party.seededRegistrationShare);
    const newBaseline = regBaselineMultiplier(party.currentRegistration);
    return { ...party, rawProjectedShare: party.voteShare * (newBaseline / oldBaseline) };
  });
  const rawTotal = raw.reduce((sum, party) => sum + party.rawProjectedShare, 0);
  const projected = raw.map((party) => ({
    ...party,
    projectedShare: (party.rawProjectedShare / rawTotal) * 100,
  }));
  const allocation = largestRemainderSeats(
    projected.map((party) => ({
      id: party.party,
      party: party.party,
      votes: party.projectedShare,
    })),
    region.seats,
    { minShare: 0.2, totalVotesForShare: 100 }
  );
  return projected.map((party) => ({
    ...party,
    projectedSeats: allocation.seats[party.party] ?? 0,
  }));
}

const projections = SNAPSHOT.map((region) => ({ region, parties: projectRegion(region) }));
const partyNames = [
  ...new Set(SNAPSHOT.flatMap((region) => region.parties.map((party) => party.party))),
].sort();

console.log("REGION\tPARTY\tCURRENT_SHARE\tPROJECTED_SHARE\tCURRENT_SEATS\tPROJECTED_SEATS");
for (const { region, parties } of projections) {
  for (const party of parties) {
    console.log(
      [
        region.region,
        party.party,
        party.voteShare.toFixed(2),
        party.projectedShare.toFixed(2),
        party.seats,
        party.projectedSeats,
      ].join("\t")
    );
  }
}

console.log("\nNATIONAL\tPARTY\tCURRENT_SHARE\tPROJECTED_SHARE\tCURRENT_SEATS\tPROJECTED_SEATS");
const totalVotes = SNAPSHOT.reduce((sum, region) => sum + region.totalVotes, 0);
for (const partyName of partyNames) {
  let currentVotes = 0;
  let projectedVotes = 0;
  let currentSeats = 0;
  let projectedSeats = 0;
  for (const { region, parties } of projections) {
    const party = parties.find((entry) => entry.party === partyName);
    if (!party) continue;
    currentVotes += region.totalVotes * (party.voteShare / 100);
    projectedVotes += region.totalVotes * (party.projectedShare / 100);
    currentSeats += party.seats;
    projectedSeats += party.projectedSeats;
  }
  console.log(
    [
      "NATIONAL",
      partyName,
      ((currentVotes / totalVotes) * 100).toFixed(2),
      ((projectedVotes / totalVotes) * 100).toFixed(2),
      currentSeats,
      projectedSeats,
    ].join("\t")
  );
}

console.log("\nTHRESHOLD_FLIPS\tREGION\tPARTY\tCURRENT_SHARE\tPROJECTED_SHARE");
for (const { region, parties } of projections) {
  for (const party of parties) {
    if (party.voteShare >= 20 !== party.projectedShare >= 20) {
      console.log(
        [
          "THRESHOLD_FLIP",
          region.region,
          party.party,
          party.voteShare.toFixed(2),
          party.projectedShare.toFixed(2),
        ].join("\t")
      );
    }
  }
}
