/**
 * Measurement harness for the granular electorate's ideological distribution.
 * Prints per-state turnout-weighted mean leans, min/max cell leans, and the
 * share of the (turnout-weighted) electorate right of 0 / right of +1 /
 * left of -1 for the 2019 preset. Run: npx tsx scripts/measure-granular-balance.ts
 */
import { deriveGranularElectorateUnits } from "../src/lib/demographics/granularElectorate";
import { DEFAULT_SEED_PRESET } from "../src/lib/constants/seedPreset";

const STATES = [
  "AL",
  "WY",
  "SC",
  "MS",
  "TX",
  "FL",
  "NC",
  "OH",
  "PA",
  "WI",
  "MI",
  "AZ",
  "CO",
  "VA",
  "NY",
  "CA",
  "MA",
  "DC",
];

const wavg = (
  units: { share: number; turnout: number }[],
  f: (u: { share: number; turnout: number }) => number
) => {
  let num = 0;
  let den = 0;
  for (const u of units) {
    const w = u.share * u.turnout;
    num += w * f(u);
    den += w;
  }
  return den > 0 ? num / den : 0;
};

let natNum = 0;
let natDen = 0;
console.log("state  meanE  meanS   minE   maxE  |  %>0    %>+1   %<-1   units");
for (const s of STATES) {
  const derived = deriveGranularElectorateUnits(
    "US",
    s,
    process.env.AHD_PRESET ?? DEFAULT_SEED_PRESET,
    null
  );
  if (!derived) {
    console.log(`${s}: no census`);
    continue;
  }
  const units = derived.units;
  const meanE = wavg(units, (u) => (u as any).economicLean);
  const meanS = wavg(units, (u) => (u as any).socialLean);
  const minE = Math.min(...units.map((u: any) => u.economicLean));
  const maxE = Math.max(...units.map((u: any) => u.economicLean));
  const totW = units.reduce((a: number, u: any) => a + u.share * u.turnout, 0);
  const frac = (pred: (u: any) => boolean) =>
    (units.filter(pred).reduce((a: number, u: any) => a + u.share * u.turnout, 0) / totW) * 100;
  const gt0 = frac((u) => u.economicLean > 0);
  const gt1 = frac((u) => u.economicLean > 1);
  const ltm1 = frac((u) => u.economicLean < -1);
  natNum += meanE;
  natDen += 1;
  console.log(
    `${s.padEnd(5)} ${meanE.toFixed(2).padStart(6)} ${meanS.toFixed(2).padStart(6)} ${minE
      .toFixed(2)
      .padStart(6)} ${maxE.toFixed(2).padStart(6)}  | ${gt0.toFixed(1).padStart(5)}% ${gt1
      .toFixed(1)
      .padStart(5)}% ${ltm1.toFixed(1).padStart(5)}%   ${units.length}`
  );
}
console.log(`\nsample mean of state means (econ): ${(natNum / natDen).toFixed(3)}`);
