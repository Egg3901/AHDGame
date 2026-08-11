/**
 * China (CN) constants — macro-regions, banner images, etc.
 */

/** [id, displayName] tuples for the 7 playable CN macro-regions. */
export const CN_MACRO_REGIONS: [string, string][] = [
  ["DB", "Dongbei"],
  ["HB", "Huabei"],
  ["HD", "Huadong"],
  ["HZ", "Huazhong"],
  ["HN", "Huanan"],
  ["XN", "Xinan"],
  ["XB", "Xibei"],
];

/**
 * Representative landmark/landscape photos for each of the 7 macro-regions.
 * URLs sourced from Wikimedia Commons via Wikipedia article infobox images.
 * Freely licensed via Commons.
 */

const CN_DEFAULT_IMAGE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/The_Great_Wall_of_China_at_Jinshanling-edit.jpg/1280px-The_Great_Wall_of_China_at_Jinshanling-edit.jpg";

const CN_REGION_IMAGES: Record<string, string> = {
  // Dongbei (Northeast) — Saint Sophia Cathedral, Harbin
  DB: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/West_facade_of_St._Sophia_Cathedral%2C_Harbin_%2820230721150450%29.jpg/1280px-West_facade_of_St._Sophia_Cathedral%2C_Harbin_%2820230721150450%29.jpg",
  // Huabei (North) — Great Wall of China
  HB: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/The_Great_Wall_of_China_at_Jinshanling-edit.jpg/1280px-The_Great_Wall_of_China_at_Jinshanling-edit.jpg",
  // Huadong (East) — Oriental Pearl Tower, Shanghai
  HD: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Oriental_Pearl_Tower_20251126.jpg/1280px-Oriental_Pearl_Tower_20251126.jpg",
  // Huazhong (Central) — Yellow Crane Tower, Wuhan
  HZ: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/CN_-_Hubei_-_Wuhan_-_Kranichpagode.jpg/1280px-CN_-_Hubei_-_Wuhan_-_Kranichpagode.jpg",
  // Huanan (South) — Li River, Guilin
  HN: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/87318-Li-River.jpg/1280px-87318-Li-River.jpg",
  // Xinan (Southwest) — Leshan Giant Buddha
  XN: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/36275-Leshan_%2849067653383%29.jpg/1280px-36275-Leshan_%2849067653383%29.jpg",
  // Xibei (Northwest) — Terracotta Army, Xi'an
  XB: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/51714-Terracota-Army.jpg/1280px-51714-Terracota-Army.jpg",
};

/** Get a representative image URL for a Chinese macro-region card. */
export function getCNRegionImage(regionId: string): string {
  return CN_REGION_IMAGES[regionId] ?? CN_DEFAULT_IMAGE;
}
