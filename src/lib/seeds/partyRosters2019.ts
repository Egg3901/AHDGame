import type { CountryId } from "@/lib/constants/countries";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/** Party organizations at the January 2019 start, separate from 2027 rosters. */
function party(
  countryId: CountryId,
  seedOrder: number,
  name: string,
  abbreviation: string,
  color: string,
  economicPosition: number,
  socialPosition: number
): PartySeed {
  return {
    countryId,
    seedOrder,
    name,
    abbreviation,
    color,
    economicPosition,
    socialPosition,
    // Intentional empty-party disposition (#2072): these are historical
    // ballot organizations, not fabricated player memberships. NPP affiliation
    // is assigned later and live membership is recomputed from character/NPP
    // records; an actorless seed has no members to count. Health reporting
    // excludes empty-party warnings when there are no player characters.
    memberCount: 0,
    isDefault: true,
    validForPresets: ["2019-default"],
    regimeStatus: "approved",
    treasury: 0,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  };
}

export const PARTY_ROSTERS_2019: Partial<Record<CountryId, PartySeed[]>> = {
  // https://parlament2015.pkw.gov.pl/349_Wyniki_Sejm/0/1.html
  PL: [
    party("PL", 1, "Prawo i Sprawiedliwość", "PiS", "#1B3A6B", 1, 4),
    party("PL", 2, "Platforma Obywatelska", "PO", "#FF7A00", 1, -2),
    party("PL", 3, "Kukiz'15", "K15", "#333333", 2, 3),
    party("PL", 4, "Nowoczesna", "N", "#12A9E0", 3, -2),
    party("PL", 5, "Polskie Stronnictwo Ludowe", "PSL", "#00A651", 0, 1),
  ],
  // https://valtor.valasztas.hu/valtort/jsp/orszjkv.jsp?EA=38&W=2
  HU: [
    party("HU", 1, "Fidesz–KDNP", "FIDESZ", "#FF6600", 2, 4),
    party("HU", 2, "Jobbik Magyarországért Mozgalom", "JOBBIK", "#1B435D", 1, 4),
    party("HU", 3, "MSZP–Párbeszéd", "MSZP-P", "#C1272D", -2, -2),
    party("HU", 4, "Lehet Más a Politika", "LMP", "#76B82A", -1, -3),
    party("HU", 5, "Demokratikus Koalíció", "DK", "#2B7AC3", -1, -3),
  ],
  // https://data.ipu.org/parliament/RO/RO-LC01/election/RO-LC01-E20161211/
  RO: [
    party("RO", 1, "Partidul Social Democrat", "PSD", "#D00000", -2, 1),
    party("RO", 2, "Partidul Național Liberal", "PNL", "#FFCB00", 2, -1),
    party("RO", 3, "Uniunea Salvați România", "USR", "#0088CC", 1, -3),
    party("RO", 4, "Uniunea Democrată Maghiară din România", "UDMR", "#008751", 0, 0),
    party("RO", 5, "Alianța Liberalilor și Democraților", "ALDE", "#19A948", 2, -1),
    party("RO", 6, "Partidul Mișcarea Populară", "PMP", "#0067B1", 2, 2),
  ],
  // https://results.cik.bg/pi2017/mandati/index.html
  BG: [
    party("BG", 1, "ГЕРБ", "GERB", "#0066B3", 2, 2),
    party("BG", 2, "БСП за България", "BSP", "#C70025", -2, 0),
    party("BG", 3, "Обединени патриоти", "OP", "#254775", 1, 4),
    party("BG", 4, "Движение за права и свободи", "DPS", "#006837", 1, -1),
    party("BG", 5, "ВОЛЯ", "VOLYA", "#0074B5", 1, 1),
  ],
  // https://data.ipu.org/parliament/RU/RU-LC01/election/RU-LC01-E20160918/
  RU: [
    party("RU", 1, "Единая Россия", "ER", "#235AA6", 2, 2),
    party("RU", 2, "Коммунистическая партия Российской Федерации", "KPRF", "#CC0000", -3, 2),
    party("RU", 3, "ЛДПР", "LDPR", "#2357A4", 2, 4),
    party("RU", 4, "Справедливая Россия", "SR", "#F3C824", -1, 1),
  ],
};
