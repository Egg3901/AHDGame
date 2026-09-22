/**
 * Ireland-specific constants. Houses the §3.1 Option C constituent-councils
 * flavor mapping and the per-region banner-image helper; future IE-only
 * constants can land here without bloating the cross-country `countries.ts`
 * registry.
 */

/**
 * Fallback used when a region has no entry in `IE_REGION_IMAGES`.
 * Cliffs of Moher — Ireland's most recognizable landmark, neutral for any
 * IE banner context.
 */
const IE_DEFAULT_IMAGE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Cliffs-Of-Moher-OBriens-From-South.JPG/1280px-Cliffs-Of-Moher-OBriens-From-South.JPG";

/**
 * Representative landmark/landscape photos for each of the 8 NUTS-III
 * planning regions (region ids match `lib/seeds/ie/ieRegions.ts`). Each
 * picks an iconic, in-region landmark. URLs sourced from Wikimedia Commons
 * via the Wikipedia article for the named landmark — freely licensed.
 * Mirrors `lib/constants/germany.ts:getDERegionImage` and the other
 * `get<Country>RegionImage` helpers so callers dispatch uniformly per
 * country. Falls back to `IE_DEFAULT_IMAGE` (Cliffs of Moher) for any
 * future region id added without a dedicated entry here.
 */
const IE_REGION_IMAGES: Record<string, string> = {
  // Dublin — Ha'penny Bridge over the River Liffey
  DUB: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/HalfPennyBridge.jpg/1280px-HalfPennyBridge.jpg",
  // Kildare (Kildare + Meath + Wicklow) — Glendalough monastic site, Co. Wicklow
  KIL: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/St._Kevin%27s_Kitchen%2C_Glendalough%2C_Co._Wicklow_%282023%29.jpg/1280px-St._Kevin%27s_Kitchen%2C_Glendalough%2C_Co._Wicklow_%282023%29.jpg",
  // Midlands (Laois + Longford + Offaly + Westmeath) — Clonmacnoise on the Shannon, Co. Offaly
  MID: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Clonmacnoise_6.jpg/1280px-Clonmacnoise_6.jpg",
  // Wexford (Carlow + Kilkenny + Tipperary + Waterford + Wexford) — Rock of Cashel, Co. Tipperary
  WEX: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Ireland_Rock_of_Cashel_BW_2025-09-14_15-39-31.jpg/1280px-Ireland_Rock_of_Cashel_BW_2025-09-14_15-39-31.jpg",
  // Limerick (Clare + Limerick) — Cliffs of Moher, Co. Clare
  LIM: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Cliffs-Of-Moher-OBriens-From-South.JPG/1280px-Cliffs-Of-Moher-OBriens-From-South.JPG",
  // Cork (Cork City + Cork County + Kerry) — St Colman's Cathedral, Cobh
  COR: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/St_Colman%27s_Cathedral%2C_Cobh.jpg/1280px-St_Colman%27s_Cathedral%2C_Cobh.jpg",
  // Galway (Galway + Mayo + Roscommon) — Kylemore Abbey, Connemara
  GAL: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Kylemore_October_2014-1a.jpg/1280px-Kylemore_October_2014-1a.jpg",
  // Donegal (Cavan + Donegal + Leitrim + Louth + Monaghan + Sligo) — Slieve League cliffs, Co. Donegal
  DON: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Slieve_League%2C_Ireland_%2817219489569%29.jpg/1280px-Slieve_League%2C_Ireland_%2817219489569%29.jpg",
};

/** Get a representative image URL for an Irish region card. */
export function getIERegionImage(regionId: string): string {
  return IE_REGION_IMAGES[regionId] ?? IE_DEFAULT_IMAGE;
}

/**
 * NUTS-III region id → constituent City/County Council names, for the §3.1
 * Option C flavor pass. The 8 playable regions are still the mechanical
 * tier; this map renders a "Comprising: …" footnote on the IE region page
 * so players see which real-world local authorities sit underneath. Pure
 * UI data — no game-state implication.
 */
export const IE_REGION_CONSTITUENT_COUNCILS: Record<string, string[]> = {
  DUB: [
    "Dublin City Council",
    "Dún Laoghaire-Rathdown County Council",
    "Fingal County Council",
    "South Dublin County Council",
  ],
  KIL: ["Kildare County Council", "Meath County Council", "Wicklow County Council"],
  MID: [
    "Laois County Council",
    "Longford County Council",
    "Offaly County Council",
    "Westmeath County Council",
  ],
  WEX: [
    "Carlow County Council",
    "Kilkenny County Council",
    "Tipperary County Council",
    "Waterford City & County Council",
    "Wexford County Council",
  ],
  LIM: ["Clare County Council", "Limerick City & County Council"],
  COR: ["Cork City Council", "Cork County Council", "Kerry County Council"],
  GAL: [
    "Galway City Council",
    "Galway County Council",
    "Mayo County Council",
    "Roscommon County Council",
  ],
  DON: [
    "Cavan County Council",
    "Donegal County Council",
    "Leitrim County Council",
    "Louth County Council",
    "Monaghan County Council",
    "Sligo County Council",
  ],
};
