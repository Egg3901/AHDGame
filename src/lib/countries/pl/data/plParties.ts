import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import { plParties2027 } from "./plParties2027";
/**
 * Poland parties. The 2027 democratic roster (October 2023 PKW result) seeds
 * first; the PZPR entry below stays gated to the Cold-War presets, so
 * 1953/1979 worlds never see a modern party and 2027 worlds never see the
 * PZPR (`seedEasternBloc` / the modern seed path filter on `validForPresets`).
 */
export const plParties: PartySeed[] = [
  ...plParties2027,
  {
    seedOrder: 1,
    countryId: "PL",
    name: "Polska Zjednoczona Partia Robotnicza",
    abbreviation: "PZPR",
    color: "#C00000",
    economicPosition: -4,
    socialPosition: 1,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default", "1979-default"],
    regimeStatus: "ruling",
    treasury: 800_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
];
export default plParties;
