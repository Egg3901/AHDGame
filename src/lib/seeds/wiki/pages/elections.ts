import type { WikiSeedPage } from "../types";
import { electionMechanicsContent } from "../content/electionMechanics";
import { primariesContent } from "../content/primaries";
import { generalElectionsContent } from "../content/generalElections";
import { pollingContent } from "../content/polling";
import { fundraisingAdsContent } from "../content/fundraisingAds";
import { canvassingContent } from "../content/canvassing";
import { demographicsTargetingContent } from "../content/demographicsTargeting";
import { demographicsContent } from "../content/demographics";
import { usHouseRedistrictingContent } from "../content/usHouseRedistricting";
import { campaignStrategyContent } from "../content/campaignStrategy";
import { campaignManagerContent } from "../content/campaignManager";
import { primaryGeneralTacticsContent } from "../content/primaryGeneralTactics";
import { snapElectionsContent } from "../content/snapElections";
import { electionsPlayerGuideContent } from "../content/electionsPlayerGuide";
import { liveElectionResultsContent } from "../content/liveElectionResults";
import { contingentElectionContent } from "../content/contingentElection";
import { executiveTermLimitsContent } from "../content/executiveTermLimits";
import { referendumsContent } from "../content/referendums";
import { politicalOperationsContent } from "../content/politicalOperations";

export const electionsPages: readonly WikiSeedPage[] = [
  {
    slug: "political-operations",
    title: "Political Operations and Campaign Presence",
    description:
      "The US presidential operations hub: per-candidate state presence, campaign-funded build costs, vote bonuses, and cross-cycle carryover.",
    content: politicalOperationsContent,
    category: "elections",
    extraTags: ["campaign-presence", "president", "ground-game"],
    featured: true,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
  },
  {
    slug: "referendums",
    title: "Independence and Reunification Referendums",
    description:
      "How UK devolved regions request, campaign, vote, and complete independence or Northern Ireland reunification referendums.",
    content: referendumsContent,
    category: "elections",
    extraTags: ["uk", "devolution", "independence", "reunification"],
    featured: true,
    difficulty: "advanced",
    contentType: "reference",
    estimatedReadTime: 6,
  },
  {
    slug: "elections-player-guide",
    title: "Elections: A Granular Player Guide",
    description:
      "A visual walkthrough of the election board, primary and general race pages, campaign operations, persuasion drivers, and exactly how national political influence grows and is spent.",
    content: electionsPlayerGuideContent,
    category: "elections",
    extraTags: ["elections", "npi", "national-influence", "primary", "general", "campaign"],
    featured: true,
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 9,
  },
  {
    slug: "election-mechanics",
    title: "Election Mechanics",
    description:
      "Primary + general phase structure, duration by race, vote accumulation math, FPTP vs RCV, multi-seat allocation, candidacy rules.",
    content: electionMechanicsContent,
    category: "elections",
    extraTags: ["primary", "general", "fptp"],
    featured: true,
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 8,
    designDocUrl: "design/elections.html",
  },
  {
    slug: "primaries",
    title: "Primaries",
    description:
      "Declaration windows, the state vs presidential primary score formulas, NPP primary dynamics, and tactics for winning your party's nomination.",
    content: primariesContent,
    category: "elections",
    extraTags: ["primary", "npp"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "general-elections",
    title: "General Elections",
    description:
      "Vote accumulation across the general phase, the Total Appeal Pipeline, the final-4-turn 30% weighting, FPTP spoilers, and closing-sprint tactics.",
    content: generalElectionsContent,
    category: "elections",
    extraTags: ["general", "appeal"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "polling",
    title: "Polling",
    description:
      "Quick poll vs Full Demographic poll: what they cost, what they return, and how to use poll data to plan ads and canvassing.",
    content: pollingContent,
    category: "elections",
    extraTags: ["polls", "turnout"],
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 5,
  },
  {
    slug: "fundraising-ads",
    title: "Fundraising & Ads",
    description:
      "Fund generation, Build Donor Network ROI by state tier, ad diminishing returns, out-of-state cost multipliers, and the fundraising priority hierarchy.",
    content: fundraisingAdsContent,
    category: "elections",
    extraTags: ["campaign-funds", "ads"],
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "canvassing",
    title: "Canvassing",
    description:
      "The $100 / 1-action home-state turnout boost: alignment multiplier, campaign season 2× window, diminishing returns, and interaction with party GOTV.",
    content: canvassingContent,
    category: "elections",
    extraTags: ["turnout", "campaign"],
    designDocUrl: "design/canvassing.html",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
  },
  {
    slug: "demographics-targeting",
    title: "Demographics & Targeting",
    description:
      "The 12 voter archetypes, the reach × appeal × approval × party-org formula, state political lean, and how to allocate ads and canvassing across groups.",
    content: demographicsTargetingContent,
    category: "elections",
    extraTags: ["archetypes", "appeal"],
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 7,
  },
  {
    slug: "demographics",
    title: "Demographics",
    description:
      "The 12 voter archetypes, how demographic alignment determines election appeal, and turnout manipulation mechanics.",
    content: demographicsContent,
    category: "elections",
    extraTags: ["archetypes", "turnout"],
    designDocUrl: "design/demographics.html",
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 8,
  },
  {
    slug: "us-house-redistricting",
    title: "US House Redistricting",
    description:
      "Congressional district maps, trifecta gerrymandering, compactness and fairness caps, and per-district House elections.",
    content: usHouseRedistrictingContent,
    category: "elections",
    extraTags: ["house", "gerrymander"],
    featured: true,
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "campaign-strategy",
    title: "Campaign Strategy",
    description:
      "Phase-by-phase action allocation, campaign-page upgrade tables with costs and maintenance, fog of war, party org, and the final-4-turn campaign season multiplier.",
    content: campaignStrategyContent,
    category: "elections",
    extraTags: ["campaign", "npi"],
    designDocUrl: "design/campaign-strategy.html",
    featured: true,
    difficulty: "advanced",
    contentType: "strategy",
    estimatedReadTime: 9,
  },
  {
    slug: "campaign-manager",
    title: "Campaign Manager",
    description:
      "The /campaign/[id] page: budget, upgrades, activity log, endorsements, manager assignment, access tiers, donations, and insolvency auto-downgrade.",
    content: campaignManagerContent,
    category: "elections",
    extraTags: ["campaign"],
    designDocUrl: "design/campaign-manager.html",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "primary-general-tactics",
    title: "Primary vs General Tactics",
    description:
      "What to change and what not to change when your primary ends: ad targeting, canvassing, campaign upgrades, Opposition Research, presidential specifics.",
    content: primaryGeneralTacticsContent,
    category: "elections",
    extraTags: ["primary", "general"],
    difficulty: "advanced",
    contentType: "strategy",
    estimatedReadTime: 7,
  },
  {
    slug: "snap-elections",
    title: "Snap Elections",
    description:
      "Parliamentary dissolution mechanics: UK Commons and JP Shūgiin. PM-initiated snaps, the 96-turn auto-snap clock, cycle reset, and 48-hour sprint tactics.",
    content: snapElectionsContent,
    category: "elections",
    extraTags: ["parliamentary", "dissolution"],
    designDocUrl: "design/snap-elections.html",
    difficulty: "advanced",
    contentType: "reference",
    estimatedReadTime: 6,
  },
  {
    slug: "live-election-results",
    title: "Live Election Results",
    description:
      "Election-night results page: the final-hour drip, deterministic reveal order, 5-point call margin, and how national seat/EV projections roll up.",
    content: liveElectionResultsContent,
    category: "elections",
    extraTags: ["election-night"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
  },
  {
    slug: "contingent-election",
    title: "Contingent Election",
    description:
      "The US 12th Amendment fallback when no Electoral College majority forms: House elects President by state delegation, Senate elects VP, deadlock rules.",
    content: contingentElectionContent,
    category: "elections",
    extraTags: ["electoral-college", "house"],
    difficulty: "advanced",
    contentType: "reference",
    estimatedReadTime: 6,
  },
  {
    slug: "executive-term-limits",
    title: "Executive Term Limits",
    description:
      "Per-country term caps on the top executive office: which countries have one, how terms served are counted, and what running-mate restrictions apply.",
    content: executiveTermLimitsContent,
    category: "elections",
    extraTags: ["president", "term"],
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 4,
  },
];
