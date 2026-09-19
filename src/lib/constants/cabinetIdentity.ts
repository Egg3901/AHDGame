import type { CSSProperties } from "react";
import type { CountryId } from "./countries";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { US_IDENTITY } from "@/lib/countries/us/identity";
import { UK_IDENTITY as UK_FOLDER_IDENTITY } from "@/lib/countries/uk/identity";
import { DE_IDENTITY } from "@/lib/countries/de/identity";
import { CN_IDENTITY } from "@/lib/countries/cn/identity";
import { IE_IDENTITY } from "@/lib/countries/ie/identity";
import { RU_IDENTITY } from "@/lib/countries/ru/identity";
import { DD_IDENTITY } from "@/lib/countries/dd/identity";
import { NG_IDENTITY } from "@/lib/countries/ng/identity";

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
  CN: CN_IDENTITY.cabinet,
  DE: DE_IDENTITY.cabinet,
  JP: JP_IDENTITY.cabinet,
  IE: IE_IDENTITY.cabinet,
  NG: NG_IDENTITY.cabinet,
  // Soviet Union — Council of Ministers (СМ = Совет Министров): deep Soviet
  // red gradient with the gold of the state emblem.
  RU: RU_IDENTITY.cabinet,
  // East Germany, Council of Ministers (DDR): state gold against deep
  // red-black, matching the Soviet precedent.
  DD: DD_IDENTITY.cabinet,
};

/**
 * Resolve the cabinet identity for a country. A missing entry must degrade to
 * the country's own code, never to another country's branding.
 */
/** The last-resort cabinet palette, used only if the UK's own shell disappears. */
const DEFAULT_CABINET_SHELL: Omit<CabinetIdentity, "glyph" | "serif"> = {
  gov: "#4b5563",
  govSoft: "#9ca3af",
  g0: "#111827",
  g1: "#374151",
  g2: "#6b7280",
};

export function getCabinetIdentity(countryId: string): CabinetIdentity {
  const entry = CABINET_IDENTITY[countryId as CountryId];
  if (entry) return entry;
  // ⚠ THE FALLBACK IS THE UNITED KINGDOM'S CABINET SHELL, and it used to read
  // a LOCAL `const UK_IDENTITY` declared in this file. That name now collides
  // with the folder export, and importing the folder's under the same name made
  // `UK_IDENTITY.cabinet` resolve to the local literal's missing `.cabinet` --
  // undefined, silently, with typecheck green. The local copy is deleted and the
  // import is aliased so the two can never be confused again.
  /*
   * ⚠️ THE `??` GUARDS THE SHELL ITSELF, and it is not decoration. `cabinet`
   * became optional on the contract because `CABINET_IDENTITY` covers 9 of the
   * 29 playable countries. The United Kingdom HAS one, so this branch is
   * unreachable for it today -- but a fallback that would throw if its own
   * source ever went missing is a fallback that does not work when it matters.
   */
  const shell = UK_FOLDER_IDENTITY.cabinet ?? DEFAULT_CABINET_SHELL;
  return { ...shell, glyph: countryId.toUpperCase(), serif: "mono" };
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
