/**
 * 1990 JP Region Vote Shares
 *
 * Vote share percentages approximated from the 1990 Shugiin (House of
 * Representatives) general election, mapped to the game's 8 regions.
 * Used by `calculateJPStatePartyOrgs` when the active preset is
 * `1991-default`.
 *
 * Key differences from the 2021 dataset:
 *   - CDP doesn't exist yet (founded 2017). The opposition is JSP
 *     (Japan Socialist Party, 1945-1996).
 *   - DPFP doesn't exist yet (founded 2018). The 1991 centrist analogue
 *     is DSP (Democratic Socialist Party, 1960-1994).
 *   - Ishin doesn't exist yet (founded 2010). No `ishin` entry; Kansai
 *     vote share redistributes to LDP / JSP / Komeito / DSP.
 *   - Komeito refers to the pre-1994 organisation; same `komeito` slug
 *     used for engine compatibility.
 *
 * National 1990 result: LDP 46.1, JSP 24.4, Komeito 8.0, JCP 8.0,
 * DSP 4.8, Shaminren/Independents ~9. Regional weighting reflects
 * known strongholds (LDP rural, JSP industrial, Komeito Tokyo/Osaka
 * metros, JCP urban centres).
 */

export const JP_REGION_VOTE_SHARES_1990: Record<string, Record<string, number>> = {
  HOK: { ldp: 44, jsp: 24, komeito: 5, jcp: 7, dsp: 4 },
  TOH: { ldp: 50, jsp: 28, komeito: 6, jcp: 5, dsp: 3 },
  KAN: { ldp: 40, jsp: 24, komeito: 12, jcp: 12, dsp: 5 },
  CHU: { ldp: 48, jsp: 22, komeito: 8, jcp: 8, dsp: 4 },
  KNS: { ldp: 42, jsp: 22, komeito: 12, jcp: 10, dsp: 7 },
  CGK: { ldp: 50, jsp: 24, komeito: 7, jcp: 7, dsp: 4 },
  SHI: { ldp: 52, jsp: 24, komeito: 6, jcp: 6, dsp: 4 },
  KYU: { ldp: 48, jsp: 22, komeito: 8, jcp: 8, dsp: 4 },
};

export default JP_REGION_VOTE_SHARES_1990;
