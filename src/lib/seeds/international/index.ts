import type { EraId } from "@/lib/seeds/presetSelector";
import type { CountryLayer1Model } from "./types";
import { getUkModel } from "./uk";
import { getScoModel } from "./sco";
import { getWalModel } from "./wal";
import { getDeModel } from "./de";
import { getJpModel } from "./jp";
import { getIeModel } from "./ie";
import { getBrModel } from "./br";
import { getCnModel } from "./cn";
import { getNgModel } from "./ng";
import { getRuModel } from "./ru";
import { getFrModel } from "./fr";
import { getItModel } from "./it";
import { getEsModel } from "./es";
import { getSeModel } from "./se";
import { getTrModel } from "./tr";
import { getGrModel } from "./gr";
import { getAtModel } from "./at";
import { getFiModel } from "./fi";
import { getDdModel } from "./dd";
import { getHuModel } from "./hu";
import { getPlModel } from "./pl";
import { getRoModel } from "./ro";
import { getYuModel } from "./yu";
import { getBgModel } from "./bg";
import { getBlrModel } from "./blr";
import { getUaModel } from "./ua";
import { getCsModel } from "./cs";
import { getBalModel } from "./bal";

export { buildModelRegionDemographics } from "./derive";
export type { CountryLayer1Model } from "./types";

/**
 * Resolve a country's historically-grounded Layer-1 model for an era, or null
 * if the country has no international Layer-1 model. Used by the gated seed path.
 */
export function getCountryLayer1Model(countryId: string, era: EraId): CountryLayer1Model | null {
  switch (countryId) {
    case "UK":
      return getUkModel(era);
    // Devolved nations: their own census, the UK's voter groups. Without these
    // both fell through to the legacy archetype vote path.
    case "SCO":
      return getScoModel(era);
    case "WAL":
      return getWalModel(era);
    case "DE":
      return getDeModel(era);
    case "JP":
      return getJpModel(era);
    case "IE":
      return getIeModel(era);
    case "BR":
      return getBrModel(era);
    case "CN":
      return getCnModel(era);
    case "NG":
      return getNgModel(era);
    case "RU":
      return getRuModel(era);
    case "FR":
      return getFrModel(era);
    case "IT":
      return getItModel(era);
    case "ES":
      return getEsModel(era);
    case "SE":
      return getSeModel(era);
    case "TR":
      return getTrModel(era);
    case "GR":
      return getGrModel(era);
    case "AT":
      return getAtModel(era);
    case "FI":
      return getFiModel(era);
    case "DD":
      return getDdModel(era);
    case "HU":
      return getHuModel(era);
    case "PL":
      return getPlModel(era);
    case "RO":
      return getRoModel(era);
    case "YU":
      return getYuModel(era);
    case "BG":
      return getBgModel(era);
    case "BLR":
      return getBlrModel(era);
    case "UKR":
      return getUaModel(era);
    case "CS":
      return getCsModel(era);
    case "BAL":
      return getBalModel(era);
    default:
      return null;
  }
}
