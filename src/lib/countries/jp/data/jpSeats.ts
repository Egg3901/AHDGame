/**
 * Japan's chamber seat tables: Shugiin and Sangiin seats per region, and the
 * governorships.
 *
 * \u26a0\ufe0f THESE HAD TWO DEFINITIONS AND NOTHING KEEPING THEM EQUAL. They were
 * declared in `constants/states.ts` and declared AGAIN, by value, inside
 * `jp/elections.ts`, whose own comment said they were "reproduced here from the
 * pre-move snapshot" and that a later phase would "decide whether it forwards".
 * That decision was never made. Measured, `===` said different objects and
 * `JSON.stringify` said equal values -- correct on the day it was written and
 * silently divergent after the first edit to either side, which is precisely the
 * failure country folders exist to end.
 *
 * It survived because the 41-forwarder identity harness only checks registries
 * with a `JP:` key, and these have none: `constants/states.ts` is keyed by
 * REGION, and the country lives in the symbol name. Four separate coverage rules
 * missed this file for the same reason.
 *
 * `constants/states.ts` now re-exports from here, so every consumer is
 * unchanged and there is one definition.
 */

/** Shugiin (House of Representatives) seat counts per region. Total = 465. */
export const JP_SHUGIIN_SEATS: Record<string, number> = {
  HOK: 12,
  TOH: 37,
  KAN: 150,
  CHU: 81,
  KNS: 82,
  CGK: 28,
  SHI: 14,
  KYU: 61,
};

export const TOTAL_JP_SHUGIIN_SEATS = 465;

/** Sangiin (House of Councillors) seat counts per region. Total = 248. */
export const JP_SANGIIN_SEATS: Record<string, number> = {
  HOK: 7,
  TOH: 20,
  KAN: 80,
  CHU: 44,
  KNS: 44,
  CGK: 14,
  SHI: 8,
  KYU: 31,
};

export const TOTAL_JP_SANGIIN_SEATS = 248;

/** JP Governor seats per region. 1 governor per region. */
export const JP_GOVERNOR_SEATS: Record<string, number> = {
  HOK: 1,
  TOH: 1,
  KAN: 1,
  CHU: 1,
  KNS: 1,
  CGK: 1,
  SHI: 1,
  KYU: 1,
};
