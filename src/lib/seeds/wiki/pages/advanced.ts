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
import { globalResponseCrisesContent } from "../content/globalResponseCrises";
import { playerEventsContent } from "../content/playerEvents";
import { blocSpheresContent } from "../content/blocSpheres";
import { notificationsContent } from "../content/notifications";
import { granularPollingContent } from "../content/granularPolling";
import { marketSafeguardsContent } from "../content/marketSafeguards";
import { embargoAndTradeExposureContent } from "../content/embargoAndTradeExposure";
import { worldEventsContent } from "../content/worldEvents";
import { imperialCharactersContent } from "../content/imperialCharacters";
import {
  INTERNATIONAL_ORGANIZATION_ORDER,
  INTERNATIONAL_ORGANIZATIONS,
} from "@/lib/constants/internationalOrganizations";

const builtInOrgShortNames = INTERNATIONAL_ORGANIZATION_ORDER.map(
  (id) => INTERNATIONAL_ORGANIZATIONS[id].shortName
).join(", ");

export const advancedPages: readonly WikiSeedPage[] = [
  {
    slug: "imperial-characters",
    title: "Imperial Characters",
    description:
      "Persistent ceremonial monarchs and emperors: admin-only creation, shared crowns, public identity, and economic holdings.",
    content: imperialCharactersContent,
    category: "advanced",
    extraTags: ["monarch", "emperor", "head-of-state"],
    featured: false,
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 4,
  },
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
  },
  {
    slug: "reference-turn-order",
    title: "Reference: Turn Order",
    description:
      "The complete turn processing sequence: 14 groups, 40+ phases, what runs in each, and why the Group 7 election resolution order is strictly load-bearing.",
    content: referenceTurnOrderContent,
    category: "advanced",
    extraTags: ["turns", "phases"],
    designDocUrl: "design/turn-processing.html",
    featured: false,
    difficulty: "advanced",
    contentType: "reference",
    estimatedReadTime: 10,
  },
  {
    slug: "reference-offices",
    title: "Reference: Offices",
    description:
      "Complete reference for all playable offices across the US, UK, Germany, and Japan: how each is won, term lengths, action bonuses, and party strength weights.",
    content: referenceOfficesContent,
    category: "advanced",
    extraTags: ["offices", "action-bonus"],
    featured: false,
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 9,
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
  },
  {
    slug: "caucuses",
    title: "Caucuses",
    description:
      "Caucus health diagnostics: churn tracking over a 12-turn window, at-risk NPP retention with exit risk labels, whip defiance integration, and Healthy/Strained/Fragile health labels.",
    content: caucusesContent,
    category: "advanced",
    extraTags: ["faction", "whip"],
    designDocUrl: "design/caucuses.html",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
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
  },
  {
    slug: "global-response-crises",
    title: "Global Response Crises",
    description:
      "Persistent international campaigns, country memory, capacity gates, asymmetric briefings, global tension, and the nuclear buildup connection.",
    content: globalResponseCrisesContent,
    category: "advanced",
    extraTags: ["crisis", "cold war", "nuclear", "vietnam"],
    designDocUrl: "design/global-response-crises-as-shipped.html",
    featured: true,
    difficulty: "intermediate",
    contentType: "mechanics",
    estimatedReadTime: 9,
  },
  {
    slug: "crisis-interaction",
    title: "Crisis Interaction",
    description:
      "Template crises, decision trees, collective contributions, chained multi-country decisions such as Vietnam, ambient cards, and automatic spawning.",
    content: crisisInteractionContent,
    category: "advanced",
    extraTags: ["crisis"],
    designDocUrl: "design/crisis-system.html",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
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
  },
  {
    slug: "bloc-spheres",
    title: "Bloc Alignment & Spheres of Influence",
    description:
      "Cold War pole shares and lead, the 60/40 join and leave thresholds with their deadband, passive drift and membership pull, and bloc stress from contested, leaving and newly-digested members.",
    content: blocSpheresContent,
    category: "advanced",
    featured: false,
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "notifications",
    title: "Notification Center",
    description:
      "Reading and managing the in-app inbox: notifications versus mail, the All/Notifs/Mail/Action-needed segments, archiving, and per-type muting and snoozing.",
    content: notificationsContent,
    category: "advanced",
    extraTags: ["inbox"],
    featured: false,
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 4,
  },
  {
    slug: "market-safeguards",
    title: "Market Safeguards",
    description:
      "The automated launch guard behind the live stock market: what aggregate market-cap drawdown trips it, how fundamentals can excuse a fall but never make it stricter, and what a tier revert looks like from the player side.",
    content: marketSafeguardsContent,
    category: "advanced",
    featured: false,
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 5,
  },
  {
    slug: "embargo-and-trade-exposure",
    title: "Embargoes & Trade Exposure",
    description:
      "How ministerial and legislated embargoes are imposed, the cabinet action cost, duration and cooldown limits, and how the trade-exposure model scales a corporation's export revenue instead of shutting the sector down entirely.",
    content: embargoAndTradeExposureContent,
    category: "advanced",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "granular-polling",
    title: "Granular Polling",
    description:
      "Reading the granular electorate panel on your poll results: Layer-1 demographic cross-tab segments, dimension tabs, stacked filters, and why smaller segments carry a wider margin of error.",
    content: granularPollingContent,
    category: "advanced",
    featured: false,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
  },
  {
    slug: "world-events",
    title: "World Events",
    description:
      "Scheduled country-scope events offered to heads of government: one pending offer per country per turn, plus Olympics and World's Fair host picks.",
    content: worldEventsContent,
    category: "advanced",
    extraTags: ["events", "olympics", "worlds-fair"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 4,
    lastUpdated: "2026-08-20",
  },
];
