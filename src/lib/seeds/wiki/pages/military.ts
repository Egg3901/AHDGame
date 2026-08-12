import type { WikiSeedPage } from "../types";
import { conflictsOverviewContent } from "../content/conflictsOverview";
import { declaringWarContent } from "../content/declaringWar";
import { militaryUnitsContent } from "../content/militaryUnits";
import { manpowerConscriptionContent } from "../content/manpowerConscription";
import { generalsGuideContent } from "../content/generalsGuide";
import { nationalDoctrineContent } from "../content/nationalDoctrine";
import { militaryCommandsContent } from "../content/militaryCommands";
import { fightingABattleContent } from "../content/fightingABattle";
import { occupationVictoryContent } from "../content/occupationVictory";
import { peaceAndTrucesContent } from "../content/peaceAndTruces";
import { warWalkthroughContent } from "../content/warWalkthrough";

/**
 * Conflicts & Military.
 *
 * Documents the Conflicts subsystem: declaring war, raising forces, the officer
 * corps, doctrine, command structure, battle, occupation and peace.
 *
 * ⚠️ EDITING RULE: battle-resolution math is deliberately NOT published here, so
 * players cannot solve fights rather than fight them. Never add the effective-power
 * formula, the combat-value curve, supply throughput, the round loop, the retreat
 * threshold, the margin-to-territory shift rate, the OCCUPATION constants, or the
 * odds calculation. Combat inputs are described directionally instead. Non-combat
 * numbers players need in order to plan: prices, cooldowns, point budgets, XP
 * thresholds, conscription multipliers: are fair game and are stated explicitly.
 * See docs/superpowers/specs/2026-08-06-military-wiki-category-design.md.
 */
export const militaryPages: readonly WikiSeedPage[] = [
  {
    slug: "conflicts-overview",
    title: "Conflicts & the Military System",
    description:
      "How war works end to end: the Unit → General → Command → Conflict chain, who may do what, the fog tiers, and where every surface lives.",
    content: conflictsOverviewContent,
    category: "military",
    extraTags: ["conflicts", "war", "overview"],
    featured: true,
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 8,
  },
  {
    slug: "declaring-war",
    title: "Declaring War",
    description:
      "War is legislation: the two-thirds bill, war goals, who may file, the 120-turn cooldown, truces, joining an existing war, and opening forces.",
    content: declaringWarContent,
    category: "military",
    extraTags: ["war", "legislation", "diplomacy"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 9,
  },
  {
    slug: "military-units",
    title: "Units, Recruitment & Procurement",
    description:
      "Domains, branches and era gating, the full unit catalogue with costs, GDP-share pricing, build times, tech tiers, postures, veterancy and upkeep.",
    content: militaryUnitsContent,
    category: "military",
    extraTags: ["units", "procurement", "budget"],
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 10,
  },
  {
    slug: "manpower-conscription",
    title: "Manpower & Conscription",
    description:
      "The manpower pool and its ceiling, the five-rung reserve-law ladder, trained versus conscript replacements, and why rebuilding veterans with conscripts degrades them.",
    content: manpowerConscriptionContent,
    category: "military",
    extraTags: ["manpower", "conscription", "legislation"],
    difficulty: "intermediate",
    contentType: "mechanics",
    estimatedReadTime: 7,
  },
  {
    slug: "generals",
    title: "Generals & the Officer Corps",
    description:
      "Commissioning, the five ranks and their XP thresholds, all four sources of skill points, the 115-node trait tree, derived specialisation, and dismissal.",
    content: generalsGuideContent,
    category: "military",
    extraTags: ["generals", "progression", "characters"],
    featured: true,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 10,
  },
  {
    slug: "national-doctrine",
    title: "National Doctrine",
    description:
      "Your nation's permanent way of fighting: 12 points against 128 nodes, decade gating, prerequisites, and how doctrine boosts your generals' traits.",
    content: nationalDoctrineContent,
    category: "military",
    extraTags: ["doctrine", "strategy"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 8,
  },
  {
    slug: "military-commands",
    title: "Commands & Command Structure",
    description:
      "Commands, the 19 strategic regions, capacity and effectiveness, Commanding Generals, Theater Commanders and the authority they take from the defence seat.",
    content: militaryCommandsContent,
    category: "military",
    extraTags: ["commands", "generals", "organization"],
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 9,
  },
  {
    slug: "fighting-a-battle",
    title: "Fighting a Battle",
    description:
      "The operational loop: deploying through generals, reading the two odds bars, declaring an offensive, the defender's window, coalitions, retreat and battle reports.",
    content: fightingABattleContent,
    category: "military",
    extraTags: ["combat", "battles", "tactics"],
    featured: true,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 11,
  },
  {
    slug: "occupation-and-victory",
    title: "Occupation, Territory & Victory",
    description:
      "The control meter, why a war opens at the defender's pole, supply derived from the front's displacement, winding down, the front map, and how wars are won.",
    content: occupationVictoryContent,
    category: "military",
    extraTags: ["occupation", "territory", "victory"],
    difficulty: "advanced",
    contentType: "mechanics",
    estimatedReadTime: 8,
  },
  {
    slug: "peace-and-truces",
    title: "Peace, Indemnities & Truces",
    description:
      "Bilateral peace offers, the 72-turn window, white peace, indemnities in the payer's currency, leaving a side, and the 240-turn truce that follows any war.",
    content: peaceAndTrucesContent,
    category: "military",
    extraTags: ["peace", "diplomacy", "truce"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "a-war-start-to-finish",
    title: "A War, Start to Finish",
    description:
      "A complete worked example: a hypothetical US-China war from peacetime buildup through the ratification vote, first contact, attrition, coalition and a negotiated peace.",
    content: warWalkthroughContent,
    category: "military",
    extraTags: ["walkthrough", "example", "war"],
    featured: true,
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 12,
  },
];
