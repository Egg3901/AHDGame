import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Hungary ruling party (Cold-War presets) — era-specific identity.
 *
 *  - 1953: Magyar Dolgozók Pártja (MDP), the "Hungarian Working People's Party"
 *    (1948–1956) — Rákosi's hardline Stalinist ruling party, the ACTUAL party in
 *    power in 1953.
 *  - 1979: Magyar Szocialista Munkáspárt (MSZMP) — Kádár's party, founded only in
 *    late 1956 out of the crushed revolution; by 1979 running "goulash communism."
 *
 * The MSZMP did not exist until October/November 1956, so it cannot be seeded
 * into a 1953 world. Each entry is gated to its own preset via `validForPresets`;
 * `seedEasternBloc` filters with `isPartyValidForPreset` so only the entry
 * matching the active preset is upserted, and the shared `seedOrder` never
 * collides. Positions on the -5..+5 scale.
 */
export const huParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "HU",
    name: "Magyar Dolgozók Pártja",
    abbreviation: "MDP",
    color: "#C00000",
    economicPosition: -4, // Stalinist forced-draft heavy industry; full command economy
    socialPosition: 2, // ÁVH terror state; Rákosi personality cult
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
    countryId: "HU",
    name: "Magyar Szocialista Munkáspárt",
    abbreviation: "MSZMP",
    color: "#C00000",
    economicPosition: -3,
    socialPosition: 1,
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
export default huParties;
