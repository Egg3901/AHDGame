import type { WikiSeedPage } from "../types";
import {
  COMMODITY_TYPES,
  COMMODITY_LABELS,
  COMMODITY_UNITS,
  COMMODITY_BASE_PRICES,
  EXTRACTABLE_RESOURCES,
  SECTOR_SUPPLY,
  SECTOR_DEMAND,
  COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND,
  type CommodityType,
} from "@/lib/constants/commodities";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";

/**
 * One-line description per commodity: kept short so the page intro reads
 * cleanly. Paired with the auto-generated supply/demand sections below.
 */
const COMMODITY_SUMMARIES: Record<CommodityType, string> = {
  steel:
    "the backbone input of heavy industry: structural material for construction, vehicles, defense, and energy infrastructure.",
  electronics:
    "finished semiconductors and circuit-level components used across technology, healthcare, defense, and consumer devices.",
  energy:
    "electrical generation output; the universal input for almost every productive sector in the simulation.",
  chemicals:
    "industrial chemicals: solvents, intermediates, and process inputs feeding manufacturing, agriculture, and pharmaceuticals.",
  pharmaceuticals:
    "finished drug formulations supplied by healthcare and consumed by retail and clinical demand.",
  fertilizers:
    "nitrogen-phosphorus-potassium blends driving agricultural yield and, by extension, food supply.",
  food: "agricultural output: raw and processed food products feeding retail, healthcare catering, and logistics.",
  building_materials:
    "cement, aggregate, lumber, and related bulk inputs for construction and real estate development.",
  construction_services:
    "crew-day labor capacity for construction projects: supplied by construction firms, demanded by infrastructure, energy, and real estate.",
  healthcare_services:
    "visit-equivalent clinical capacity: output of the healthcare sector and a macro demand sink driven by government health spending.",
  real_estate_services:
    "leasing and brokerage activity: output of real estate firms and a diffuse demand across every revenue-generating sector.",
  software:
    "licensed software seats and platform services: supplied by tech and telco firms, consumed almost everywhere modern work happens.",
  financial_services:
    "underwriting, advisory, and trading capacity: demand flexes with debt issuance and the prevailing prime rate.",
  advertising:
    "campaign-unit media capacity: supplied by media and entertainment, pulled hard by corporate marketing budgets.",
  vehicles:
    "finished vehicles and heavy machinery: supplied by automobiles and defense, demanded by logistics, energy, agriculture, and retail.",
  retail:
    "the consumer-goods basket: end-user demand for retail is scaled by GDP growth and is the primary driver of the commodity market.",
  freight:
    "container-equivalent transportation capacity: produced by logistics, demanded by anyone moving physical goods.",
  consulting_services:
    "professional engagement-hours: supplied by logistics/consulting, demanded by tech, media, finance, and defense.",
  iron: "extractable ore: raw input for steel and heavy manufacturing, gated by per-state capacity ceilings.",
  coal: "extractable fossil fuel: primary combustion input for energy and a meaningful input to manufacturing.",
  oil: "extractable crude: the feedstock for chemicals and a core energy-sector input, priced globally.",
  rare_earth:
    "extractable strategic minerals: small volumes but critical for electronics, defense, and advanced manufacturing.",
  timber:
    "extractable forestry output: lumber and pulp inputs for construction, real estate, and manufacturing.",
  natural_gas:
    "extractable fossil fuel: heat and process feedstock for chemicals, manufacturing, and energy.",
  ordnance:
    "finished weapons-system lots: supplied by defense, demanded primarily by extraction (industrial blasting).",
  plastics:
    "polymer and extrusion output: feedstock for manufacturing, healthcare packaging, automobiles, and construction.",
  network_services:
    "subscription-equivalent broadband and connectivity capacity: unique output of telecom sectors, with macro demand scaling with state GDP.",
  entertainment_services:
    "event-equivalent entertainment capacity: unique output of entertainment sectors, with macro demand scaling with state GDP.",
};

function formatSectorList(
  map: Partial<Record<CorporationType, { commodity: CommodityType; rate: number }[]>>,
  commodity: CommodityType
): string[] {
  const rows: { label: string; rate: number }[] = [];
  for (const [sector, flows] of Object.entries(map) as [
    CorporationType,
    { commodity: CommodityType; rate: number }[],
  ][]) {
    const flow = flows?.find((f) => f.commodity === commodity);
    if (!flow) continue;
    const label = CORPORATION_TYPE_LABELS[sector] ?? sector;
    rows.push({ label, rate: flow.rate });
  }
  rows.sort((a, b) => b.rate - a.rate);
  return rows.map((r) => `- **${r.label}**: ${(r.rate * 100).toFixed(0)}% of sector revenue`);
}

function buildCommodityMarkdown(commodity: CommodityType): string {
  const label = COMMODITY_LABELS[commodity];
  const unit = COMMODITY_UNITS[commodity];
  const basePrice = COMMODITY_BASE_PRICES[commodity];
  const summary = COMMODITY_SUMMARIES[commodity];
  const isExtractable = (EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity);
  const isMacro = COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND.has(commodity);

  const suppliers = formatSectorList(SECTOR_SUPPLY, commodity);
  const consumers = formatSectorList(SECTOR_DEMAND, commodity);

  const suppliersSection =
    suppliers.length > 0
      ? `## Who supplies it\n\nSectors that produce ${label} as output, with per-revenue supply rates:\n\n${suppliers.join(
          "\n"
        )}`
      : `## Who supplies it\n\n${label} has no direct producing sector: supply is driven by the base market stabilizer and any seeded inventory.`;

  const consumersSection =
    consumers.length > 0
      ? `## Who demands it\n\nSectors that consume ${label} as an input, with per-revenue demand rates:\n\n${consumers.join(
          "\n"
        )}`
      : `## Who demands it\n\n${label} has no direct consuming sector in the default operating strategies.`;

  const extractionNote = isExtractable
    ? `\n\nBecause ${label} is an **extractable resource**, per-state output is capped by [state resource capacity](/wiki/resources-overview). The live distribution below shows each country's current capacity alongside supply and demand.`
    : "";

  const relatedLinks = [
    `- [Commodities overview](/wiki/commodities)`,
    `- [Full market page](/commodity/${commodity})`,
  ];
  if (isExtractable) {
    relatedLinks.push(`- [Resources overview](/wiki/resources-overview)`);
    relatedLinks.push(`- [Extraction contracts](/wiki/extraction-contracts)`);
  }

  const blendDescription = isMacro
    ? "**50% global + 50% national (country-aggregate)**: state-level S/D is meaningless because this market is driven by nationwide budgets, campaigns, or bond issuance rather than one state's local balance"
    : "**50% global + 25% national (country-aggregate) + 25% regional (state)**";
  const macroNote = isMacro
    ? " The national leg uses country-aggregate S/D with a 500-unit stabilizer on each side."
    : "";

  return `**${label}** (*${unit}*, base price **$${basePrice.toLocaleString()}**) is ${summary}

## Market behaviour

Prices blend ${blendDescription}, drifting toward equilibrium at 6% per turn (95% closed in one game year). Raw D/S remains visible for diagnosis; price and margin math use the same raw ratio up to 3x, then a softened effective pressure tail beyond that.${macroNote}

Sector profit margins are computed separately at three tiers: global, national, and local (state): then blended at **50/25/25** by default. Tariff pressure shifts weight from the global leg to the national leg (local stays fixed at 25%), so a heavily-tariffed country becomes more sensitive to its own domestic supply chain. See [Commodities](/wiki/commodities) for the full pricing mechanics and margin formula.${extractionNote}

${suppliersSection}

${consumersSection}

## Live distribution

Per-country totals below are pulled live from the current turn's market snapshot. Countries with positive net are exporters on balance; negative nets are importers.

\`\`\`commodity-distribution
${commodity}
\`\`\`

## Related

${relatedLinks.join("\n")}
`;
}

export const commoditiesPages: readonly WikiSeedPage[] = COMMODITY_TYPES.map((commodity) => {
  const label = COMMODITY_LABELS[commodity];
  const isExtractable = (EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity);
  const slug = `commodity-${commodity.replace(/_/g, "-")}`;
  return {
    slug,
    title: label,
    description: `${label} market overview: who supplies, who demands, and current per-country totals with live prices.`,
    content: buildCommodityMarkdown(commodity),
    category: "commodities",
    extraTags: isExtractable ? [commodity, "resources"] : [commodity],
    featured: false,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 3,
  } satisfies WikiSeedPage;
});
