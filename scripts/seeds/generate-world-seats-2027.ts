import type { HistoricalSeat } from "../../src/lib/constants/historicalSeats";
import {
  DE_BUNDESTAG_2021,
  JP_SANGIIN_2020,
  JP_SHUGIIN_2020,
} from "../../src/lib/constants/historicalSeats";

type Target = Record<string, number>;

function apportion(
  source: HistoricalSeat[],
  officeType: string,
  targets: Target
): HistoricalSeat[] {
  const regions = [...new Set(source.map((seat) => seat.state))];
  const regionTotals = Object.fromEntries(
    regions.map((region) => [
      region,
      source
        .filter((seat) => seat.state === region)
        .reduce((total, seat) => total + (seat.seatsHeld ?? 1), 0),
    ])
  );

  return Object.entries(targets).flatMap(([party, target]) => {
    const partyRows = source.filter((seat) => seat.party === party);
    const weights = Object.fromEntries(
      regions.map((region) => [
        region,
        partyRows.length
          ? partyRows
              .filter((seat) => seat.state === region)
              .reduce((total, seat) => total + (seat.seatsHeld ?? 1), 0)
          : regionTotals[region],
      ])
    );
    const weightTotal = Object.values(weights).reduce((total, weight) => total + weight, 0);
    const exact = regions.map((region) => ({
      region,
      value: weightTotal ? (weights[region] * target) / weightTotal : target / regions.length,
    }));
    const seats = Object.fromEntries(exact.map(({ region, value }) => [region, Math.floor(value)]));
    let remaining = target - Object.values(seats).reduce((total, count) => total + count, 0);
    for (const { region } of exact.sort(
      (a, b) => (b.value % 1) - (a.value % 1) || a.region.localeCompare(b.region)
    )) {
      if (remaining-- === 0) break;
      seats[region]++;
    }
    return regions
      .filter((region) => seats[region] > 0)
      .map((state) => ({ state, officeType, party, seatsHeld: seats[state] }));
  });
}

const ukCommons: HistoricalSeat[] = [
  ["EAE", 27, 23, 7, 3, 1],
  ["EMI", 29, 15, 0, 2, 0],
  ["LON", 59, 9, 6, 0, 0],
  ["NEE", 26, 1, 0, 0, 0],
  ["NWE", 65, 3, 3, 0, 0],
  ["SEE", 36, 30, 24, 0, 1],
  ["SWE", 24, 11, 22, 0, 1],
  ["WMI", 38, 15, 2, 0, 1],
  ["YHU", 43, 9, 1, 0, 0],
].flatMap(([state, labour, conservative, libdem, reform, green]) =>
  [
    ["uk_labour", labour],
    ["uk_conservative", conservative],
    ["uk_libdem", libdem],
    ["uk_reform", reform],
    ["uk_green", green],
  ]
    .filter(([, count]) => Number(count) > 0)
    .map(([party, seatsHeld]) => ({
      state: String(state),
      officeType: "commons",
      party: String(party),
      seatsHeld: Number(seatsHeld),
    }))
);
ukCommons.push(
  { state: "EMI", officeType: "commons", party: "uk_independent", seatsHeld: 1 },
  { state: "LON", officeType: "commons", party: "uk_independent", seatsHeld: 1 },
  { state: "NWE", officeType: "commons", party: "uk_speaker", seatsHeld: 1 },
  { state: "NWE", officeType: "commons", party: "uk_independent", seatsHeld: 1 },
  { state: "WMI", officeType: "commons", party: "uk_independent", seatsHeld: 1 },
  { state: "YHU", officeType: "commons", party: "uk_independent", seatsHeld: 1 },
  { state: "SCO", officeType: "commons", party: "uk_labour", seatsHeld: 37 },
  { state: "SCO", officeType: "commons", party: "uk_conservative", seatsHeld: 5 },
  { state: "SCO", officeType: "commons", party: "uk_libdem", seatsHeld: 6 },
  { state: "SCO", officeType: "commons", party: "uk_snp", seatsHeld: 9 },
  { state: "WAL", officeType: "commons", party: "uk_labour", seatsHeld: 27 },
  { state: "WAL", officeType: "commons", party: "uk_libdem", seatsHeld: 1 },
  { state: "WAL", officeType: "commons", party: "uk_plaid", seatsHeld: 4 },
  { state: "NIR", officeType: "commons", party: "uk_sf", seatsHeld: 7 },
  { state: "NIR", officeType: "commons", party: "uk_dup", seatsHeld: 5 },
  { state: "NIR", officeType: "commons", party: "uk_sdlp", seatsHeld: 2 },
  { state: "NIR", officeType: "commons", party: "uk_alliance", seatsHeld: 1 },
  { state: "NIR", officeType: "commons", party: "uk_uup", seatsHeld: 1 },
  { state: "NIR", officeType: "commons", party: "uk_independent", seatsHeld: 2 }
);

const bundles = {
  UK_COMMONS_2027: ukCommons,
  DE_BUNDESTAG_2027: apportion(DE_BUNDESTAG_2021, "bundestag", {
    de_spd: 38,
    de_cdu: 52,
    de_greens: 27,
    de_afd: 49,
    de_csu: 14,
    de_linke: 20,
    de_independent: 1,
  }),
  JP_SHUGIIN_2027: apportion(JP_SHUGIIN_2020, "shugiin", {
    jp_ldp: 316,
    jp_cdp: 48,
    jp_ishin: 36,
    jp_dpfp: 28,
    jp_jcp: 4,
    jp_independent: 33,
  }),
  JP_SANGIIN_2027: apportion(JP_SANGIIN_2020, "sangiin", {
    jp_ldp: 101,
    jp_cdp: 40,
    jp_dpfp: 25,
    jp_komeito: 21,
    jp_ishin: 19,
    jp_jcp: 7,
    jp_sdp: 2,
    jp_independent: 32,
  }),
};

process.stdout.write(
  `import type { HistoricalSeat } from "@/lib/constants/historicalSeats";\n\n/**\n * January 2027 modern legislature snapshot. UK rows reproduce the official\n * 2024 result by region. German 2025 and Japanese 2026/2025 national party\n * totals are apportioned to game regions using the preceding regional pattern.\n * Sources: commonslibrary.parliament.uk/research-briefings/cbp-10009/\n * bundeswahlleiterin.de/bundestagswahlen/2025/ergebnisse/bund-99.html\n * shugiin.go.jp/internet/itdb_english.nsf/html/statics/english/strength.htm\n * sangiin.go.jp/japanese/joho1/kousei/eng/strength/index.htm\n */\n${Object.entries(
    bundles
  )
    .map(
      ([name, rows]) => `export const ${name}: HistoricalSeat[] = ${JSON.stringify(rows, null, 2)};`
    )
    .join("\n\n")}\n`
);
