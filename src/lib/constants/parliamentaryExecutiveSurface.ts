/**
 * Per-country display surface for the shared parliamentary executive hub
 * (`ParliamentaryExecutiveHub`). Bespoke entries preserve the exact copy the
 * dedicated UK/DE/JP/IE hubs used to render; any parliamentary country
 * without an entry gets a complete surface derived from `COUNTRY_CONFIGS`,
 * so adding a country does not require a per-country hub rebuild.
 */
import { getCountryConfig, type CountryId } from "./countries";
import { getExecutiveSurface } from "./executiveSurface";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { UK_IDENTITY } from "@/lib/countries/uk/identity";
import { DE_IDENTITY } from "@/lib/countries/de/identity";
import { IE_IDENTITY } from "@/lib/countries/ie/identity";

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

export const SURFACES: Partial<Record<CountryId, ParliamentaryExecutiveSurface>> = {
  UK: UK_IDENTITY.parliamentarySurface,
  DE: DE_IDENTITY.parliamentarySurface,
  JP: JP_IDENTITY.parliamentarySurface,
  IE: IE_IDENTITY.parliamentarySurface,
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
