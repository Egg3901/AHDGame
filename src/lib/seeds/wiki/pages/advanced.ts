import type { WikiSeedPage } from "../types";
import { advancedStrategyContent } from "../content/advancedStrategy";
import { multiCountryPlayContent } from "../content/multiCountryPlay";
import { powerPlayerGuideContent } from "../content/powerPlayerGuide";
import { referenceFormulasContent } from "../content/referenceFormulas";
import { referenceTurnOrderContent } from "../content/referenceTurnOrder";
import { referenceOfficesContent } from "../content/referenceOffices";
import { tipsForBeginnersContent } from "../content/tipsForBeginners";
import { faqContent } from "../content/faq";
import { glossaryContent } from "../content/glossary";
import { endgameGoalsContent } from "../content/endgameGoals";
import { readingTheGameContent } from "../content/readingTheGame";
import { politicalCapitalContent } from "../content/politicalCapital";
import { internationalOrganizationsContent } from "../content/internationalOrganizations";
import { achievementsContent } from "../content/achievements";
import { caucusesContent } from "../content/caucuses";
import { tradeSystemContent } from "../content/tradeSystem";
import { rpgStatsContent } from "../content/rpgStats";
import { crisisInteractionContent } from "../content/crisisInteraction";
import { playerEventsContent } from "../content/playerEvents";
import {
  INTERNATIONAL_ORGANIZATION_ORDER,
  INTERNATIONAL_ORGANIZATIONS,
} from "@/lib/constants/internationalOrganizations";

const builtInOrgShortNames = INTERNATIONAL_ORGANIZATION_ORDER.map(
  (id) => INTERNATIONAL_ORGANIZATIONS[id].shortName
).join(", ");

export const advancedPages: readonly WikiSeedPage[] = [
  {
    slug: "advanced-strategy",
    title: "Advanced Strategy",
    description:
      "High-level strategic frameworks for experienced players: career arcs, office timing, controlling multiple levers, and coordinating elections with legislation.",
    content: advancedStrategyContent,
    category: "advanced",
    featured: false,
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 8,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "multi-country-play",
    title: "Multi-Country Play",
    description:
      "How character countryId scoping works, playing in parliamentary vs presidential systems, and how economic investments (forex, bonds, corporations) cross borders.",
    content: multiCountryPlayContent,
    category: "advanced",
    featured: false,
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 7,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "power-player-guide",
    title: "Power Player Guide",
    description:
      "Becoming a dominant force: controlling party leadership, stacking offices, running a corporation alongside a political career, and influencing NPP behavior.",
    content: powerPlayerGuideContent,
    category: "advanced",
    featured: false,
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 9,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "reference-formulas",
    title: "Reference: Formulas",
    description:
      "Complete formula reference: primary score, presidential primary, canvassing, vote accumulation, campaign upgrades, party org scalars, and NPI normalization.",
    content: referenceFormulasContent,
    category: "advanced",
    featured: true,
    difficulty: "advanced",
    contentType: "reference",
    estimatedReadTime: 10,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "reference-turn-order",
    title: "Reference: Turn Order",
    description:
      "The complete turn processing sequence: 14 groups, 40+ phases, what runs in each, and why the Group 7 election resolution order is strictly load-bearing.",
    content: referenceTurnOrderContent,
    category: "advanced",
    featured: false,
    difficulty: "advanced",
    contentType: "reference",
    estimatedReadTime: 10,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "reference-offices",
    title: "Reference: Offices",
    description:
      "Complete reference for all playable offices across the US, UK, Germany, and Japan: how each is won, term lengths, action bonuses, and party strength weights.",
    content: referenceOfficesContent,
    category: "advanced",
    featured: false,
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 9,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "tips-for-beginners",
    title: "Tips for Beginners",
    description:
      "15 practical tips for players in their first few game weeks: action management, party joining, polling before declaring, campaign season timing, and more.",
    content: tipsForBeginnersContent,
    category: "advanced",
    featured: false,
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 6,
    lastUpdated: "2026-08-20",
  },
  {
    slug: "faq",
    title: "FAQ",
    description:
      "Frequently asked questions: why can't I run for Senate, why did I lose my primary, how do I get more actions, what happens at the end of a game year, and more.",
    content: faqContent,
    category: "advanced",
    featured: false,
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 7,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "glossary",
    title: "Glossary",
    description:
      "Alphabetical definitions of all game terms: action, alignment, canvassing, coalition, countryId, favorability, GOTV, NPP, party org, primary score, snap election, and more.",
    content: glossaryContent,
    category: "advanced",
    featured: true,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 8,
    lastUpdated: "2026-08-19",
  },
  {
    slug: "endgame-goals",
    title: "Endgame Goals",
    description:
      "Long-term goals for established players: becoming president or PM, controlling the economy, running a dominant party, achieving policy targets, and measuring success.",
    content: endgameGoalsContent,
    category: "advanced",
    featured: false,
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 7,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "reading-the-game",
    title: "Reading the Game",
    description:
      "How to read current game state: national metrics, active elections, turn log, party standings, NPP ideologies, and using poll data to make strategic decisions.",
    content: readingTheGameContent,
    category: "advanced",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 8,
    lastUpdated: "2026-08-19",
  },
  {
    slug: "political-capital",
    title: "Political Capital",
    description:
      "How the player-to-NPP interaction system works: spending actions and funds to shift relationship, favorability, and political influence, with a full action reference and ledger tracking.",
    content: politicalCapitalContent,
    category: "advanced",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "international-organizations",
    title: "International Organizations",
    description: `Multilateral bodies: ${builtInOrgShortNames}, and custom orgs: covering founding members, leadership terms, membership proposals, org legislation, and how FTAs and blocs affect trade.`,
    content: internationalOrganizationsContent,
    category: "advanced",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "achievements",
    title: "Achievements",
    description:
      "Account-bound milestones keyed by userId, with optional characterId tracking, rarity tiers, event-driven triggers, and a non-throwing API that returns false on failure.",
    content: achievementsContent,
    category: "advanced",
    featured: false,
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 4,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "caucuses",
    title: "Caucuses",
    description:
      "Caucus health diagnostics: churn tracking over a 12-turn window, at-risk NPP retention with exit risk labels, whip defiance integration, and Healthy/Strained/Fragile health labels.",
    content: caucusesContent,
    category: "advanced",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "trade-system",
    title: "International Trade",
    description:
      "The inter-country trade clearing engine: FTA 1.6× bonus, bloc 1.25× bonus, tariff drag formula, 40-iteration IPF convergence, and ministerial embargo rules with cooldowns.",
    content: tradeSystemContent,
    category: "advanced",
    featured: false,
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 7,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "rpg-stats",
    title: "RPG Stats & Debates",
    description:
      "The seven character stats: what each does, how you raise and lose them through play, the 28-point creation budget, and how election debates are scored.",
    content: rpgStatsContent,
    category: "advanced",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "crisis-interaction",
    title: "Crisis Interaction",
    description:
      "Template crises, decision trees, collective contributions, chained multi-country decisions such as Vietnam, ambient cards, and automatic spawning.",
    content: crisisInteractionContent,
    category: "advanced",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
    lastUpdated: "2026-08-18",
  },
  {
    slug: "player-events",
    title: "Player Random Events",
    description:
      "The PREE driver: per-turn event offers, two-layer eligibility checks, per-kind and global cooldowns, event-definition/handler split, and the debate-supersede rule when RPG stats are on.",
    content: playerEventsContent,
    category: "advanced",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 4,
    lastUpdated: "2026-08-11",
  },
];
