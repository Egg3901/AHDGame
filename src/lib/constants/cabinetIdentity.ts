import type { CSSProperties } from "react";
import type { CountryId } from "./countries";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { US_IDENTITY } from "@/lib/countries/us/identity";
import { UK_IDENTITY as UK_FOLDER_IDENTITY } from "@/lib/countries/uk/identity";

export interface CabinetIdentity {
  /** Large faded background glyph + chop fallback. */
  glyph: string;
  serif: "cjk" | "mono";
  gov: string;
  govSoft: string;
  g0: string;
  g1: string;
  g2: string;
}

/** Only cabinet-enabled countries have identities; others fall back to UK. */
export const CABINET_IDENTITY: Partial<Record<CountryId, CabinetIdentity>> = {
  US: US_IDENTITY.cabinet,
  UK: UK_FOLDER_IDENTITY.cabinet,
  CN: {
    glyph: "国",
    serif: "cjk",
    gov: "#d8b25e",
    govSoft: "#e7cd91",
    g0: "#4a1212",
    g1: "#2a0e0e",
    g2: "#160a0e",
  },
  DE: {
    glyph: "DE",
    serif: "mono",
    gov: "#d4a244",
    govSoft: "#e8c884",
    g0: "#2a2218",
    g1: "#1a150d",
    g2: "#100c07",
  },
  JP: JP_IDENTITY.cabinet,
  IE: {
    glyph: "IE",
    serif: "mono",
    gov: "#cba24b",
    govSoft: "#e4c886",
    g0: "#123022",
    g1: "#0d2017",
    g2: "#08130d",
  },
  NG: {
    glyph: "NG",
    serif: "mono",
    gov: "#0f8a4f",
    govSoft: "#57c98a",
    g0: "#06301c",
    g1: "#042214",
    g2: "#02160d",
  },
  // Soviet Union — Council of Ministers (СМ = Совет Министров): deep Soviet
  // red gradient with the gold of the state emblem.
  RU: {
    glyph: "СМ",
    serif: "mono",
    gov: "#d9a93e",
    govSoft: "#eccb7d",
    g0: "#4d0f0f",
    g1: "#320b0b",
    g2: "#1a0707",
  },
  // East Germany, Council of Ministers (DDR): state gold against deep
  // red-black, matching the Soviet precedent.
  DD: {
    glyph: "DDR",
    serif: "mono",
    gov: "#d9a93e",
    govSoft: "#eccb7d",
    g0: "#4d0f0f",
    g1: "#320b0b",
    g2: "#1a0707",
  },
};

/**
 * Resolve the cabinet identity for a country. A missing entry must degrade to
 * the country's own code, never to another country's branding.
 */
export function getCabinetIdentity(countryId: string): CabinetIdentity {
  const entry = CABINET_IDENTITY[countryId as CountryId];
  if (entry) return entry;
  // ⚠ THE FALLBACK IS THE UNITED KINGDOM'S CABINET SHELL, and it used to read
  // a LOCAL `const UK_IDENTITY` declared in this file. That name now collides
  // with the folder export, and importing the folder's under the same name made
  // `UK_IDENTITY.cabinet` resolve to the local literal's missing `.cabinet` --
  // undefined, silently, with typecheck green. The local copy is deleted and the
  // import is aliased so the two can never be confused again.
  return { ...UK_FOLDER_IDENTITY.cabinet, glyph: countryId.toUpperCase(), serif: "mono" };
}

export function cabinetIdentityVars(countryId: string): CSSProperties {
  const id = getCabinetIdentity(countryId);
  return {
    ["--gov" as string]: id.gov,
    ["--gov-soft" as string]: id.govSoft,
    ["--g0" as string]: id.g0,
    ["--g1" as string]: id.g1,
    ["--g2" as string]: id.g2,
  } as CSSProperties;
}
