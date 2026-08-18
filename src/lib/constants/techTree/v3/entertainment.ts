import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for entertainment. Index 0-2 = specializations (Scale, Premium, Resilience); 3-5 = matching capstones. */
export const ENTERTAINMENT_V3: V3LaneContent = {
  "1940": [
    {
      name: "Back Lot Scheduling",
      description:
        "Tight stage and crew scheduling keeps every soundstage shooting through the war years.",
      effects: [
        { kind: "growthCostReduction", pct: 0.03 },
        { kind: "laborCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Marquee Billing Strategy",
      description:
        "Careful star billing and premiere staging lets theaters charge full price for every seat.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "War Bond Screenings",
      description:
        "Patriotic screenings and bond drives keep censors and regulators friendly to the studio.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Assembly Line Production",
      description:
        "B-picture units turn out finished features on fixed weekly quotas at minimal cost.",
      effects: [
        { kind: "growthCostReduction", pct: 0.05 },
        { kind: "outputRate", commodity: "entertainment_services", pct: 0.07 },
      ],
    },
    {
      name: "Prestige Picture Program",
      description:
        "A slate of award-chasing productions builds a brand that commands roadshow pricing.",
      effects: [
        { kind: "priceRealization", pct: 0.02 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Studio Charity Circuit",
      description:
        "Hospital tours and troop shows buy the studio durable goodwill in every capital.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1950": [
    {
      name: "Rerun Syndication Packages",
      description:
        "Selling the same filmed hours again and again spreads production cost across many buyers.",
      effects: [
        { kind: "growthCostReduction", pct: 0.03 },
        { kind: "outputRate", commodity: "advertising", pct: 0.04 },
      ],
    },
    {
      name: "Widescreen Spectacle",
      description:
        "CinemaScope epics give audiences something television cannot, justifying premium tickets.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Decency Code Compliance",
      description: "A clean in-house standards office keeps the censors out of the cutting room.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Telefilm Factory",
      description: "Purpose-built television units shoot a half-hour episode in three days flat.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "outputRate", commodity: "entertainment_services", pct: 0.08 },
      ],
    },
    {
      name: "Event Roadshow Releases",
      description:
        "Reserved-seat engagements with intermissions sell moviegoing as a night at the opera.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Overseas Market Offices",
      description:
        "Local distribution offices dubbed into every language open foreign box office cheaply.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "1960": [
    {
      name: "Runaway Production Units",
      description:
        "Shooting abroad where crews and locations cost less trims every picture's budget.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "growthCostReduction", pct: 0.02 },
      ],
    },
    {
      name: "Album Tie-In Releases",
      description:
        "Coordinated film, single, and album launches make each release sell the others.",
      effects: [
        { kind: "marketingStrength", flat: 15 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Ratings Board Seats",
      description:
        "Helping run the industry's own ratings body keeps government classification at bay.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Global Location Pipeline",
      description:
        "A standing network of foreign studios and tax deals makes every production a bargain.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Youth Culture Positioning",
      description:
        "Signing the acts teenagers actually follow puts the catalog at the center of the boom.",
      effects: [
        { kind: "marketingStrength", flat: 30 },
        { kind: "priceRealization", pct: 0.02 },
      ],
    },
    {
      name: "Multinational Co-Productions",
      description:
        "Treaty co-productions qualify as local content in every partner country at once.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1970": [
    {
      name: "Negative Cost Controls",
      description: "Line producers with real authority hold every picture to its approved budget.",
      effects: [
        { kind: "growthCostReduction", pct: 0.035 },
        { kind: "inputCost", commodity: "energy", pct: 0.05 },
      ],
    },
    {
      name: "Saturation TV Campaigns",
      description:
        "National television ad buys open a film everywhere at once at full ticket price.",
      effects: [
        { kind: "marketingStrength", flat: 18 },
        { kind: "priceRealization", pct: 0.01 },
      ],
    },
    {
      name: "Exhibitor Settlement Terms",
      description:
        "Negotiated splits and standing arbitration keep theater chain disputes out of court.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Wide Release Machine",
      description:
        "Thousands of simultaneous prints amortize marketing over a single massive weekend.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "outputRate", commodity: "entertainment_services", pct: 0.08 },
      ],
    },
    {
      name: "Summer Tentpole Slate",
      description:
        "The calendar is built around event films that own their release windows outright.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Diversified Leisure Holdings",
      description:
        "Parks, music, and publishing arms cushion the studio when any one business slumps.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1979": [
    {
      name: "Video Duplication Plants",
      description:
        "In-house cassette duplication turns the film library into cheap repeat inventory.",
      effects: [
        { kind: "growthCostReduction", pct: 0.03 },
        { kind: "inputCost", commodity: "electronics", pct: 0.06 },
      ],
    },
    {
      name: "Pay Cable Windows",
      description: "Exclusive premium cable windows extract a second full price from every title.",
      effects: [{ kind: "priceRealization", pct: 0.015 }],
    },
    {
      name: "Talent Guild Peace",
      description:
        "Long-term guild agreements keep the cameras rolling while rivals sit out strikes.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Library Exploitation Engine",
      description:
        "Every acquisition is mined across cassette, cable, and syndication with no new production spend.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "outputRate", commodity: "advertising", pct: 0.06 },
      ],
    },
    {
      name: "Brand Franchise Management",
      description: "Sequels, toys, and park rides are planned before the first film even opens.",
      effects: [
        { kind: "marketingStrength", flat: 32 },
        { kind: "priceRealization", pct: 0.02 },
      ],
    },
    {
      name: "Home Market Lobbying",
      description:
        "A standing government affairs office wins the copyright fights that protect the whole catalog.",
      effects: [
        { kind: "dominanceShield", pct: 0.2 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1989": [
    {
      name: "Nonlinear Edit Suites",
      description:
        "Digital editing bays cut post-production weeks out of every project's schedule.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "electronics", pct: 0.05 },
      ],
    },
    {
      name: "Sell-Through Video Pricing",
      description: "Family titles priced to own instead of rent multiply the revenue on every hit.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 10 },
      ],
    },
    {
      name: "Regional Content Quotas",
      description:
        "Local production subsidiaries satisfy content quotas in protected foreign markets.",
      effects: [{ kind: "tariffShield", pct: 0.12 }],
    },
    {
      name: "Digital Backlot",
      description:
        "Shared digital assets and effects pipelines make each production cheaper than the last.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "inputCost", commodity: "software", pct: 0.1 },
      ],
    },
    {
      name: "Global Premiere Events",
      description:
        "Simultaneous worldwide premieres turn each release into an international news story.",
      effects: [
        { kind: "marketingStrength", flat: 35 },
        { kind: "priceRealization", pct: 0.02 },
      ],
    },
    {
      name: "Media Conglomerate Shield",
      description:
        "Cross-owned networks, studios, and cable systems make the group too integrated to attack.",
      effects: [
        { kind: "dominanceShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1999": [
    {
      name: "Render Farm Consolidation",
      description:
        "Centralized render clusters serve every production overnight instead of per-studio rigs.",
      effects: [
        { kind: "inputCost", commodity: "software", pct: 0.06 },
        { kind: "growthCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Collector Edition Formats",
      description: "Special editions and box sets resell the same catalog at premium prices.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Anti-Piracy Task Force",
      description: "Watermarking and enforcement teams protect release windows from early leaks.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Digital Distribution Backbone",
      description:
        "File-based delivery to theaters and stores eliminates prints, shipping, and warehouses.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "outputRate", commodity: "entertainment_services", pct: 0.09 },
      ],
    },
    {
      name: "Event Franchise Universes",
      description:
        "Interlocking story universes make every release a mandatory ticket for the fan base.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Territory Rights Fortress",
      description:
        "Locked long-term output deals in every territory freeze rivals out of key markets.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2009": [
    {
      name: "Cloud Post-Production",
      description:
        "Editors, colorists, and mixers work on shared cloud projects instead of courier drives.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "software", pct: 0.05 },
      ],
    },
    {
      name: "Premium Format Screens",
      description: "Large-format and 3D engagements carry ticket surcharges audiences happily pay.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Platform Neutrality Deals",
      description:
        "Selling to every platform at once keeps any single distributor from dictating terms.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Data-Driven Greenlighting",
      description:
        "Viewing data decides what gets made, cutting the flop rate across the whole slate.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "laborCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Direct Fan Monetization",
      description:
        "Owned channels, memberships, and merch capture the full value of the loudest fans.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 34 },
      ],
    },
    {
      name: "Multi-Market Studio Network",
      description:
        "Production hubs on four continents chase incentives and dodge local content walls.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "2019": [
    {
      name: "Virtual Production Stages",
      description:
        "LED volume stages replace location shoots and cut travel and set construction spend.",
      effects: [
        { kind: "growthCostReduction", pct: 0.035 },
        { kind: "inputCost", commodity: "energy", pct: 0.05 },
      ],
    },
    {
      name: "Windowless Premium Releases",
      description:
        "Day-one premium home access sells the opening weekend to people who never left the couch.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Content Moderation Compact",
      description:
        "Proactive standards for interactive content keep legislators away from the platform.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Unified Content Pipeline",
      description:
        "One asset pipeline feeds film, series, and games so nothing is ever built twice.",
      effects: [
        { kind: "growthCostReduction", pct: 0.07 },
        { kind: "outputRate", commodity: "entertainment_services", pct: 0.08 },
      ],
    },
    {
      name: "Superfan Subscription Tiers",
      description:
        "Premium tiers with early access and live events convert fandom into recurring revenue.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Sovereign Content Partnerships",
      description:
        "Joint ventures with national broadcasters make the catalog local everywhere it plays.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.16 },
      ],
    },
  ],
  "2029": [
    {
      name: "AI Production Assistants",
      description:
        "Model-driven previsualization and scheduling squeeze idle days out of every shoot.",
      effects: [
        { kind: "laborCostReduction", pct: 0.05 },
        { kind: "inputCost", commodity: "software", pct: 0.06 },
      ],
    },
    {
      name: "Personalized Cut Delivery",
      description: "Viewers pay extra for versions tuned to their tastes, pacing, and language.",
      effects: [
        { kind: "priceRealization", pct: 0.015 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Synthetic Talent Rights Framework",
      description:
        "Clear consent and royalty rules for digital likenesses preempt the coming regulation wave.",
      effects: [{ kind: "dominanceShield", pct: 0.12 }],
    },
    {
      name: "Autonomous Content Factory",
      description:
        "Generative pipelines under editorial control produce finished episodes at software cost.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "outputRate", commodity: "entertainment_services", pct: 0.09 },
      ],
    },
    {
      name: "Immersive Premiere Venues",
      description:
        "Mixed-reality premiere experiences sell scarce live moments at unprecedented prices.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "marketingStrength", flat: 36 },
      ],
    },
    {
      name: "Planetary Rights Clearinghouse",
      description:
        "A single global licensing layer clears every territory and format in one negotiation.",
      effects: [
        { kind: "tariffShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.18 },
      ],
    },
  ],
};
