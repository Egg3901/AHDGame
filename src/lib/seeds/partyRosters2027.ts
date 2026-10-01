import type { CountryId } from "@/lib/constants/countries";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * 2027 party rosters use the latest completed national parliamentary election
 * available when the preset was authored. They describe the opening board,
 * not a prediction of a future election result.
 *
 * Primary roster sources:
 * - BR: TSE 2022 results, https://www.tse.jus.br/administracao/menu-superior/eleitor-eleicoes/eleicoes/resultados-das-eleicoes-2022
 * - NG: INEC 2023 results, https://www.inecnigeria.org/election-results/
 * - FR: Ministry of the Interior 2024 results, https://www.resultats-elections.interieur.gouv.fr/legislatives2024/
 * - IT: Ministry of the Interior 2022 election portal, https://elezioni.interno.gov.it/
 * - ES: Ministry of the Interior 2023 Congress results, https://resultados.generales23j.es/
 * - SE: Valmyndigheten 2022 results, https://www.val.se/valresultat-och-statistik/riksdags--region--och-kommunval/valresultat-2022
 * - TR: YSK 2023 results, https://sonuc.ysk.gov.tr/
 * - GR: Ministry of the Interior June 2023 results, https://ekloges.ypes.gr/
 * - AT: Federal Ministry of the Interior 2024 results, https://www.bmi.gv.at/412/Nationalratswahlen/Nationalratswahl_2024/
 * - FI: Ministry of Justice 2023 results, https://tulospalvelu.vaalit.fi/EKV-2023/en/
 * - IE: Electoral Commission 2024 results, https://www.electoralcommission.ie/2024-general-election-results/
 * - RU: Central Election Commission 2021 Duma results, http://www.vybory.izbirkom.ru/
 */

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
    seedOrder,
    countryId,
    name,
    abbreviation,
    color,
    economicPosition,
    socialPosition,
    memberCount: 0,
    isDefault: true,
    treasury: 0,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["2027-default"],
    regimeStatus: "approved",
  };
}

export const PARTY_ROSTERS_2027: Partial<Record<CountryId, PartySeed[]>> = {
  RU: [
    party("RU", 1, "United Russia", "ER", "#1E4C9A", 2, 3),
    party("RU", 2, "Communist Party of the Russian Federation", "KPRF", "#D40000", -4, 1),
    party("RU", 3, "Liberal Democratic Party of Russia", "LDPR", "#2862B3", 1, 4),
    party("RU", 4, "A Just Russia - For Truth", "SRZP", "#E8B600", -2, 2),
    party("RU", 5, "New People", "NP", "#19B6B2", 2, -1),
  ],
  FR: [
    party("FR", 1, "Rassemblement national", "RN", "#1A2E5A", 1, 4),
    party("FR", 2, "Renaissance", "RE", "#FFD600", 2, -1),
    party("FR", 7, "La France insoumise", "LFI", "#CC2443", -4, -3),
    party("FR", 5, "Les Républicains", "LR", "#0066CC", 3, 2),
    party("FR", 6, "Les Écologistes", "EELV", "#00A95C", -2, -4),
  ],
  IT: [
    party("IT", 1, "Fratelli d'Italia", "FDI", "#1A3C7A", 2, 4),
    party("IT", 2, "Partito Democratico", "PD", "#E31E33", -2, -2),
    party("IT", 3, "Movimento 5 Stelle", "M5S", "#FFD800", -1, -1),
    party("IT", 4, "Lega", "LEGA", "#1B8C3A", 2, 4),
    party("IT", 5, "Forza Italia", "FI", "#0087DC", 3, 2),
    party("IT", 6, "Alleanza Verdi e Sinistra", "AVS", "#5BAF45", -3, -4),
  ],
  ES: [
    party("ES", 1, "Vox", "VOX", "#63BE21", 3, 5),
    party("ES", 3, "Sumar", "SUMAR", "#E65C9C", -4, -4),
    party("ES", 4, "Esquerra Republicana de Catalunya", "ERC", "#FFB232", -3, -3),
    party("ES", 5, "Junts per Catalunya", "JUNTS", "#00A7B5", 1, -1),
  ],
  SE: [
    party("SE", 4, "Sverigedemokraterna", "SD", "#DDDD00", 1, 4),
    party("SE", 5, "Kristdemokraterna", "KD", "#0A6E45", 1, 3),
    party("SE", 7, "Miljöpartiet de gröna", "MP", "#83CF39", -2, -4),
    party("SE", 8, "Liberalerna", "L", "#0066B3", 2, -2),
  ],
  TR: [
    party("TR", 1, "Adalet ve Kalkınma Partisi", "AKP", "#F28C00", 2, 4),
    party("TR", 3, "İYİ Parti", "İYİ", "#00AEEF", 2, 3),
    party("TR", 5, "Halkların Eşitlik ve Demokrasi Partisi", "DEM", "#7B2D8E", -3, -4),
    party("TR", 6, "Yeniden Refah Partisi", "YRP", "#1F7A33", 0, 5),
  ],
  GR: [
    party("GR", 2, "SYRIZA - Progressive Alliance", "SYRIZA", "#E83E4D", -4, -3),
    party("GR", 4, "PASOK - Kinima Allagis", "PASOK", "#009A44", -2, -2),
    party("GR", 5, "Elliniki Lysi", "EL", "#4B5A9A", 1, 5),
  ],
  AT: [
    party("AT", 1, "Sozialdemokratische Partei Österreichs", "SPÖ", "#E30613", -2, -2),
    party("AT", 5, "NEOS - Das Neue Österreich", "NEOS", "#E5007D", 3, -3),
  ],
  FI: [
    party("FI", 2, "Perussuomalaiset", "PS", "#FFDE00", 1, 4),
    party("FI", 4, "Suomen Keskusta", "KESK", "#01954B", 0, 1),
    party("FI", 6, "Vihreä liitto", "VIHR", "#61BF1A", -2, -4),
  ],
  IE: [
    party("IE", 6, "Social Democrats", "SD", "#6F2C91", -3, -4),
    party("IE", 7, "Independent Ireland", "II", "#163A5F", 2, 3),
    party("IE", 8, "People Before Profit-Solidarity", "PBP-S", "#E91D2D", -5, -4),
    party("IE", 9, "Aontú", "AONTÚ", "#44532A", -2, 4),
  ],
};
