import { ELECTION_2024_MARGIN } from "../../src/lib/data/2024ElectionResults";

const YEARS = [2022, 2023, 2024] as const;
const TARGET_YEAR = 2027;
const TABLES = ["B01001", "B03002", "B15003", "B19001"] as const;

const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
};

type Row = Record<string, number>;
type Dimension = Record<string, number>;

function sum(row: Row, table: string, numbers: number[]): number {
  return numbers.reduce(
    (total, number) => total + row[`${table}_E${String(number).padStart(3, "0")}`],
    0
  );
}

async function loadTable(year: number, table: string): Promise<Record<string, Row>> {
  const url = `https://www2.census.gov/programs-surveys/acs/summary_file/${year}/table-based-SF/data/1YRData/acsdt1y${year}-${table.toLowerCase()}.dat`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const lines = (await response.text()).trim().split("\n");
  const headers = lines.shift()!.split("|");
  const result: Record<string, Row> = {};
  for (const line of lines) {
    const cells = line.split("|");
    const fips = /^0400000US(\d{2})$/.exec(cells[0])?.[1];
    const state = fips ? FIPS_TO_STATE[fips] : undefined;
    if (!state) continue;
    result[state] = Object.fromEntries(
      headers.map((header, index) => [header, Number(cells[index])])
    );
  }
  return result;
}

function shares(row: Row, table: string): Dimension {
  if (table === "B03002") {
    const total = row.B03002_E001;
    const known = row.B03002_E003 + row.B03002_E004 + row.B03002_E006 + row.B03002_E012;
    return {
      white: row.B03002_E003 / total,
      black: row.B03002_E004 / total,
      hispanic: row.B03002_E012 / total,
      asian: row.B03002_E006 / total,
      other: (total - known) / total,
    };
  }
  if (table === "B15003") {
    const total = row.B15003_E001;
    const college = row.B15003_E022;
    const graduate = sum(row, table, [23, 24, 25]);
    return {
      no_college: (total - college - graduate) / total,
      college: college / total,
      graduate: graduate / total,
    };
  }
  if (table === "B19001") {
    const total = row.B19001_E001;
    return {
      low: sum(row, table, [2, 3, 4, 5, 6, 7, 8, 9, 10]) / total,
      middle: sum(row, table, [11, 12, 13, 14, 15]) / total,
      high: sum(row, table, [16, 17]) / total,
    };
  }
  const age = {
    young: sum(row, table, [7, 8, 9, 10, 11, 12, 31, 32, 33, 34, 35, 36]),
    mid: sum(row, table, [13, 14, 15, 37, 38, 39]),
    mature: sum(row, table, [16, 17, 18, 19, 40, 41, 42, 43]),
    senior: sum(row, table, [20, 21, 22, 23, 24, 25, 44, 45, 46, 47, 48, 49]),
  };
  const adultTotal = Object.values(age).reduce((total, value) => total + value, 0);
  return Object.fromEntries(Object.entries(age).map(([key, value]) => [key, value / adultTotal]));
}

function project(values: number[]): number {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const slope = (values[2] - values[0]) / 2;
  return Math.max(0, mean + slope * (TARGET_YEAR - 2023));
}

function integerPercentages(raw: Dimension): Dimension {
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  const scaled = Object.entries(raw).map(([key, value]) => ({ key, exact: (value * 100) / total }));
  const result = Object.fromEntries(scaled.map(({ key, exact }) => [key, Math.floor(exact)]));
  let remainder = 100 - Object.values(result).reduce((sum, value) => sum + value, 0);
  for (const { key } of scaled.sort(
    (a, b) => (b.exact % 1) - (a.exact % 1) || a.key.localeCompare(b.key)
  )) {
    if (remainder-- === 0) break;
    result[key]++;
  }
  return result;
}

function ideology(state: string): Dimension {
  const margin = ELECTION_2024_MARGIN[state];
  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, Math.round(value)));
  return {
    evangelicals: clamp(22 - margin * 0.28, 4, 45),
    environmentalists: clamp(13 + margin * 0.16, 4, 30),
    libertarians: clamp(10 - margin * 0.015, 8, 13),
    progressives: clamp(14 + margin * 0.25, 4, 38),
    patriots: clamp(25 - margin * 0.18, 10, 42),
    gunowners: clamp(30 - margin * 0.25, 8, 50),
  };
}

function literal(value: Dimension): string {
  return `{ ${Object.entries(value)
    .map(([key, share]) => `${key}: ${share}`)
    .join(", ")} }`;
}

async function main(): Promise<void> {
  const observations = await Promise.all(
    YEARS.flatMap((year) =>
      TABLES.map(async (table) => ({ year, table, rows: await loadTable(year, table) }))
    )
  );
  const states = Object.values(FIPS_TO_STATE).sort();
  const lines = states.map((state) => {
    const dimensions = TABLES.map((table) => {
      const yearly = YEARS.map((year) =>
        shares(
          observations.find((item) => item.year === year && item.table === table)!.rows[state],
          table
        )
      );
      const projected = Object.fromEntries(
        Object.keys(yearly[0]).map((key) => [key, project(yearly.map((value) => value[key]))])
      );
      return integerPercentages(projected);
    });
    const [age, race, education, wealth] = dimensions;
    return `  ${state}: {\n    race: ${literal(race)},\n    education: ${literal(education)},\n    wealth: ${literal(wealth)},\n    age: ${literal(age)},\n    ideology: ${literal(ideology(state))},\n  },`;
  });
  process.stdout.write('import { stateCensusData2023 } from "./stateCensusData2023";\n');
  process.stdout.write(
    `import type { Layer1Config } from "./stateDemographics";\n\n/**\n * Projected January 2027 US state demographic profiles.\n *\n * Race (B03002), education among adults 25+ (B15003), household income\n * (B19001), and age among adults 18+ (B01001) use ACS 1-year estimates for\n * 2022, 2023, and 2024. Each underlying share is fitted with a least-squares\n * linear trend and evaluated at 2027, clamped at zero, then largest-remainder\n * rounded so every dimension totals 100. Income is expressed in nominal ACS\n * brackets: low below $50,000, middle $50,000 to $149,999, high $150,000+.\n *\n * Ideology is not an ACS measure. Its independent, non-additive shares are a\n * game calibration anchored to each state's certified 2024 presidential margin.\n * Regenerate with scripts/seeds/generate-state-census-2027.ts.\n */\nexport const stateCensusData2027: Record<string, Layer1Config> = {\n${lines.join("\n")}\n};\n`
  );
  process.stdout.write(
    "\n// ACS projects the composition shares, not political positions. Preserve each\n" +
      "// state's latest calibrated 2023 position surface until a newer calibration is\n" +
      "// authored, so demographic change does not erase regional political character.\n" +
      "for (const [stateId, config] of Object.entries(stateCensusData2027)) {\n" +
      "  config.positions = stateCensusData2023[stateId]?.positions;\n" +
      "}\n"
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
