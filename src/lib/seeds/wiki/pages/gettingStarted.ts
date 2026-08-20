import type { WikiSeedPage } from "../types";
import { gettingStartedContent } from "../content/gettingStarted";
import { createACharacterContent } from "../content/createACharacter";
import { coreSystemsContent } from "../content/coreSystems";
import { statsActionsContent } from "../content/statsActions";
import { theGameLoopContent } from "../content/theGameLoop";
import { playerProgressionContent } from "../content/playerProgression";
import { relocationContent } from "../content/relocation";
import { firstCampaignWalkthroughContent } from "../content/firstCampaignWalkthrough";
import { gameStartingStateContent } from "../content/gameStartingState";
import { mailContent } from "../content/mail";
import { newsContent } from "../content/news";
import { strategyGuidesIndexContent } from "../content/strategyGuidesIndex";

export const gettingStartedPages: readonly WikiSeedPage[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    description:
      "Welcome, country pick, first-ten-minutes path, and links to every core guide for new players.",
    content: gettingStartedContent,
    category: "getting-started",
    extraTags: ["onboarding", "new-player"],
    designDocUrl: "design/getting-started.html",
    featured: true,
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 5,
  },
  {
    slug: "strategy-guides",
    title: "Strategy Guides",
    description:
      "Categorized index of every long-form strategy guide: corporations, commodities, command economies, investing, bonds, forex, running for office, and API automation.",
    content: strategyGuidesIndexContent,
    category: "getting-started",
    featured: true,
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 3,
    lastUpdated: "2026-08-20",
  },
  {
    slug: "create-a-character",
    title: "Create a Character",
    description:
      "Every decision during onboarding: country, name, home region, policy positions, starting kit, first party.",
    content: createACharacterContent,
    category: "getting-started",
    extraTags: ["onboarding", "character"],
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 4,
  },
  {
    slug: "core-systems",
    title: "Core Systems",
    description:
      "Turn structure, term cycles, action economy, money pools, and the per-turn processing order.",
    content: coreSystemsContent,
    category: "getting-started",
    extraTags: ["turns", "actions"],
    featured: true,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 6,
    designDocUrl: "design/core-systems.html",
  },
  {
    slug: "stats-actions",
    title: "Stats & Actions",
    description:
      "Complete reference for every stat a character carries and every action they can spend, with costs and formulas.",
    content: statsActionsContent,
    category: "getting-started",
    extraTags: ["actions", "stats"],
    designDocUrl: "design/stats-actions.html",
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 8,
  },
  {
    slug: "the-game-loop",
    title: "The Game Loop",
    description:
      "How much you actually need to log in: per-turn, per-day, per-cycle rhythms plus the long-term career arc.",
    content: theGameLoopContent,
    category: "getting-started",
    extraTags: ["turns", "onboarding"],
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 5,
  },
  {
    slug: "player-progression",
    title: "Player Progression",
    description:
      "Career arc from independent to head of state: phases, office benefits, per-country ladders.",
    content: playerProgressionContent,
    category: "getting-started",
    extraTags: ["career", "offices"],
    designDocUrl: "design/player-progression.html",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "relocation",
    title: "Relocation",
    description:
      "Moving home state, region, or country: what resets, what's preserved, CEO rules, and strategic timing.",
    content: relocationContent,
    category: "getting-started",
    extraTags: ["home-state"],
    designDocUrl: "design/relocation.html",
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 5,
  },
  {
    slug: "first-campaign-walkthrough",
    title: "First Campaign Walkthrough",
    description:
      "Concrete week-by-week example of a new player running their first State Senate race: from Day 1 actions to election night.",
    content: firstCampaignWalkthroughContent,
    category: "getting-started",
    extraTags: ["campaign", "onboarding"],
    featured: true,
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 9,
  },
  {
    slug: "game-starting-state",
    title: "Game Starting State",
    description:
      "Starting parties, NPPs, treasuries, and legislature sizes for every country: the exact configuration a new world opens with.",
    content: gameStartingStateContent,
    category: "getting-started",
    extraTags: ["seed", "presets"],
    featured: false,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 8,
  },
  {
    slug: "mail",
    title: "Mail",
    description:
      "Player-to-player messaging in the Notification Center: compose limits, inbox and sent, read state, delete, and reporting.",
    content: mailContent,
    category: "getting-started",
    extraTags: ["inbox", "messaging", "notifications"],
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 3,
    lastUpdated: "2026-08-20",
    designDocUrl: "design/mail.html",
  },
  {
    slug: "news",
    title: "News",
    description:
      "The public /news feed: free player posts, sponsored placements, and system articles the turn processor writes.",
    content: newsContent,
    category: "getting-started",
    extraTags: ["media", "feed"],
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 3,
    lastUpdated: "2026-08-20",
  },
];
