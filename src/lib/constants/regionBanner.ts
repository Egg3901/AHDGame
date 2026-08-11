/**
 * Country-aware region-banner resolver.
 *
 * `STATE_IMAGES` is a US-only map, but the same hero-banner pattern is
 * used by every country's state/region page (and the Governor's Office
 * page). This helper picks the correct per-country image-resolver
 * (`get<Country>RegionImage`) so callers can route uniformly without
 * each remembering which constants file holds which map.
 *
 * Resolution order:
 *   1. The DB-side `state.bannerImage` field (admin override) wins.
 *   2. Otherwise dispatch to the country's `get<Country>RegionImage`.
 *   3. Unknown countries return `undefined` — callers should hide the
 *      `<HeroImage>` element rather than rendering an empty `src`.
 */

import type { CountryId } from "./countries";
import { getUSStateImage } from "../constants";
import { getUKRegionImage } from "./uk";
import { getJPRegionImage } from "./japan";
import { getDERegionImage } from "./germany";
import { getCNRegionImage } from "./cn";
import { getIERegionImage } from "./ireland";
import { getRURegionImage } from "./ruRegionImages";
import { getDDRegionImage } from "./ddRegionImages";
import { getBRRegionImage } from "./brRegionImages";
import { getNGRegionImage } from "./ngRegionImages";
import { getHURegionImage } from "./huRegionImages";
import { getBGRegionImage } from "./bgRegionImages";
import { getUARegionImage } from "./uaRegionImages";
import { getBLRRegionImage } from "./blrRegionImages";
import { getCSRegionImage } from "./csRegionImages";
import { getBALRegionImage } from "./balRegionImages";
import { getPLRegionImage } from "./plRegionImages";
import { getRORegionImage } from "./roRegionImages";
import { getYURegionImage } from "./yuRegionImages";
import { getFRRegionImage } from "./frRegionImages";
import { getITRegionImage } from "./itRegionImages";
import { getESRegionImage } from "./esRegionImages";
import { getSERegionImage } from "./seRegionImages";
import { getTRRegionImage } from "./trRegionImages";
import { getGRRegionImage } from "@/lib/constants/grRegionImages";
import { getATRegionImage } from "@/lib/constants/atRegionImages";
import { getFIRegionImage } from "@/lib/constants/fiRegionImages";
import { getSCORegionImage } from "./scoRegionImages";
import { getWALRegionImage } from "./walRegionImages";

/**
 * Seat-of-government hero for a UK devolved nation's executive office page (the
 * First Minister's Office), distinct from the scenic region banner the general
 * region page uses. Pre-independence Scotland/Wales show Bute House / the Senedd
 * here, matching the post-independence national executive hub.
 */
const UK_DEVOLVED_OFFICE_HERO: Record<string, string> = {
  SCO: "/api/images/hero/bute-house",
  WAL: "/api/images/hero/senedd",
};

/**
 * Banner for a region's executive office page. Admin override wins; a UK
 * devolved nation then uses its seat-of-government image; everything else falls
 * back to the scenic region banner.
 */
export function resolveRegionOfficeBannerImage(
  countryId: CountryId,
  stateId: string,
  stateBannerImage?: string | null
): string | undefined {
  if (stateBannerImage) return stateBannerImage;
  // SCO/WAL are UK-only region ids, so the map alone is an unambiguous match.
  const seat = UK_DEVOLVED_OFFICE_HERO[stateId.toUpperCase()];
  if (seat) return seat;
  return resolveRegionBannerImage(countryId, stateId, stateBannerImage);
}

export function resolveRegionBannerImage(
  countryId: CountryId,
  stateId: string,
  stateBannerImage?: string | null
): string | undefined {
  if (stateBannerImage) return stateBannerImage;
  switch (countryId) {
    case "US":
      return getUSStateImage(stateId);
    case "UK":
      return getUKRegionImage(stateId);
    case "JP":
      return getJPRegionImage(stateId);
    case "DE":
      return getDERegionImage(stateId);
    case "CN":
      return getCNRegionImage(stateId);
    case "IE":
      return getIERegionImage(stateId);
    case "RU":
      return getRURegionImage(stateId);
    case "DD":
      return getDDRegionImage(stateId);
    case "BR":
      return getBRRegionImage(stateId);
    case "NG":
      return getNGRegionImage(stateId);
    case "HU":
      return getHURegionImage(stateId);
    case "PL":
      return getPLRegionImage(stateId);
    case "RO":
      return getRORegionImage(stateId);
    case "YU":
      return getYURegionImage(stateId);
    case "BG":
      return getBGRegionImage(stateId);
    case "UKR":
      return getUARegionImage(stateId);
    case "BLR":
      return getBLRRegionImage(stateId);
    case "CS":
      return getCSRegionImage(stateId);
    case "BAL":
      return getBALRegionImage(stateId);
    case "FR":
      return getFRRegionImage(stateId);
    case "IT":
      return getITRegionImage(stateId);
    case "ES":
      return getESRegionImage(stateId);
    case "SE":
      return getSERegionImage(stateId);
    case "TR":
      return getTRRegionImage(stateId);
    case "GR":
      return getGRRegionImage(stateId);
    case "AT":
      return getATRegionImage(stateId);
    case "FI":
      return getFIRegionImage(stateId);
    case "SCO":
      return getSCORegionImage(stateId);
    case "WAL":
      return getWALRegionImage(stateId);
    default:
      return undefined;
  }
}
