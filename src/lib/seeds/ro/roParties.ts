import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Romania ruling party (Cold-War presets) — era-specific identity.
 *
 *  - 1953: Partidul Muncitoresc Român (PMR), the "Romanian Workers' Party"
 *    (1948–1965) — Gheorghiu-Dej's Stalinist ruling party, the ACTUAL party in
 *    power in 1953.
 *  - 1979: Partidul Comunist Român (PCR) — the party renamed itself back to
 *    "Communist" only in 1965, under Ceaușescu's hardline national communism.
 *
 * "PCR" did not exist as the party's name until 1965, so it cannot be seeded into
 * a 1953 world. Each entry is gated to its own preset via `validForPresets`;
 * `seedEasternBloc` filters with `isPartyValidForPreset` so only the entry
 * matching the active preset is upserted, and the shared `seedOrder` never
 * collides. Positions on the -5..+5 scale.
 */
export const roParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "RO",
    name: "Partidul Muncitoresc Român",
    abbreviation: "PMR",
    color: "#C00000",
    economicPosition: -4, // Stalinist central planning; forced heavy-industry drive
    socialPosition: 3, // Securitate terror; Gheorghiu-Dej Stalinism
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default"],
    regimeStatus: "ruling",
    treasury: 700_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    seedOrder: 1,
    countryId: "RO",
    name: "Partidul Comunist Român",
    abbreviation: "PCR",
    color: "#C00000",
    economicPosition: -4,
    socialPosition: 3,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1979-default"],
    regimeStatus: "ruling",
    treasury: 700_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
];
export default roParties;
