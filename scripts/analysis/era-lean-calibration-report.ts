/**
 * Era lean calibration report.
 *
 * For every US anchor era, derives per-state leans through the live seed path
 * (`deriveRegionLeans`) and reports the distribution shape the vote model will
 * actually see: spread, axis collinearity, national mean, and (when the
 * historical margins dataset is present) the rank agreement between the
 * combined lean and the era's real presidential geography.
 *
 * Ideology is NOT party: rank agreement is an ADVISORY check on geography, not
 * a target of lean == margin. Org-dominated regions (the 1953 Solid South) are
 * expected to disagree and are reported separately, not scored.
 *
 * Run: npx tsx --tsconfig tsconfig.json scripts/analysis/era-lean-calibration-report.ts
 */
import { deriveRegionLeans } from "@/lib/seeds/calibration/deriveRegionLeans";
import type { EraId } from "@/lib/seeds/presetSelector";

// The 2019 per-state calibration's empirical transfer from real margins to
// leans (fit 2026-08-19: lean = SLOPE * marginToLean(margin) + INTERCEPT,
// r = 0.97). Other eras should land on the same ruler so cross-era comparisons
// mean something.
export const CANONICAL_TRANSFER = { slope: 0.526, intercept: 0.527 };

const ERAS: EraId[] = ["1953", "1979", "1991", "1999", "2007", "2019", "2023"];

/** Anchor presidential election per era for geography checks. */
const ANCHOR_ELECTION: Partial<Record<EraId, string>> = {
  "1953": "1952",
  "1979": "1980",
  "1991": "1992",
  "1999": "2000",
  "2007": "2008",
};

/** 1953 Solid South: results driven by one-party organization, not ideology. */
const ORG_DOMINATED: Partial<Record<EraId, string[]>> = {
  "1953": ["AL", "MS", "SC", "LA", "GA", "AR", "TX", "VA", "NC", "TN"],
};

interface MarginsModule {
  margins: Partial<Record<string, Record<string, number>>>;
  houseNationalMargin: Partial<Record<string, number>>;
}

async function loadMargins(): Promise<MarginsModule | null> {
  try {
    const m = await import("@/lib/data/historicalPresidentialMargins");
    return { margins: m.HISTORICAL_MARGINS, houseNationalMargin: m.HOUSE_NATIONAL_MARGIN };
  } catch {
    return null;
  }
}

function stats(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { min: s[0], max: s[v.length - 1], mean, sd };
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    idx.forEach(([, orig], i) => (r[orig] = i));
    return r;
  };
  return pearson(rank(xs), rank(ys));
}

const f = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);

async function main() {
  const marginsData = await loadMargins();
  if (!marginsData) {
    console.log("(historical margins dataset not present; geography checks skipped)\n");
  }

  for (const era of ERAS) {
    const leans = deriveRegionLeans("US", era);
    const econ = stats(leans.map((l) => l.economic));
    const social = stats(leans.map((l) => l.social));
    const display = stats(leans.map((l) => l.display));
    const r = pearson(
      leans.map((l) => l.economic),
      leans.map((l) => l.social)
    );
    const oppSign = leans.filter((l) => l.economic >= 0 !== l.social >= 0).length;

    console.log(`=== ${era} (n=${leans.length}) ===`);
    console.log(
      `econ    mean ${f(econ.mean)}  sd ${econ.sd.toFixed(2)}  range ${f(econ.min)}..${f(econ.max)}`
    );
    console.log(
      `social  mean ${f(social.mean)}  sd ${social.sd.toFixed(2)}  range ${f(social.min)}..${f(social.max)}`
    );
    console.log(
      `display mean ${f(display.mean)}  sd ${display.sd.toFixed(2)}  econ~social r=${r.toFixed(3)}  oppSign=${oppSign}`
    );

    const election = ANCHOR_ELECTION[era];
    const margins = election ? marginsData?.margins[election] : undefined;
    if (margins) {
      const excluded = new Set(ORG_DOMINATED[era] ?? []);
      const scored = leans.filter(
        (l) => margins[l.regionId] !== undefined && !excluded.has(l.regionId)
      );
      const rho = spearman(
        scored.map((l) => l.display),
        scored.map((l) => -margins[l.regionId])
      );
      const houseMargin = marginsData?.houseNationalMargin[election];
      const targetMean =
        houseMargin !== undefined
          ? CANONICAL_TRANSFER.slope * (-houseMargin / 10) + CANONICAL_TRANSFER.intercept
          : undefined;
      console.log(
        `geography rank rho=${rho.toFixed(3)} over ${scored.length} states (excluded org-dominated: ${excluded.size})` +
          (targetMean !== undefined
            ? `  national mean target ${f(targetMean)} (House ${election} D${houseMargin! >= 0 ? "+" : ""}${houseMargin})`
            : "")
      );
      if (excluded.size > 0) {
        const orgRows = leans
          .filter((l) => excluded.has(l.regionId) && margins[l.regionId] !== undefined)
          .map(
            (l) =>
              `${l.regionId} display ${f(l.display)} real D${margins[l.regionId] >= 0 ? "+" : ""}${margins[l.regionId].toFixed(0)}`
          );
        console.log(`org-dominated (informational): ${orgRows.join("; ")}`);
      }
      const worst = scored
        .map((l) => ({
          id: l.regionId,
          lean: l.display,
          margin: margins[l.regionId],
        }))
        .sort(
          (a, b) =>
            Math.abs(
              b.lean - (CANONICAL_TRANSFER.slope * (-b.margin / 10) + CANONICAL_TRANSFER.intercept)
            ) -
            Math.abs(
              a.lean - (CANONICAL_TRANSFER.slope * (-a.margin / 10) + CANONICAL_TRANSFER.intercept)
            )
        )
        .slice(0, 5)
        .map(
          (x) =>
            `${x.id} lean ${f(x.lean)} vs transfer ${f(CANONICAL_TRANSFER.slope * (-x.margin / 10) + CANONICAL_TRANSFER.intercept)}`
        );
      console.log(`largest transfer residuals: ${worst.join("; ")}`);
    }
    console.log("");
  }
}

main();
