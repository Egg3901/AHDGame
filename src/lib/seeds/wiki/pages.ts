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
 * Phase status:
 *   ✓ Phase 1 — Getting Started (8 pages)
 *   ✓ Phase 2 — Elections (11 pages)
 *   ✓ Phase 3 — Legislatures & Government (9 pages)
 *   ✓ Phase 4 — Parties, Coalitions, NPPs (11 pages)
 *   ✓ Phase 5 — Country hubs (4 pages: US, UK, DE, JP)
 *   ✓ Phase 6 — Economy & Finance (12 pages)
 *   ✓ Phase 7 — Advanced + Reference + Strategy (11 pages)
 *   ✓ Phase 8 — Resources & Contracts (4 pages)
 *   ✓ Phase 9 — Commodities (one page per CommodityType, auto-generated)
 *   ✓ Phase 10 — Conflicts & Military (11 pages)
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
