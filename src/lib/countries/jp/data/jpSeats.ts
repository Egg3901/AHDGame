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

/**
 * Shugiin seats per region — the 1986-94 medium-constituency system, in force
 * for `1991-default`. Mirrors `jpRegions1991.houseDistricts` exactly.
 *
 * ⚠️ JAPAN HAD NO ERA SEAT MAPS AT ALL, and unlike the UK it had no selector
 * either. A 1991 world declared a 512-seat Shugiin, seated 512, and then
 * spawned and allocated its elections against the modern 465 — the same defect
 * ticket #1058 fixed for the 1953 Commons, two chambers over.
 */
export const JP_SHUGIIN_SEATS_1991: Record<string, number> = {
  HOK: 23,
  TOH: 50,
  KAN: 145,
  CHU: 86,
  KNS: 92,
  CGK: 34,
  SHI: 20,
  KYU: 62,
};

export const TOTAL_JP_SHUGIIN_SEATS_1991 = 512;

/**
 * Sangiin seats per region for `1991-default`. 252 members, the size the
 * chamber held from 1983 until the 1998 reduction.
 *
 * Every region's total is even, because half the Sangiin is elected every three
 * years and `JP_SANGIIN_1989` splits each region evenly across the two
 * staggered classes — 126 seats apiece. An odd regional magnitude would make
 * one class permanently larger than the other.
 */
export const JP_SANGIIN_SEATS_1991: Record<string, number> = {
  HOK: 8,
  TOH: 22,
  KAN: 78,
  CHU: 44,
  KNS: 46,
  CGK: 16,
  SHI: 10,
  KYU: 28,
};

export const TOTAL_JP_SANGIIN_SEATS_1991 = 252;

/** Shugiin seats per region for the active preset (512 in 1991, else 465). */
export function getJpShugiinSeats(preset: string | undefined): Record<string, number> {
  return preset === "1991-default" ? JP_SHUGIIN_SEATS_1991 : JP_SHUGIIN_SEATS;
}

/** Sangiin seats per region for the active preset (252 in 1991, else 248). */
export function getJpSangiinSeats(preset: string | undefined): Record<string, number> {
  return preset === "1991-default" ? JP_SANGIIN_SEATS_1991 : JP_SANGIIN_SEATS;
}

/**
 * Seats contested by one Sangiin class in a region.
 *
 * Class 1 receives the extra seat when a modern regional total is odd; class 2
 * receives the remainder. Computing `ceil(total / 2)` for both classes creates
 * phantom seats in Hokkaido and Kyushu (250 contested against a 248-seat
 * chamber), while the 1991 map's all-even totals conceal the error.
 */
export function getJpSangiinClassSeats(
  preset: string | undefined,
  regionId: string,
  chamberClass: 1 | 2
): number {
  const totalSeats = getJpSangiinSeats(preset)[regionId] ?? 2;
  return chamberClass === 1 ? Math.ceil(totalSeats / 2) : Math.floor(totalSeats / 2);
}

/** National Shugiin size for the active preset. */
export function getTotalJpShugiinSeats(preset: string | undefined): number {
  return preset === "1991-default" ? TOTAL_JP_SHUGIIN_SEATS_1991 : TOTAL_JP_SHUGIIN_SEATS;
}

/** National Sangiin size for the active preset. */
export function getTotalJpSangiinSeats(preset: string | undefined): number {
  return preset === "1991-default" ? TOTAL_JP_SANGIIN_SEATS_1991 : TOTAL_JP_SANGIIN_SEATS;
}

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
