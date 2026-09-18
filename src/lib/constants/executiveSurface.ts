import type { CountryId } from "@/lib/constants/countries";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { US_IDENTITY } from "@/lib/countries/us/identity";
import { UK_IDENTITY } from "@/lib/countries/uk/identity";
import { DE_IDENTITY } from "@/lib/countries/de/identity";
import { CN_IDENTITY } from "@/lib/countries/cn/identity";
import { IE_IDENTITY } from "@/lib/countries/ie/identity";
import { RU_IDENTITY } from "@/lib/countries/ru/identity";
import { DD_IDENTITY } from "@/lib/countries/dd/identity";
import { NG_IDENTITY } from "@/lib/countries/ng/identity";
import { BR_IDENTITY } from "@/lib/countries/br/identity";
import { FR_IDENTITY } from "@/lib/countries/fr/identity";
import { IT_IDENTITY } from "@/lib/countries/it/identity";
import { ES_IDENTITY } from "@/lib/countries/es/identity";
import { SE_IDENTITY } from "@/lib/countries/se/identity";
import { TR_IDENTITY } from "@/lib/countries/tr/identity";
import { GR_IDENTITY } from "@/lib/countries/gr/identity";
import { AT_IDENTITY } from "@/lib/countries/at/identity";
import { FI_IDENTITY } from "@/lib/countries/fi/identity";

/**
 * Per-country configuration for the shared executive shell (instrument strip
 * clock, acts-ledger chip labels, roster naming, hero) — the act-map
 * indirection locked at design review: the same components render every
 * country, with all variation flowing through this table.
 *
 * Term limits are NOT configured here — the badge reads the existing SSOT
 * (`getExecutiveTermLimit` / `getExecutiveTermsServed` in
 * lib/elections/executiveTermLimits.ts).
 */

export interface ExecutiveClockConfig {
  /** election = countdown to the next executive-relevant election; plenum = legislature session. */
  kind: "election" | "plenum";
  label: string;
  /** Noun for the countdown subline (e.g. "election", "next NPC session"). */
  countdownNoun: string;
}

export type ExecutiveActKind =
  "signed" | "vetoed" | "onDesk" | "order" | "confirmed" | "nominated" | "acting";

export interface ExecutiveSurfaceConfig {
  clock: ExecutiveClockConfig;
  /** Ledger chip labels per act kind (US SIGNED ↔ CN ENACTED, EX. ORDER ↔ DIRECTIVE …). */
  actLabels: Record<ExecutiveActKind, string>;
  /** Whether instrument tile 3 counts bills on the desk or orders in force. */
  deskKind: "bills" | "orders";
  deskLabel: string;
  rosterTitle: string;
  heroImage: string;
  heroAlt: string;
}

const PARLIAMENTARY_ACTS: Record<ExecutiveActKind, string> = {
  signed: "ENACTED",
  vetoed: "REJECTED",
  onDesk: "AWAITING",
  order: "ORDER",
  confirmed: "APPOINTED",
  nominated: "NOMINATED",
  acting: "ACTING",
};

export const EXECUTIVE_SURFACE: Record<CountryId, ExecutiveSurfaceConfig> = {
  US: US_IDENTITY.executiveSurface,
  UK: UK_IDENTITY.executiveSurface,
  DE: DE_IDENTITY.executiveSurface,
  JP: JP_IDENTITY.executiveSurface,
  IE: IE_IDENTITY.executiveSurface,
  CN: CN_IDENTITY.executiveSurface,
  BR: BR_IDENTITY.executiveSurface,
  NG: NG_IDENTITY.executiveSurface,
  // Hungary — one-party state, mirrors CN's plenum/directive surface.
  HU: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Assembly session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/hungarian-parliament",
    heroAlt: "Hungarian Parliament Building, Budapest",
  },
  PL: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Sejm session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/poland",
    heroAlt: "Sejm, Warsaw",
  },
  RO: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Assembly session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/romania",
    heroAlt: "Grand National Assembly, Bucharest",
  },
  YU: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Assembly session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Federal Executive Council",
    heroImage: "/api/images/hero/yugoslavia",
    heroAlt: "Federal Assembly, Belgrade",
  },
  BG: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Assembly session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/bulgaria",
    heroAlt: "National Assembly, Sofia",
  },
  BLR: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Soviet session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/belarus",
    heroAlt: "Supreme Soviet, Minsk",
  },
  UKR: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Soviet session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/ukraine",
    heroAlt: "Supreme Soviet, Kyiv",
  },
  CS: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Assembly session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Federal Government",
    heroImage: "/api/images/hero/czechoslovakia",
    heroAlt: "Federal Assembly, Prague",
  },
  BAL: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Soviet session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Councils of Ministers",
    heroImage: "/api/images/hero/baltics",
    heroAlt: "Supreme Soviet, Riga",
  },
  RU: RU_IDENTITY.executiveSurface,
  FR: FR_IDENTITY.executiveSurface,
  IT: IT_IDENTITY.executiveSurface,
  ES: ES_IDENTITY.executiveSurface,
  SE: SE_IDENTITY.executiveSurface,
  TR: TR_IDENTITY.executiveSurface,
  GR: GR_IDENTITY.executiveSurface,
  AT: AT_IDENTITY.executiveSurface,
  FI: FI_IDENTITY.executiveSurface,
  DD: DD_IDENTITY.executiveSurface,
  SCO: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next Holyrood election" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "ORDER IN COUNCIL" },
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/bute-house",
    heroAlt: "Bute House, Edinburgh",
  },
  WAL: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next Senedd election" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "ORDER IN COUNCIL" },
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/senedd",
    heroAlt: "Senedd, Cardiff",
  },
};

export function getExecutiveSurface(countryId: CountryId): ExecutiveSurfaceConfig {
  return EXECUTIVE_SURFACE[countryId] ?? EXECUTIVE_SURFACE.US;
}

/**
 * "TERM n OF x" badge for term-limited executives. Returns null when the
 * country has no term limit OR the current term is not known — the badge is
 * only rendered from real data, never fabricated.
 */
export function termClockBadge(
  termLimit: number | undefined,
  currentTerm: number | undefined
): { badge: string; subline: string } | null {
  if (!termLimit || !currentTerm) return null;
  return {
    badge: `TERM ${currentTerm} OF ${termLimit}`,
    subline: currentTerm >= termLimit ? "term-limited — cannot run again" : "eligible to run again",
  };
}
