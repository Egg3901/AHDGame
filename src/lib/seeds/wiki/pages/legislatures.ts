import type { WikiSeedPage } from "../types";
import { billsLegislationContent } from "../content/billsLegislation";
import { votingAndWhipsContent } from "../content/votingAndWhips";
import { policyEffectsContent } from "../content/policyEffects";
import { congressLeadershipContent } from "../content/congressLeadership";
import { chamberLeadershipContent } from "../content/chamberLeadership";
import { cabinetContent } from "../content/cabinet";
import { cabinetProjectsContent } from "../content/cabinetProjects";
import { cabinetGuideContent } from "../content/cabinetGuide";
import { confirmationProcessContent } from "../content/confirmationProcess";
import { governmentFormationContent } from "../content/governmentFormation";
import { noConfidenceVotesContent } from "../content/noConfidenceVotes";
import { onePartyStatesContent } from "../content/onePartyStates";
import { committeesContent } from "../content/committees";
import { impeachmentContent } from "../content/impeachment";
import { scotusContent } from "../content/scotus";

export const legislaturesPages: readonly WikiSeedPage[] = [
  {
    slug: "bills-legislation",
    title: "Bills & Legislation",
    description:
      "How bills are drafted, introduced, voted on in both chambers, and signed into law: including provision costs, NPP auto-voting, and what happens when a bill is enacted.",
    content: billsLegislationContent,
    category: "legislatures",
    extraTags: ["bills", "whip"],
    featured: true,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 8,
    designDocUrl: "design/bills-legislation.html",
  },
  {
    slug: "voting-and-whips",
    title: "Voting & Whips",
    description:
      "How legislators vote on bills, how whip directives influence NPP votes, and strategic use of abstentions and party discipline.",
    content: votingAndWhipsContent,
    category: "legislatures",
    extraTags: ["whip", "npp"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "policy-effects",
    title: "Policy Effects",
    description:
      "How enacted legislation changes national and state metrics each turn: exponential decay, tick rates, federal division, and long-run equilibrium.",
    content: policyEffectsContent,
    category: "legislatures",
    extraTags: ["metrics", "bills"],
    featured: true,
    difficulty: "advanced",
    contentType: "reference",
    estimatedReadTime: 8,
  },
  {
    slug: "congress-leadership",
    title: "Congress Leadership",
    description:
      "Speaker, Majority/Minority Leaders, and committee chairs: how leadership elections work, who votes, coalition blocs, and vacancy succession.",
    content: congressLeadershipContent,
    category: "legislatures",
    extraTags: ["speaker", "majority"],
    designDocUrl: "design/congress-leadership.html",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "chamber-leadership",
    title: "Chamber Leadership",
    description:
      "How presiding-officer elections work across countries: US Speaker, German Bundestagspräsident, Nigerian National Assembly officers, and China's CPPCC/NPCSC chairs, plus the any-seated vs largest-party eligibility split.",
    content: chamberLeadershipContent,
    category: "legislatures",
    extraTags: ["speaker", "presiding"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "cabinet",
    title: "Cabinet",
    description:
      "The 15 US Cabinet positions, how the President nominates and the Senate confirms, and what cabinet members do each turn.",
    content: cabinetContent,
    category: "legislatures",
    extraTags: ["executive", "confirmation"],
    designDocUrl: "design/cabinet.html",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "cabinet-guide",
    title: "Cabinet Guide",
    description:
      "Live reference for every country's cabinet: each post in succession order, the metrics it influences, and every tier setting, regional target, emergency, allocation, advocacy, bond, and building action it can take.",
    content: cabinetGuideContent,
    category: "legislatures",
    extraTags: ["ministerial", "executive"],
    designDocUrl: "design/cabinet.html",
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 12,
  },
  {
    slug: "cabinet-projects",
    title: "Cabinet Projects & Buildings",
    description:
      "The estates, power plants, and infrastructure projects cabinet seats can build: what each asset does, tiers, funding, condition, and the budget envelope.",
    content: cabinetProjectsContent,
    category: "legislatures",
    extraTags: ["estates", "infrastructure"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 8,
  },
  {
    slug: "confirmation-process",
    title: "Confirmation Process",
    description:
      "How Senate confirmation votes work for Cabinet nominees: thresholds, NPP voting logic, tie-breakers, and blocking strategies.",
    content: confirmationProcessContent,
    category: "legislatures",
    extraTags: ["senate", "cabinet"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "government-formation",
    title: "Government Formation",
    description:
      "How parliamentary governments (UK, JP, DE) form after elections: confidence motions, PM/Chancellor appointment votes, coalition negotiations, and the legislation freeze.",
    content: governmentFormationContent,
    category: "legislatures",
    extraTags: ["parliamentary", "coalition"],
    designDocUrl: "design/parliamentary-government.html",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 8,
  },
  {
    slug: "no-confidence-votes",
    title: "No-Confidence Votes",
    description:
      "How votes of no confidence work in parliamentary systems: who proposes, who votes, NPP behavior, VONC outcomes, and the link to snap elections.",
    content: noConfidenceVotesContent,
    category: "legislatures",
    extraTags: ["vonc", "parliamentary"],
    designDocUrl: "design/uk-pm-no-confidence.html",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "one-party-states",
    title: "One-Party States",
    description:
      "How one-party states (CN today) work: the three party tiers (Ruling / Approved / Banned), what each can and cannot do, why new player parties default to banned, and the ruling-party confidence model.",
    content: onePartyStatesContent,
    category: "legislatures",
    extraTags: ["ccp", "sed"],
    designDocUrl: "design/one-party-states-as-shipped.html",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "committees",
    title: "Committees",
    description:
      "National party committees (6 seats, 168-turn elections) versus chamber committee chairs versus the not-yet-live bill committee stage.",
    content: committeesContent,
    category: "legislatures",
    extraTags: ["party", "leadership", "bills"],
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 4,
    lastUpdated: "2026-08-20",
  },
  {
    slug: "impeachment",
    title: "Impeachment",
    description:
      "Removing a president or governor in presidential systems: House majority of votes cast, Senate two-thirds, 6-turn windows, 48-turn cooldown.",
    content: impeachmentContent,
    category: "legislatures",
    extraTags: ["president", "governor", "senate", "house"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 4,
    lastUpdated: "2026-08-20",
  },
  {
    slug: "scotus",
    title: "Supreme Court",
    description:
      "The US Supreme Court: 9 seats that do not occupy current office, Senate-majority confirmation, historical roster until divergence, docket and surprise cases.",
    content: scotusContent,
    category: "legislatures",
    extraTags: ["court", "constitution", "us"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
    lastUpdated: "2026-08-20",
  },
];
