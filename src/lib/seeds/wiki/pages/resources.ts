import type { WikiSeedPage } from "../types";
import { resourcesOverviewContent } from "../content/resourcesOverview";
import { extractionContractsContent } from "../content/extractionContracts";
import { subsidiesContent } from "../content/subsidies";
import { tariffsContent } from "../content/tariffs";

export const resourcesPages: readonly WikiSeedPage[] = [
  {
    slug: "resources-overview",
    title: "Resources",
    description:
      "State deposits of oil, coal, iron, copper, natural gas, timber, and rare earth: how capacity works and why it affects corporate output and commodity prices.",
    content: resourcesOverviewContent,
    category: "resources",
    extraTags: ["extraction", "deposits"],
    featured: true,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "extraction-contracts",
    title: "Extraction Contracts",
    description:
      "How legislators grant and revoke exclusive resource capacity shares to corporations, and what over-allocation means for commodity supply.",
    content: extractionContractsContent,
    category: "resources",
    extraTags: ["capacity", "extraction"],
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "subsidies",
    title: "Subsidies",
    description:
      "Government financial support programs enacted through legislation that provide profit margin bonuses to qualifying corporation sectors.",
    content: subsidiesContent,
    category: "resources",
    extraTags: ["margins", "legislation"],
    designDocUrl: "design/subsidies.html",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "tariffs",
    title: "Tariffs",
    description:
      "Trade barriers enacted through legislation that impose margin penalties on foreign corporations, shift commodity pricing weights, and affect market capture odds.",
    content: tariffsContent,
    category: "resources",
    extraTags: ["trade", "margins"],
    designDocUrl: "design/tariffs.html",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
];
