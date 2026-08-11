/**
 * Representative hero images for Ukraine's six regions (Wikimedia Commons via
 * the stable Special:FilePath redirect), keyed by region id (= `states._id`,
 * matching `src/lib/seeds/ua/uaRegions.ts` / `uaRegions1953.ts`).
 *
 * Follows `blrRegionImages.ts`. Subjects are chosen for what the region IS in
 * the simulation - the Donbas is a coalfield, the Dnieper belt is metallurgy,
 * the west is the one region the plan never remade - rather than for postcard
 * value, so the banner reinforces the economic model a player is reading.
 */
const UA_REGION_IMAGES: Record<string, string> = {
  // Kyiv and the Right Bank — Khreshchatyk, rebuilt from rubble after 1945.
  UKR_KYI:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Khreshchatyk_Street_Kyiv.jpg?width=1280",
  // The west — Lviv old town: Habsburg, Polish and Greek-Catholic in turn, and
  // Soviet only since 1939.
  UKR_WES:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Lviv_Market_Square_panorama.jpg?width=1280",
  // Podolia — the sugar-beet and grain country of the Right Bank interior.
  UKR_POD:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Kamianets-Podilskyi_Castle_general_view.jpg?width=1280",
  // The Donbas — the coalfield the whole republic's 1953 plan turns on.
  UKR_DON: "https://commons.wikimedia.org/wiki/Special:FilePath/Donetsk_terrikon.jpg?width=1280",
  // The Dnieper belt — the Dniprohes dam, rebuilt 1950, and the metallurgy it
  // powers.
  UKR_DNI:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Dnieper_Hydroelectric_Station.jpg?width=1280",
  // The south — Odesa, the Black Sea outlet.
  UKR_SOU:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Odessa_Potemkin_Stairs.jpg?width=1280",
};

/** Kyiv stands in when a region id is unrecognised. */
const UA_DEFAULT_IMAGE = UA_REGION_IMAGES.UKR_KYI;

export function getUARegionImage(regionId: string): string {
  return UA_REGION_IMAGES[regionId] ?? UA_DEFAULT_IMAGE;
}
