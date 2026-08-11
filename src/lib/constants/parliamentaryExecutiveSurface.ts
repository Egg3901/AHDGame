/**
 * Per-country display surface for the shared parliamentary executive hub
 * (`ParliamentaryExecutiveHub`). Bespoke entries preserve the exact copy the
 * dedicated UK/DE/JP/IE hubs used to render; any parliamentary country
 * without an entry gets a complete surface derived from `COUNTRY_CONFIGS`,
 * so adding a country does not require a per-country hub rebuild.
 */
import { getCountryConfig, type CountryId } from "./countries";
import { getCountryFlagUrl } from "./flags";
import { getExecutiveSurface } from "./executiveSurface";

export interface ParliamentaryExecutivePlaque {
  title: string;
  sealGlyph: string;
  vacancyNote: string;
}

export interface ParliamentaryExecutiveSurface {
  /** Head-of-government title for the actions banner and head plaque. */
  executiveTitle: string;
  /** Chamber-member label in the Appoint/No-Confidence banner copy. */
  memberLabel: string;
  headPlaque: ParliamentaryExecutivePlaque;
  /** Optional second seat beside the head plaque (IE Tánaiste), resolved from
   * the unified `cabinetMembers` collection by `cabinetPositionId`. */
  deputyPlaque?: ParliamentaryExecutivePlaque & { cabinetPositionId: string };
  oppositionPlaque: ParliamentaryExecutivePlaque;
  seatsPanel: { title: string; emptyText: string };
  hero: {
    image: string;
    alt: string;
    /** Null when the title is resolved at request time (see flag below). */
    title: string | null;
    tagline: string;
    breadcrumbLast: string;
  };
  /** UK: hero title renders as "<imperial possessive> Government". */
  heroTitleUsesImperialPossessive?: boolean;
}

const SURFACES: Partial<Record<CountryId, ParliamentaryExecutiveSurface>> = {
  UK: {
    executiveTitle: "Prime Minister",
    memberLabel: "MP",
    headPlaque: {
      title: "Prime Minister",
      sealGlyph: "PM",
      vacancyNote: "A qualifying party or coalition chair may nominate a Prime Minister.",
    },
    oppositionPlaque: {
      title: "Leader of the Opposition",
      sealGlyph: "LO",
      vacancyNote: "The leader of the largest opposition party in the Commons.",
    },
    seatsPanel: { title: "Commons seats by party", emptyText: "No Commons MPs elected yet." },
    hero: {
      image: "/api/images/hero/downing-street",
      alt: "10 Downing Street",
      title: null,
      tagline: "10 Downing Street · Prime Minister, Cabinet, and the House of Commons",
      breadcrumbLast: "Downing Street",
    },
    heroTitleUsesImperialPossessive: true,
  },
  DE: {
    executiveTitle: "Chancellor",
    memberLabel: "Bundestag member",
    headPlaque: {
      title: "Chancellor",
      sealGlyph: "BK",
      vacancyNote: "A qualifying party or coalition chair may nominate a Chancellor.",
    },
    oppositionPlaque: {
      title: "Opposition Leader",
      sealGlyph: "OP",
      vacancyNote: "The leader of the largest opposition bloc in the Bundestag.",
    },
    seatsPanel: {
      title: "Bundestag seats by party",
      emptyText: "No Bundestag members elected yet.",
    },
    hero: {
      image: "/api/images/hero/reichstag",
      alt: "Bundeskanzleramt and Reichstag in Berlin",
      title: "Federal Government of Germany",
      tagline: "Bundeskanzleramt · Chancellor, cabinet, and Bundestag confidence",
      breadcrumbLast: "Federal Chancellery",
    },
  },
  JP: {
    executiveTitle: "Prime Minister",
    memberLabel: "MP",
    headPlaque: {
      title: "Prime Minister",
      sealGlyph: "総",
      vacancyNote: "A qualifying party or coalition chair may nominate a Prime Minister.",
    },
    oppositionPlaque: {
      title: "Leader of the Opposition",
      sealGlyph: "野",
      vacancyNote: "The leader of the largest opposition party in the Diet.",
    },
    seatsPanel: { title: "Shūgiin seats by party", emptyText: "No Diet members elected yet." },
    hero: {
      image: "/api/images/hero/kantei",
      alt: "Naikaku Sōri Daijin Kantei",
      title: "Government of Japan",
      tagline: "Naikaku Sōri Daijin Kantei · Cabinet and the Kokkai",
      breadcrumbLast: "Naikaku Sōri Daijin Kantei",
    },
  },
  IE: {
    executiveTitle: "Taoiseach",
    memberLabel: "TD",
    headPlaque: {
      title: "Taoiseach",
      sealGlyph: "T",
      vacancyNote: "A qualifying party or coalition chair may nominate a Taoiseach.",
    },
    deputyPlaque: {
      title: "Tánaiste",
      sealGlyph: "Tá",
      vacancyNote: "The Taoiseach nominates a Tánaiste from cabinet ministers.",
      cabinetPositionId: "tanaiste",
    },
    oppositionPlaque: {
      title: "Opposition Leader",
      sealGlyph: "FC",
      vacancyNote: "The leader of the largest opposition bloc in the Dáil.",
    },
    seatsPanel: { title: "Dáil seats by party", emptyText: "No TDs elected yet." },
    hero: {
      // The flag stands in until a Government Buildings hero image is
      // registered in /api/images/hero/[slug] (backlog polish item).
      image: getCountryFlagUrl("IE"),
      alt: "Government Buildings, Merrion Street, Dublin",
      title: "Government of Ireland",
      tagline: "Tithe an Rialtais · Taoiseach, Cabinet, and Dáil confidence",
      breadcrumbLast: "Government Buildings",
    },
  },
};

/** "Prime Minister" → "PM" — derived seal glyph for unconfigured countries. */
function titleInitials(title: string): string {
  return title
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
    .slice(0, 3);
}

export function getParliamentaryExecutiveSurface(
  countryId: CountryId
): ParliamentaryExecutiveSurface {
  const bespoke = SURFACES[countryId];
  if (bespoke) return bespoke;

  const config = getCountryConfig(countryId);
  const surface = getExecutiveSurface(countryId);
  const executiveTitle = config.executiveTitle ?? "Prime Minister";
  const chamberShort = config.legislature?.lowerChamber?.shortName ?? "Parliament";
  return {
    executiveTitle,
    memberLabel: "MP",
    headPlaque: {
      title: executiveTitle,
      sealGlyph: titleInitials(executiveTitle),
      vacancyNote: `A qualifying party or coalition chair may nominate a ${executiveTitle}.`,
    },
    oppositionPlaque: {
      title: "Leader of the Opposition",
      sealGlyph: "LO",
      vacancyNote: `The leader of the largest opposition party in the ${chamberShort}.`,
    },
    seatsPanel: {
      title: `${chamberShort} seats by party`,
      emptyText: `No ${chamberShort} members elected yet.`,
    },
    hero: {
      image: surface.heroImage,
      alt: surface.heroAlt,
      title: `Government of ${config.name}`,
      tagline: `${executiveTitle}, cabinet, and ${config.legislature?.name ?? "parliament"} confidence`,
      breadcrumbLast: "Executive",
    },
  };
}
