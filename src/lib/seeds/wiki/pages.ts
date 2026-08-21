import type { WikiSeedPage } from "./types";
import { gettingStartedPages } from "./pages/gettingStarted";
import { electionsPages } from "./pages/elections";
import { legislaturesPages } from "./pages/legislatures";
import { partiesPages } from "./pages/parties";
import { countriesPages } from "./pages/countries";
import { militaryPages } from "./pages/military";
import { economyPages } from "./pages/economy";
import { advancedPages } from "./pages/advanced";
import { resourcesPages } from "./pages/resources";
import { commoditiesPages } from "./pages/commodities";
import { iterationsPages } from "./pages/iterations";

/**
 * Aggregated wiki page seed list.
 *
 * Content is organised by category in `./pages/*.ts` files. Each category file
 * exports a `readonly WikiSeedPage[]`; they are concatenated here into the
 * canonical `WIKI_SEED_PAGES` list consumed by `seedWikiPages`.
 *
 * Phase status (page counts from the category files concatenated below):
 *   Getting Started (12 pages)
 *   Elections (17 pages)
 *   Legislatures & Government (15 pages)
 *   Parties, Coalitions, NPPs (13 pages)
 *   Country hubs (10 pages: US, UK, DE, JP, IE, BR, CN, NG, RU, DD)
 *   Economy & Finance (35 pages)
 *   Advanced + Reference + Strategy (25 pages)
 *   Resources & Contracts (4 pages)
 *   Commodities (one page per CommodityType, auto-generated)
 *   Conflicts & Military (12 pages)
 *   Iterations (2 pages)
 *
 * Wiki goes public when an admin flips `wikiDisabled = false` in the admin panel.
 */
export const WIKI_SEED_PAGES: readonly WikiSeedPage[] = [
  ...gettingStartedPages,
  ...electionsPages,
  ...legislaturesPages,
  ...partiesPages,
  ...countriesPages,
  ...militaryPages,
  ...economyPages,
  ...advancedPages,
  ...resourcesPages,
  ...commoditiesPages,
  ...iterationsPages,
];
