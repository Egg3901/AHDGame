import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for the telecommunications lane. */
export const TELECOMMUNICATIONS_V3: V3LaneContent = {
  "1940": [
    {
      name: "Party Line Consolidation",
      description: "Consolidated party lines serve more subscribers per operator hour.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Operator Courtesy Campaigns",
      description: "A trained, courteous operator corps becomes the company's public face.",
      effects: [{ kind: "marketingStrength", flat: 14 }],
    },
    {
      name: "War Priority Circuits",
      description: "Guaranteed government circuits keep revenue protected in any market.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Crossbar Switch Rollout",
      description: "Crossbar exchanges connect more calls with far fewer operators.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "outputRate", commodity: "network_services", pct: 0.07 },
      ],
    },
    {
      name: "Nationwide Brand Campaigns",
      description: "A single national telephone brand supports premium subscriber rates.",
      effects: [
        { kind: "priceRealization", pct: 0.02 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Civil Defense Circuit Contracts",
      description: "Hardened civil defense networks lock in state business and cheap new routes.",
      effects: [
        { kind: "dominanceShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1950": [
    {
      name: "Direct Distance Dialing",
      description: "Customer-dialed long distance removes the operator from every toll call.",
      effects: [{ kind: "growthCostReduction", pct: 0.035 }],
    },
    {
      name: "Designer Handset Lines",
      description: "Colored and styled handsets turn the telephone into a premium purchase.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Rural Exchange Franchises",
      description: "Subsidized rural franchises add territory nobody else will serve.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Carrier System Upgrades",
      description: "Multichannel carrier gear pushes more calls through existing wire for less.",
      effects: [
        { kind: "outputRate", commodity: "network_services", pct: 0.08 },
        { kind: "inputCost", commodity: "electronics", pct: 0.1 },
      ],
    },
    {
      name: "Premium Business Services",
      description: "Dedicated business trunks and switchboards bill at the top of the tariff.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Statewide Franchise Locking",
      description:
        "Exclusive state franchises wall off territory and cheapen every buildout inside it.",
      effects: [
        { kind: "dominanceShield", pct: 0.17 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1960": [
    {
      name: "Pole Line Sharing Deals",
      description: "Shared pole and trench agreements cut outside plant construction bills.",
      effects: [{ kind: "inputCost", commodity: "construction_services", pct: 0.07 }],
    },
    {
      name: "Data Line Premiums",
      description: "Conditioned data circuits for computers bill far above voice rates.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Regulated Rate Base Growth",
      description: "Rate-of-return regulation turns every approved asset into protected earnings.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Analog-to-Electronic Cutover",
      description:
        "Electronic exchanges replace electromechanical banks and lift circuit capacity.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "outputRate", commodity: "network_services", pct: 0.07 },
      ],
    },
    {
      name: "Picturephone Showcases",
      description: "Futuristic service showcases sell the whole network as the premium choice.",
      effects: [
        { kind: "priceRealization", pct: 0.02 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Interstate Toll Corridors",
      description: "Owned long-haul corridors carry traffic across borders on your own terms.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1970": [
    {
      name: "Loop Electronics Deployment",
      description: "Loop carrier electronics serve more homes per pair and per dollar of gear.",
      effects: [{ kind: "inputCost", commodity: "electronics", pct: 0.07 }],
    },
    {
      name: "Custom Calling Features",
      description: "Call waiting and forwarding sell as add-ons on lines already built.",
      effects: [{ kind: "marketingStrength", flat: 15 }],
    },
    {
      name: "Regulatory Docket Teams",
      description: "Full-time docket teams defend tariffs and territory in every proceeding.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Digital Toll Switch Farms",
      description: "Digital toll centers move more minutes while trimming the power bill per call.",
      effects: [
        { kind: "outputRate", commodity: "network_services", pct: 0.08 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "Feature Package Upselling",
      description: "Bundled feature packages raise revenue per line without new plant.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Metro Duct Bank Expansion",
      description:
        "Oversized urban duct banks make the next decade of growth cheap and defensible.",
      effects: [
        { kind: "expansionDiscount", pct: 0.14 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1979": [
    {
      name: "Long-Haul Fiber Conversion",
      description: "Glass replaces copper on toll routes and slashes cost per circuit mile.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Business Data Packages",
      description: "Packaged corporate data services bill at premium contract rates.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Post-Divestiture Positioning",
      description: "Early restructuring around deregulation protects share as markets open.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Signaling System Upgrades",
      description:
        "Out-of-band signaling sets up calls faster and frees trunks for billable traffic.",
      effects: [
        { kind: "outputRate", commodity: "network_services", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "National Calling Card Brands",
      description: "Branded calling cards keep premium toll revenue loyal in a competitive market.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 27 },
      ],
    },
    {
      name: "Cellular License Land Grab",
      description: "Winning early cellular licenses stakes out whole metro markets at low cost.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1989": [
    {
      name: "Switch Software Consolidation",
      description: "One software load across switch models turns maintenance into a product line.",
      effects: [{ kind: "outputRate", commodity: "software", pct: 0.04 }],
    },
    {
      name: "Toll-Free Enterprise Sales",
      description: "Toll-free numbers make the network a sales channel enterprises pay up for.",
      effects: [{ kind: "marketingStrength", flat: 16 }],
    },
    {
      name: "Competitive Access Defense",
      description: "Aggressive win-back programs hold key accounts against bypass carriers.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Self-Healing Ring Networks",
      description:
        "Ring topologies reroute around cuts, selling uptime while cutting repair spend.",
      effects: [
        { kind: "outputRate", commodity: "network_services", pct: 0.09 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Bundled Long Distance Brands",
      description: "Branded calling plans bundle minutes and features at premium effective rates.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "International Gateway Licenses",
      description:
        "Owning the international gateways clears cross-border traffic of settlement pain.",
      effects: [
        { kind: "tariffShield", pct: 0.17 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1999": [
    {
      name: "DSLAM Colocation",
      description: "Packing DSL gear into existing exchanges avoids leasing new floor space.",
      effects: [{ kind: "inputCost", commodity: "real_estate_services", pct: 0.06 }],
    },
    {
      name: "Broadband Tiering",
      description: "Speed tiers let heavy users pay more on the same physical line.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Spectrum Auction War Chests",
      description: "Ready capital wins spectrum auctions that open whole new coverage maps.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Softswitch Migration",
      description:
        "Software-based switching replaces racks of hardware and the crews that tend them.",
      effects: [
        { kind: "outputRate", commodity: "software", pct: 0.07 },
        { kind: "laborCostReduction", pct: 0.07 },
      ],
    },
    {
      name: "Triple Play Bundles",
      description: "Voice, video, and internet on one bill raise revenue per home passed.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "National Backbone Peering",
      description: "Settlement-free peering at national scale locks in traffic and cheap reach.",
      effects: [
        { kind: "dominanceShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2009": [
    {
      name: "Tower Sharing Agreements",
      description: "Shared masts and rooftops cut the construction bill for each new cell.",
      effects: [{ kind: "inputCost", commodity: "construction_services", pct: 0.07 }],
    },
    {
      name: "Smartphone Exclusivity Deals",
      description: "Exclusive flagship handsets pull premium subscribers onto the network.",
      effects: [{ kind: "marketingStrength", flat: 18 }],
    },
    {
      name: "Net Neutrality Lobbying",
      description: "Sustained policy advocacy keeps the regulatory ground favorable.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Backhaul Fiber Overbuild",
      description: "Fiber to every cell site multiplies capacity and cuts radio gear churn.",
      effects: [
        { kind: "outputRate", commodity: "network_services", pct: 0.09 },
        { kind: "inputCost", commodity: "electronics", pct: 0.12 },
      ],
    },
    {
      name: "Unlimited Plan Branding",
      description: "Simple unlimited plans command premium loyalty in a confusing market.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marketingStrength", flat: 32 },
      ],
    },
    {
      name: "Cross-Border Carrier Alliances",
      description:
        "Alliance roaming and shared builds carry the brand into foreign markets cheaply.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2019": [
    {
      name: "Virtualized Core Rollout",
      description: "A software network core runs on commodity servers with a smaller ops team.",
      effects: [{ kind: "laborCostReduction", pct: 0.05 }],
    },
    {
      name: "Fixed Wireless Premiums",
      description: "Wireless home broadband sells premium speeds without trenching a street.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Vendor Diversification Mandates",
      description: "Multi-vendor sourcing rules keep gear flowing through trade disputes.",
      effects: [{ kind: "tariffShield", pct: 0.11 }],
    },
    {
      name: "Automated Network Operations",
      description: "Closed-loop automation runs the network with a fraction of the ops staff.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "outputRate", commodity: "network_services", pct: 0.08 },
      ],
    },
    {
      name: "Enterprise Edge Contracts",
      description: "On-premise edge deployments bill enterprises at premium managed-service rates.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Rural Buildout Subsidy Capture",
      description:
        "Subsidy programs fund expansion into territory rivals cannot afford to contest.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "2029": [
    {
      name: "AI Energy Load Balancing",
      description: "Machine-tuned radio sleep cycles cut the network's power bill.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.08 }],
    },
    {
      name: "Guaranteed Latency Tiers",
      description: "Contractual latency guarantees bill premium rates to demanding applications.",
      effects: [{ kind: "priceRealization", pct: 0.015 }],
    },
    {
      name: "Sovereign Network Requirements",
      description: "Trusted-carrier status under national rules shuts foreign rivals out.",
      effects: [{ kind: "dominanceShield", pct: 0.12 }],
    },
    {
      name: "Zero-Touch Provisioning",
      description: "Networks that configure themselves scale capacity without scaling headcount.",
      effects: [
        { kind: "laborCostReduction", pct: 0.1 },
        { kind: "outputRate", commodity: "network_services", pct: 0.09 },
      ],
    },
    {
      name: "Immersive Communications Premiums",
      description:
        "Holographic and immersive calling sells as the network's flagship premium tier.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "marketingStrength", flat: 35 },
      ],
    },
    {
      name: "Orbital-Terrestrial Mesh Licenses",
      description: "Combined satellite and ground licensing covers whole regions past any border.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.18 },
      ],
    },
  ],
};
