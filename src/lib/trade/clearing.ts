import type { CountryId } from "@/lib/constants/countries";
import { TRADE_IPF_ITERATIONS } from "./constants";
import type { ClearingInput, ClearingResult, CountryClearing } from "./types";

/**
 * Clear one commodity's surplus against deficit across countries.
 *
 * Volume that changes hands = min(Σ surplus, Σ deficit). It is distributed
 * across exporter→importer pairs by iterative proportional fitting (IPF) of an
 * affinity-seeded matrix toward row targets ∝ surplus and column targets ∝
 * deficit — the maximum-entropy ("gravity") allocation consistent with both
 * margins. Embargo caps clamp individual cells each iteration; capped volume
 * stays uncleared.
 *
 * All quantities are in commodity UNITS. Pure: no DB, no currency.
 */
export function clearCommodity(input: ClearingInput): ClearingResult {
  const { countries, supply, demand, affinity, capUnits } = input;

  const surplus: Record<string, number> = {};
  const deficit: Record<string, number> = {};
  let totalSurplus = 0;
  let totalDeficit = 0;
  for (const c of countries) {
    const net = (supply[c] ?? 0) - (demand[c] ?? 0);
    if (net > 0) {
      surplus[c] = net;
      totalSurplus += net;
    } else if (net < 0) {
      deficit[c] = -net;
      totalDeficit += -net;
    }
  }

  const flow: Record<string, Record<string, number>> = {};
  for (const e of countries) flow[e] = {};

  const clearedTarget = Math.min(totalSurplus, totalDeficit);
  if (clearedTarget <= 0) {
    return {
      flow,
      perCountry: buildPerCountry(countries, flow, surplus, deficit),
      clearedVolume: 0,
    };
  }

  const exporters = countries.filter((c) => surplus[c] > 0);
  const importers = countries.filter((c) => deficit[c] > 0);

  // The smaller side binds: it is scaled to an EXACT target (its full surplus
  // or deficit), while the larger side is only a CEILING. This lets the
  // affinity prior bias allocation on the non-binding side — a high-affinity
  // partner can capture more, up to its surplus/deficit cap — instead of every
  // country getting a flat proportional share. Embargo caps clamp cells.
  const surplusBinds = totalSurplus <= totalDeficit;
  const rowLimit: Record<string, number> = surplus; // exporter surplus
  const colLimit: Record<string, number> = deficit; // importer deficit

  // Seed with affinity prior (self-pairs excluded).
  const m: Record<string, Record<string, number>> = {};
  for (const e of exporters) {
    m[e] = {};
    for (const i of importers) {
      m[e][i] = e === i ? 0 : Math.max(0, affinity(e, i));
    }
  }

  const clampCaps = () => {
    if (!capUnits) return;
    for (const e of exporters) {
      for (const i of importers) {
        const cap = capUnits(e, i);
        if (cap !== undefined && m[e][i] > cap) m[e][i] = cap;
      }
    }
  };

  for (let iter = 0; iter < TRADE_IPF_ITERATIONS; iter++) {
    // Row pass: exact target if surplus binds, else ceiling (scale down only).
    for (const e of exporters) {
      let rs = 0;
      for (const i of importers) rs += m[e][i];
      if (rs > 0) {
        const f = surplusBinds ? rowLimit[e] / rs : Math.min(1, rowLimit[e] / rs);
        for (const i of importers) m[e][i] *= f;
      }
    }
    clampCaps();
    // Column pass: exact target if deficit binds, else ceiling (scale down only).
    for (const i of importers) {
      let cs = 0;
      for (const e of exporters) cs += m[e][i];
      if (cs > 0) {
        const f = surplusBinds ? Math.min(1, colLimit[i] / cs) : colLimit[i] / cs;
        for (const e of exporters) m[e][i] *= f;
      }
    }
    clampCaps();
  }

  for (const e of exporters) {
    for (const i of importers) {
      if (m[e][i] > 0) flow[e][i] = m[e][i];
    }
  }

  const perCountry = buildPerCountry(countries, flow, surplus, deficit);
  let clearedVolume = 0;
  for (const c of countries) clearedVolume += perCountry[c].exports;

  return { flow, perCountry, clearedVolume };
}

/**
 * Roll a flow matrix up into per-country exports/imports/net/uncleared.
 * `uncleared` = leftover surplus (+) or unmet deficit (−).
 */
function buildPerCountry(
  countries: CountryId[],
  flow: Record<string, Record<string, number>>,
  surplus: Record<string, number>,
  deficit: Record<string, number>
): Record<string, CountryClearing> {
  const out: Record<string, CountryClearing> = {};
  for (const c of countries) {
    let exports = 0;
    for (const i of Object.keys(flow[c] ?? {})) exports += flow[c][i];
    let imports = 0;
    for (const e of countries) imports += flow[e]?.[c] ?? 0;
    const uncleared = (surplus[c] ?? 0) - exports - ((deficit[c] ?? 0) - imports);
    out[c] = { exports, imports, net: exports - imports, uncleared };
  }
  return out;
}
