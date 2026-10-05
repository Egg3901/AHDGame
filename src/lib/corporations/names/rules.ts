/**
 * NPP corporation names combine a local brand with an industry name.
 * chooseNppCorporationName avoids existing names, including after the pool fills.
 */
import type { CorporationType } from "@/lib/constants/corporations";

const LOCAL_BRANDS: Record<string, readonly string[]> = {
  US: [
    "Copperline",
    "Juniper Creek",
    "Redwood Meridian",
    "Blue Mesa",
    "Cinder Lake",
    "Prairie Lantern",
  ],
  UK: ["Kestrel Yard", "Alderwick", "Bracken & Bell", "Lantern Quay", "Rookhaven", "Thistlebridge"],
  JP: ["Aobane", "Tsukihara", "Kogane Harbor", "Mizunoki", "Hoshikawa", "Shirotsuru"],
};
const WORLD_BRANDS = [
  "Amberwake",
  "Silver Orchard",
  "Marrowstone",
  "Cobalt Finch",
  "Windward Loom",
  "Copper Lantern",
];
const INDUSTRY_NAMES: Record<CorporationType, readonly string[]> = {
  financial: ["Capital Partners", "Merchant Trust", "Investment House"],
  media: ["Press & Signal", "Newsroom", "Broadcast Company"],
  manufacturing: ["Industrial Works", "Foundry", "Precision Works"],
  chemical_industries: ["Applied Materials", "Chemical Works", "Process Labs"],
  healthcare: ["Care Network", "Medical Partners", "Health Services"],
  retail: ["Trading Stores", "Market House", "General Stores"],
  automobiles: ["Motor Works", "Coachbuilders", "Vehicle Company"],
  technology: ["Logic Works", "Computing", "Systems Laboratory"],
  energy: ["Power Company", "Gridworks", "Electric Works"],
  agriculture: ["Harvest Cooperative", "Field & Orchard", "Growers"],
  real_estate: ["Land & Estates", "Property Partners", "Urban Holdings"],
  construction: ["Civil Works", "Builders Guild", "Engineering Company"],
  defense: ["Aerospace & Defense", "Armament Works", "Defense Engineering"],
  telecommunications: ["Telephone & Cable", "Signal Networks", "Communications"],
  entertainment: ["Pictures", "Stage & Screen", "Recording Studios"],
  logistics: ["Freight Lines", "Shipping Company", "Transit Partners"],
  extraction: ["Mineral Company", "Mining & Resources", "Geological Works"],
};

export function chooseNppCorporationName(
  countryId: string,
  type: CorporationType,
  existingNames: readonly string[],
  rng: () => number
): string {
  const brands = LOCAL_BRANDS[countryId] ?? WORLD_BRANDS;
  const industries = INDUSTRY_NAMES[type];
  const occupied = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  const choices = brands.flatMap((brand) => industries.map((industry) => `${brand} ${industry}`));
  const sample = rng();
  const start = Math.floor(
    (Number.isFinite(sample) ? Math.max(0, Math.min(0.999999, sample)) : 0) * choices.length
  );
  for (let offset = 0; offset < choices.length; offset++) {
    const name = choices[(start + offset) % choices.length]!;
    if (!occupied.has(name.toLowerCase())) return name;
  }
  const base = choices[start]!;
  for (let serial = 2; ; serial++) {
    const name = `${base} ${serial}`;
    if (!occupied.has(name.toLowerCase())) return name;
  }
}
