/**
 * Real-world chamber seals/emblems for legislature surfaces, keyed by country
 * then `legislature.{lowerChamber,upperChamber}.key`. Same Wikimedia Commons
 * 330px thumb convention as `executiveSeals.ts`. Only pictorial emblems belong
 * here: wordmark logos are unreadable at card size, so a chamber without a
 * clean emblem falls back to the generic chamber glyph in `LegislatureSeal`.
 */
import type { CountryId } from "./countries";
import type { ExecutiveSeal } from "./executiveSeals";

const commons = (path: string, file: string) =>
  `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}/${file}/330px-${file}.png`;

const CROWNED_PORTCULLIS: ExecutiveSeal = {
  src: commons("a/af", "Crowned_Portcullis.svg"),
  alt: "Crowned portcullis of the Parliament of the United Kingdom",
};
const OIREACHTAS: ExecutiveSeal = {
  src: commons("5/58", "Oireachtas_logo.svg"),
  alt: "Harp emblem of the Houses of the Oireachtas",
};
const ITALY: ExecutiveSeal = {
  src: commons("0/00", "Emblem_of_Italy.svg"),
  alt: "Emblem of the Italian Republic",
};
const BRAZIL: ExecutiveSeal = {
  src: commons("b/bf", "Coat_of_arms_of_Brazil.svg"),
  alt: "Coat of arms of Brazil",
};
const NIGERIA: ExecutiveSeal = {
  src: commons("b/bc", "Coat_of_arms_of_Nigeria.svg"),
  alt: "Coat of arms of Nigeria",
};

export const LEGISLATURE_SEALS: Partial<Record<CountryId, Record<string, ExecutiveSeal>>> = {
  US: {
    house: {
      src: commons("1/1a", "Seal_of_the_United_States_House_of_Representatives.svg"),
      alt: "Seal of the United States House of Representatives",
    },
    senate: {
      src: commons("f/f0", "Seal_of_the_United_States_Senate.svg"),
      alt: "Seal of the United States Senate",
    },
  },
  UK: { commons: CROWNED_PORTCULLIS, lords: CROWNED_PORTCULLIS },
  DE: {
    bundestag: {
      src: commons("e/e3", "Bundesadler_Bundesorgane.svg"),
      alt: "Federal eagle of the Bundestag",
    },
    bundesrat: {
      src: commons("f/f6", "Bundesrat_Adler.svg"),
      alt: "Eagle of the Bundesrat",
    },
  },
  IE: { dail: OIREACHTAS, seanad: OIREACHTAS },
  IT: { cameraDeputati: ITALY, senato: ITALY },
  BR: { chamber: BRAZIL, senate: BRAZIL },
  NG: { house: NIGERIA, senate: NIGERIA },
  CN: {
    npc: {
      src: commons("5/55", "National_Emblem_of_the_People%27s_Republic_of_China.svg"),
      alt: "National emblem of the People's Republic of China",
    },
  },
};

export function getLegislatureSeal(
  countryId: CountryId | null | undefined,
  chamberKey: string | null | undefined
): ExecutiveSeal | null {
  if (!countryId || !chamberKey) return null;
  return LEGISLATURE_SEALS[countryId]?.[chamberKey] ?? null;
}
