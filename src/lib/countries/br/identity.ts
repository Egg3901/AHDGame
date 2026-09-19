import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { EconomyIdentity } from "@/lib/constants/economyIdentity";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { CensusLabelSet } from "@/lib/constants/regionCensusLabels";
import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Brazil's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/br.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts BR "Brazil" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for BR.)

const national: NationalIdentity = {
  glyph: "BR",
  serif: "mono",
  motif: "starRing",
  name: "Brazil National Corporation",
  native: "Empresa Nacional do Brasil",
  registry: "República Federativa do Brasil · Patrimônio do Estado",
  ministry: "TESOURO NACIONAL",
  publicSeal: "REGISTRO PÚBLICO",
  hqCity: "Brasília",
  palette: ["#0f3b24", "#0b2a19", "#07180f"],
  accent: "#d4b13f",
  accentSoft: "#e8cf78",
  accentName: "Verde-amarelo",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for BR.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "BR",
  serif: "mono",
  budgetTitle: "Orçamento Nacional",
  budgetTitleEn: "National Budget",
  ministry: "TESOURO NACIONAL",
  publicSeal: "PÚBLICO · PUBLIC",
  registry: "Federative Republic of Brazil · National Treasury",
  native: "República Federativa do Brasil · Tesouro Nacional",
  nativeEn: "Federative Republic of Brazil · National Treasury",
};

/** The authored economy copy. The accent is pulled from `national` downstream. */
const economyText: Omit<EconomyIdentity, "accent"> = {
  glyph: "BR",
  serif: "mono",
  title: "Panorama Econômico",
  titleEn: "Economic Outlook",
  office: "IBGE · Contas Nacionais",
  officeEn: "IBGE · National Accounts",
  registry: "Federative Republic of Brazil · National Accounts Registry",
};

const executiveText: IdentityText = {
  glyph: "PR",
  serif: "mono",
  registry: "Federative Republic of Brazil · Presidency",
  title: "Palácio do Planalto",
  titleEn: "Presidential Palace",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of National Law · Federative Republic of Brazil",
  title: "Direito Nacional",
  titleEn: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Coat_of_arms_of_Brazil.svg/330px-Coat_of_arms_of_Brazil.svg.png",
  alt: "Coat of arms of Brazil",
};

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "election",
    label: "Term Clock",
    countdownNoun: "election",
  },
  actLabels: {
    signed: "SIGNED",
    vetoed: "VETOED",
    onDesk: "ON DESK",
    order: "EX. ORDER",
    confirmed: "CONFIRMED",
    nominated: "NOMINATED",
    acting: "ACTING",
  },
  deskKind: "bills",
  deskLabel: "The Desk",
  rosterTitle: "Cabinet",
  heroImage: "/api/images/hero/palacio-do-planalto",
  heroAlt: "Palácio do Planalto, Brasília",
};

/**
 * No parliamentary executive surface. `SURFACES` has no BR entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for BR.)

/** Census category labels for region pages. */
const regionCensusLabels: CensusLabelSet = {
  cardTitles: {
    ethnicity: "Race / Color (Cor/Raça)",
    age: "Age Distribution",
    education: "Education (Highest)",
    income: "Household Income",
    urbanization: "Urbanization",
  },
  ethnicity: {
    branco: "Branco (White)",
    pardo: "Pardo (Mixed)",
    preto: "Preto (Black)",
    amarelo: "Amarelo (Asian)",
    indigena: "Indígena",
  },
  age: {
    young: "Young (18-29)",
    mid: "Mid (30-44)",
    mature: "Mature (45-64)",
    senior: "Senior (65+)",
  },
  education: {
    fundamental: "Fundamental",
    medio: "Ensino Médio",
    superior: "Ensino Superior",
  },
  income: {
    low: "Lower income",
    middle: "Middle income",
    high: "Upper income",
  },
  urbanization: {
    urban: "Urban",
    suburban: "Peri-urban",
    rural: "Rural",
  },
};

/** Region display names (STATE_DISPLAY_NAMES), used by the commodity map. */
const stateDisplayNames: Record<string, string> = {
  NORTE: "Norte",
  NORDESTE: "Nordeste",
  CENTRO_OESTE: "Centro-Oeste",
  SUDESTE: "Sudeste",
  SUL: "Sul",
};

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Banco Paulista de Comercio", "Banco Atlantico do Sul"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Banco Paulista de Comercio", "Atlantico Sul Financial"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "BR",
  command: "ESTADO-MAIOR CONJUNTO",
  strip: "◆ SECRETO",
  acc: "#86d978",
};

export const BR_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Brazil",
  national,
  treasuryText,
  economyText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  regionCensusLabels,
  stateDisplayNames,
  historicalNames,
  modernNames,
};
