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
import { defenceProcurementContent } from "../content/defenceProcurement";
import { nuclearProgrammeContent } from "../content/nuclearProgramme";
import { coldWarTensionContent } from "../content/coldWarTension";
import { navalVesselClassesContent } from "../content/navalVesselClasses";
import { blockadesContent } from "../content/blockades";

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
    designDocUrl: "design/conflict-system-as-shipped.html",
  },
  {
    slug: "declaring-war",
    title: "Declaring War",
    description:
      "War is legislation: the two-thirds bill, war goals, who may file, the 120-turn cooldown, truces, treaty allies pulled in by mutual defence, joining an existing war, and opening forces.",
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
      "Domains, branches and era gating, unit costs and upkeep, plus defence contracts, committed appropriations, supplier pricing, equipment grades, and production lines.",
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
      "The control meter, why a war opens at the defender's pole, supply derived from the front's displacement, winding down, the front map, and what winning outright opens.",
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
      "Bilateral peace offers, the 72-turn window, the four terms (white peace, indemnity, regime change, demilitarisation), asking an enemy to leave, dictating terms after an outright win, and the 240-turn truce that follows any war.",
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
  {
    slug: "defence-procurement",
    title: "Defence Procurement",
    description:
      "How defence contracts turn the appropriation into materiel: quarterly contracting windows, the one-third supplier cap, the self-dealing disclosure and penalty, what it costs a minister to tear a contract up, and the per-turn spend cap that throttles delivery.",
    content: defenceProcurementContent,
    category: "military",
    extraTags: ["procurement", "contracts", "budget", "corruption", "termination"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 8,
  },
  {
    slug: "nuclear-programme",
    title: "The Nuclear Programme",
    description:
      "The bomb as a defence-seat project: entry gates, the device ladder and its public tests, delivery legs, production rates and warhead costs, the defence-budget funding path, and covert programmes.",
    content: nuclearProgrammeContent,
    category: "military",
    extraTags: ["nuclear", "coldwar", "doctrine", "budget"],
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 9,
  },
  {
    slug: "cold-war-tension",
    title: "Cold War Tension",
    description:
      "The world's shared 0 to 100 tension gauge: its five bands, what raises and lowers it, and how it drives readiness, procurement demand, and detente goodwill.",
    content: coldWarTensionContent,
    category: "military",
    extraTags: ["coldwar", "tension", "deterrence"],
    difficulty: "intermediate",
    contentType: "mechanics",
    estimatedReadTime: 6,
  },
  {
    slug: "naval-vessel-classes",
    title: "Naval Vessel Classes & Standing Orders",
    description:
      "The five hulls (carrier, destroyer, submarine, frigate, amphibious group), what each does at sea, berth costs and basing, the six naval postures and their readiness costs, default orders, surface actions, sea control, detection and repair.",
    content: navalVesselClassesContent,
    category: "military",
    extraTags: ["naval", "navy", "carrier", "submarine", "destroyer", "ships", "sea control"],
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 8,
    lastUpdated: "2026-09-05",
  },
  {
    slug: "blockades",
    title: "Blockades",
    description:
      "How a naval blockade is established, which water and postures count, how closure is measured against port defence, what it does to the target's trade, what it costs the blockader, and how it ends.",
    content: blockadesContent,
    category: "military",
    extraTags: ["naval", "blockade", "trade", "embargo", "war"],
    difficulty: "intermediate",
    contentType: "mechanics",
    estimatedReadTime: 7,
    lastUpdated: "2026-09-05",
  },
];
