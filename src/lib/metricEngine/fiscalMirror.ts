/**
 * Budget-sync (📊): the fiscal-readout governance metrics mirror the real
 * federalBudget ratios EXACTLY each turn — they deliberately leave the
 * coexistence regime (no simBaseline, no policy-delta; the value IS the ratio).
 * The persist gate (`isStored`) scopes each: schuldenbremse only where a region
 * seeds it (2019-era presets), the ratios only on budgeted countries.
 */
export interface FiscalRatios {
  debtToGdp: number; // percent, [0,300]
  budgetBalance: number; // percent of GDP, [-100,100]
  schuldenbremseHeadroom: number; // percent of GDP, [-1,1]
}

export const FISCAL_MIRROR_METRICS = [
  { id: "governance.debtToGdp", key: "debtToGdp", decimals: 1 },
  { id: "governance.budgetBalance", key: "budgetBalance", decimals: 1 },
  { id: "governance.schuldenbremseHeadroom", key: "schuldenbremseHeadroom", decimals: 2 },
] as const;

/**
 * Bare metric IDs of the mirror-controlled (computed) fiscal metrics. These are a
 * pure readout of the real treasury — the budget mirror is their single source of
 * truth — so the POLICY layer must never write to them (a law moves the budget
 * only by changing its real tax/spending channel, which the mirror reads). The
 * policyEffects chokepoint consults this set; see also the §4.7 doctrine.
 */
export const MIRROR_CONTROLLED_METRIC_IDS: ReadonlySet<string> = new Set(
  FISCAL_MIRROR_METRICS.map((m) => m.key)
);

/** Build `${id}.value` set-fields for the mirror metrics the region already stores. */
export function fiscalMirrorFields(
  ratios: FiscalRatios | undefined,
  isStored: (id: string) => boolean
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!ratios) return out;
  for (const m of FISCAL_MIRROR_METRICS) {
    if (!isStored(m.id)) continue;
    const f = 10 ** m.decimals;
    out[`${m.id}.value`] = Math.round(ratios[m.key] * f) / f;
  }
  return out;
}
