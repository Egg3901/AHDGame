// src/components/landing/blocColors.ts
/**
 * Cold War bloc coloring for the 1979 landing globe. 1979-accurate membership.
 * Colors are semantic CSS-var tokens so the globe reads in all 11 themes.
 */

export type Bloc = "nato" | "comintern" | "nonAligned" | "disabled";

export const BLOC_COLORS: Record<Bloc, string> = {
  nato: "var(--info)",
  comintern: "var(--danger)",
  nonAligned: "var(--success)",
  disabled: "var(--card-elevated)",
};

/** 1979-accurate bloc membership for the 23-nation seed. */
export const COUNTRY_BLOC_1979: Record<string, Bloc> = {
  // NATO (1979 members in-seed)
  US: "nato",
  UK: "nato",
  FR: "nato",
  IT: "nato",
  DE: "nato",
  TR: "nato",
  // Comintern — Warsaw Pact + Soviet republics
  RU: "comintern",
  DD: "comintern",
  PL: "comintern",
  RO: "comintern",
  HU: "comintern",
  CS: "comintern",
  BG: "comintern",
  // CountryId keys, not ISO alpha-2 - "BY" matched nothing.
  UKR: "comintern",
  BLR: "comintern",
  BAL: "comintern",
  // Non-Aligned — NAM members + neutrals (ES joined NATO only in 1982)
  YU: "nonAligned",
  SE: "nonAligned",
  IE: "nonAligned",
  CN: "nonAligned",
  NG: "nonAligned",
  BR: "nonAligned",
  JP: "nonAligned",
  ES: "nonAligned",
};

export function getCountryBloc(countryId: string): Bloc {
  return COUNTRY_BLOC_1979[countryId] ?? "disabled";
}

export const BLOC_LEGEND: { bloc: Bloc; label: string; color: string }[] = [
  { bloc: "nato", label: "NATO", color: BLOC_COLORS.nato },
  { bloc: "comintern", label: "Comintern", color: BLOC_COLORS.comintern },
  { bloc: "nonAligned", label: "Non-Aligned", color: BLOC_COLORS.nonAligned },
  { bloc: "disabled", label: "Disabled", color: BLOC_COLORS.disabled },
];
