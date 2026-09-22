/**
 * Japan's region directory: the eight game regions, the prefectures inside
 * them, and the card image for each.
 *
 * Relocated from `src/lib/constants/japan.ts`, which now forwards here. It was
 * classified bucket D (relocate) for D7 and missed, so it stayed the one file
 * outside the folder still holding Japan data of its own.
 *
 * ⚠ THIS IS THE SOURCE OF THE REGION NAMES. `JP_GEOGRAPHY.regionNames`
 * derives from `JP_REGIONS` rather than repeating it. Both used to spell out
 * all eight, with equal values and nothing keeping them in step -- a second
 * source in the exact state the folder work exists to remove: correct on the
 * day it was written, silent the first time one side is edited.
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. Client components read
 * `JP_REGIONS` through the shim (character creation, the admin election
 * filters, the country map). A value import here ships whatever it pulls to the
 * browser; `clientSafeLeafModules.test.ts` enforces it.
 *
 * ⚠ `population`, `shugiinDistricts` and `sangiinSeats` ARE DISPLAY
 * FIGURES, not the seat tables. The authoritative counts live in the seat
 * arrays (`JP_SHUGIIN_*`) and in the config's chambers; these describe a region
 * on a card. Do not reconcile a discrepancy by editing this file -- fix, or
 * read, the seat tables instead.
 */

// ── Regions ──────────────────────────────────────────────────────────────────

export interface JPRegion {
  id: string;
  name: string;
  prefectures: string[];
  population: number;
  shugiinDistricts: number;
  sangiinSeats: number;
}

export const JP_REGIONS: JPRegion[] = [
  {
    id: "HOK",
    name: "Hokkaido",
    prefectures: ["Hokkaido"],
    population: 5_200_000,
    shugiinDistricts: 12,
    sangiinSeats: 7,
  },
  {
    id: "TOH",
    name: "Tohoku",
    prefectures: ["Aomori", "Iwate", "Miyagi", "Akita", "Yamagata", "Fukushima"],
    population: 8_600_000,
    shugiinDistricts: 37,
    sangiinSeats: 20,
  },
  {
    id: "KAN",
    name: "Kanto",
    prefectures: ["Ibaraki", "Tochigi", "Gunma", "Saitama", "Chiba", "Tokyo", "Kanagawa"],
    population: 43_500_000,
    shugiinDistricts: 150,
    sangiinSeats: 80,
  },
  {
    id: "CHU",
    name: "Chubu",
    prefectures: [
      "Niigata",
      "Toyama",
      "Ishikawa",
      "Fukui",
      "Yamanashi",
      "Nagano",
      "Gifu",
      "Shizuoka",
      "Aichi",
    ],
    population: 21_100_000,
    shugiinDistricts: 81,
    sangiinSeats: 44,
  },
  {
    id: "KNS",
    name: "Kansai",
    prefectures: ["Mie", "Shiga", "Kyoto", "Osaka", "Hyogo", "Nara", "Wakayama"],
    population: 22_500_000,
    shugiinDistricts: 82,
    sangiinSeats: 44,
  },
  {
    id: "CGK",
    name: "Chugoku",
    prefectures: ["Tottori", "Shimane", "Okayama", "Hiroshima", "Yamaguchi"],
    population: 7_100_000,
    shugiinDistricts: 28,
    sangiinSeats: 14,
  },
  {
    id: "SHI",
    name: "Shikoku",
    prefectures: ["Tokushima", "Kagawa", "Ehime", "Kochi"],
    population: 3_700_000,
    shugiinDistricts: 14,
    sangiinSeats: 8,
  },
  {
    id: "KYU",
    name: "Kyushu & Okinawa",
    prefectures: [
      "Fukuoka",
      "Saga",
      "Nagasaki",
      "Kumamoto",
      "Oita",
      "Miyazaki",
      "Kagoshima",
      "Okinawa",
    ],
    population: 14_300_000,
    shugiinDistricts: 61,
    sangiinSeats: 31,
  },
];

/**
 * The eight region ids, in canonical order.
 *
 * ⚠ DERIVED, SO IT CANNOT DRIFT FROM `JP_REGIONS`. Four files under `data/`
 * each spelled this list out; a region added or renamed above had to be chased
 * through all of them. Exported here so there is one list, not five.
 *
 * Tests that assert coverage over the regions deliberately keep their OWN
 * literal list: an independent statement of what should exist is what catches a
 * region quietly disappearing from this file, and deriving it would make the
 * test agree with the bug.
 */
export const JP_REGION_IDS: string[] = JP_REGIONS.map((region) => region.id);

// ── Prefectures ──────────────────────────────────────────────────────────────

export interface JPPrefecture {
  id: number;
  name: string;
  regionId: string;
  population: number;
}

export const JP_PREFECTURES: JPPrefecture[] = [
  // Hokkaido
  { id: 1, name: "Hokkaido", regionId: "HOK", population: 5_200_000 },
  // Tohoku
  { id: 2, name: "Aomori", regionId: "TOH", population: 1_210_000 },
  { id: 3, name: "Iwate", regionId: "TOH", population: 1_190_000 },
  { id: 4, name: "Miyagi", regionId: "TOH", population: 2_290_000 },
  { id: 5, name: "Akita", regionId: "TOH", population: 930_000 },
  { id: 6, name: "Yamagata", regionId: "TOH", population: 1_050_000 },
  { id: 7, name: "Fukushima", regionId: "TOH", population: 1_830_000 },
  // Kanto
  { id: 8, name: "Ibaraki", regionId: "KAN", population: 2_840_000 },
  { id: 9, name: "Tochigi", regionId: "KAN", population: 1_920_000 },
  { id: 10, name: "Gunma", regionId: "KAN", population: 1_930_000 },
  { id: 11, name: "Saitama", regionId: "KAN", population: 7_340_000 },
  { id: 12, name: "Chiba", regionId: "KAN", population: 6_280_000 },
  { id: 13, name: "Tokyo", regionId: "KAN", population: 13_960_000 },
  { id: 14, name: "Kanagawa", regionId: "KAN", population: 9_240_000 },
  // Chubu
  { id: 15, name: "Niigata", regionId: "CHU", population: 2_180_000 },
  { id: 16, name: "Toyama", regionId: "CHU", population: 1_030_000 },
  { id: 17, name: "Ishikawa", regionId: "CHU", population: 1_120_000 },
  { id: 18, name: "Fukui", regionId: "CHU", population: 760_000 },
  { id: 19, name: "Yamanashi", regionId: "CHU", population: 800_000 },
  { id: 20, name: "Nagano", regionId: "CHU", population: 2_030_000 },
  { id: 21, name: "Gifu", regionId: "CHU", population: 1_960_000 },
  { id: 22, name: "Shizuoka", regionId: "CHU", population: 3_610_000 },
  { id: 23, name: "Aichi", regionId: "CHU", population: 7_530_000 },
  // Kansai
  { id: 24, name: "Mie", regionId: "KNS", population: 1_760_000 },
  { id: 25, name: "Shiga", regionId: "KNS", population: 1_410_000 },
  { id: 26, name: "Kyoto", regionId: "KNS", population: 2_560_000 },
  { id: 27, name: "Osaka", regionId: "KNS", population: 8_810_000 },
  { id: 28, name: "Hyogo", regionId: "KNS", population: 5_440_000 },
  { id: 29, name: "Nara", regionId: "KNS", population: 1_320_000 },
  { id: 30, name: "Wakayama", regionId: "KNS", population: 910_000 },
  // Chugoku
  { id: 31, name: "Tottori", regionId: "CGK", population: 550_000 },
  { id: 32, name: "Shimane", regionId: "CGK", population: 660_000 },
  { id: 33, name: "Okayama", regionId: "CGK", population: 1_880_000 },
  { id: 34, name: "Hiroshima", regionId: "CGK", population: 2_770_000 },
  { id: 35, name: "Yamaguchi", regionId: "CGK", population: 1_330_000 },
  // Shikoku
  { id: 36, name: "Tokushima", regionId: "SHI", population: 710_000 },
  { id: 37, name: "Kagawa", regionId: "SHI", population: 940_000 },
  { id: 38, name: "Ehime", regionId: "SHI", population: 1_320_000 },
  { id: 39, name: "Kochi", regionId: "SHI", population: 680_000 },
  // Kyushu & Okinawa
  { id: 40, name: "Fukuoka", regionId: "KYU", population: 5_100_000 },
  { id: 41, name: "Saga", regionId: "KYU", population: 810_000 },
  { id: 42, name: "Nagasaki", regionId: "KYU", population: 1_300_000 },
  { id: 43, name: "Kumamoto", regionId: "KYU", population: 1_730_000 },
  { id: 44, name: "Oita", regionId: "KYU", population: 1_120_000 },
  { id: 45, name: "Miyazaki", regionId: "KYU", population: 1_060_000 },
  { id: 46, name: "Kagoshima", regionId: "KYU", population: 1_580_000 },
  { id: 47, name: "Okinawa", regionId: "KYU", population: 1_460_000 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get all prefectures within a given JP region. */
export function getJPRegionPrefectures(regionId: string): JPPrefecture[] {
  return JP_PREFECTURES.filter((p) => p.regionId === regionId);
}

/** Get a representative image URL for a JP region card. */
export function getJPRegionImage(regionId: string): string {
  const JP_REGION_IMAGES: Record<string, string> = {
    HOK: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/131103_Hokkaido_University_Sapporo_Hokkaido_Japan01s3.jpg/1280px-131103_Hokkaido_University_Sapporo_Hokkaido_Japan01s3.jpg",
    TOH: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Matsushima_miyagi_z.JPG/1280px-Matsushima_miyagi_z.JPG",
    KAN: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Skyscrapers_of_Shinjuku_2009_January.jpg/1280px-Skyscrapers_of_Shinjuku_2009_January.jpg",
    CHU: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Nagoya_Castle_2024.jpg/1280px-Nagoya_Castle_2024.jpg",
    KNS: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Kinkakuji_2004-09-21.jpg/1280px-Kinkakuji_2004-09-21.jpg",
    CGK: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Itsukushima_torii_distance.jpg/1280px-Itsukushima_torii_distance.jpg",
    SHI: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Ritsurin_park01s3200.jpg/1280px-Ritsurin_park01s3200.jpg",
    KYU: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Kumamoto_Castle_02n3200.jpg/1280px-Kumamoto_Castle_02n3200.jpg",
  };
  return (
    JP_REGION_IMAGES[regionId] ??
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Skyscrapers_of_Shinjuku_2009_January.jpg/1280px-Skyscrapers_of_Shinjuku_2009_January.jpg"
  );
}
