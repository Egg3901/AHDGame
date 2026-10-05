/**
 * Importers spend commodity-unit budgets to buy goods from foreign sellers.
 * `clearCommodity` allocates routes by affinity while respecting supply, tariffs, and embargoes.
 */
import type { CountryId } from "@/lib/constants/countries";
import { TRADE_IPF_ITERATIONS } from "../constants";
import type { ClearingInput, ClearingResult, CountryClearing } from "../types";
import { normalizeImportCostMultiplier } from "./importCostMultiplier";

/**
 * Clear one commodity's surplus against deficit across countries.
 *
 * Volume that changes hands is bounded by available surplus, importer budgets,
 * and route caps. IPF allocates across affinity-weighted exporter/importer pairs.
 * Tariff-inclusive costs use the importer's raw deficit budget. Residuals stay uncleared.
 *
 * All quantities are in commodity UNITS. Pure: no DB, no currency.
 */
export function clearCommodity(input: ClearingInput): ClearingResult {
  const { countries, supply, demand, affinity, capUnits, importCostMultiplier } = input;

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

  // The smaller raw side is treated as a target; the larger side is a ceiling.
  // The tariff-inclusive importer budget can reduce actual cleared volume.
  // The affinity prior can then bias allocation on the non-binding side.
  // A high-affinity partner can capture more, up to its surplus/deficit cap, instead of every
  // country getting a flat proportional share. Embargo caps clamp cells.
  const surplusBinds = totalSurplus <= totalDeficit;
  const rowLimit: Record<string, number> = surplus; // exporter surplus
  const colLimit: Record<string, number> = deficit; // importer deficit

  // Seed with affinity prior (self-pairs excluded).
  const m: Record<string, Record<string, number>> = {};
  const costMultiplier: Record<string, Record<string, number>> = {};
  for (const e of exporters) {
    m[e] = {};
    costMultiplier[e] = {};
    for (const i of importers) {
      m[e][i] = e === i ? 0 : Math.max(0, affinity(e, i));
      costMultiplier[e][i] =
        m[e][i] > 0 ? normalizeImportCostMultiplier(importCostMultiplier?.(e, i)) : 1;
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
    // Column pass: tariff-inclusive route costs cannot exceed the raw deficit.
    for (const i of importers) {
      let cs = 0;
      for (const e of exporters) {
        if (m[e][i] > 0) cs += m[e][i] * costMultiplier[e][i];
      }
      if (cs > 0) {
        const f = surplusBinds ? Math.min(1, colLimit[i] / cs) : colLimit[i] / cs;
        for (const e of exporters) m[e][i] *= f;
      }
    }
    clampCaps();
  }

  // Feasibility. IPF reaches the binding side's target only when the affinity
  // matrix allows it. With structural zeros (curtained or embargoed pairs,
  // zero-affinity routes), an importer can be reachable from exporters that
  // together hold less surplus than its deficit. A column pass may spend up to
  // its full budget and push reachable exporters past their own surplus: prod t1278
  // had Czechoslovakia exporting 12.8M energy units against a 1.6M surplus, and
  // every turn since at least t1240 HU and BG exported 50x their software
  // surplus. Convergence then floored their domestic supply at 0. A country
  // cannot ship what it does not have, so both margins are ceilings on the
  // way out; the unreachable remainder stays unmet.
  for (const e of exporters) {
    let rs = 0;
    for (const i of importers) rs += m[e][i];
    if (rs > rowLimit[e]) {
      const f = rowLimit[e] / rs;
      for (const i of importers) m[e][i] *= f;
    }
  }
  for (const i of importers) {
    let cs = 0;
    for (const e of exporters) {
      if (m[e][i] > 0) cs += m[e][i] * costMultiplier[e][i];
    }
    if (cs > colLimit[i]) {
      const f = colLimit[i] / cs;
      for (const e of exporters) m[e][i] *= f;
    }
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
