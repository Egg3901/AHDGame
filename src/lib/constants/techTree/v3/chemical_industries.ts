import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for chemical industries. */
export const CHEMICAL_INDUSTRIES_V3: V3LaneContent = {
  "1940": [
    {
      name: "Feedstock Rationing Boards",
      description: "Allocation boards squeeze more product out of every rationed barrel of oil.",
      effects: [{ kind: "inputCost", commodity: "oil", pct: 0.06 }],
    },
    {
      name: "Military Specification Grades",
      description:
        "Meeting strict military purity specs lets plants charge premium contract prices.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "War Production Board Liaison",
      description: "A standing liaison office keeps regulators friendly and contracts flowing.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Synthetic Rubber Program",
      description:
        "Government-backed synthetic rubber lines cut crude dependence and lift plastics output.",
      effects: [
        { kind: "inputCost", commodity: "oil", pct: 0.12 },
        { kind: "outputRate", commodity: "plastics", pct: 0.07 },
      ],
    },
    {
      name: "Arsenal Grade Certification",
      description: "Certified arsenal-grade output commands top prices across all chemical lines.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "outputRate", commodity: "chemicals", pct: 0.06 },
      ],
    },
    {
      name: "Strategic Materials Status",
      description:
        "Designation as a strategic producer shields the firm from tariffs and trustbusters alike.",
      effects: [
        { kind: "dominanceShield", pct: 0.16 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1950": [
    {
      name: "Refinery Co-Location",
      description: "Building plants beside refineries cuts feedstock haulage and energy losses.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.06 },
        { kind: "logisticsStrength", flat: 12 },
      ],
    },
    {
      name: "Branded Consumer Resins",
      description: "Trademarked resin brands let commodity plastics sell at branded prices.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Plant Community Relations",
      description: "Town halls and local hiring keep siting permits and expansions moving.",
      effects: [{ kind: "expansionDiscount", pct: 0.07 }],
    },
    {
      name: "Integrated Petrochemical Complex",
      description: "A single integrated complex turns one crude stream into a dozen product lines.",
      effects: [
        { kind: "inputCost", commodity: "oil", pct: 0.12 },
        { kind: "outputRate", commodity: "chemicals", pct: 0.07 },
      ],
    },
    {
      name: "Miracle Fiber Campaigns",
      description: "National campaigns for nylon-age fibers pull the whole portfolio upmarket.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Interstate Plant Network",
      description: "A coast-to-coast plant footprint spreads regulatory and trade risk thin.",
      effects: [
        { kind: "expansionDiscount", pct: 0.14 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Turnaround Scheduling",
      description: "Planned maintenance turnarounds keep reactors running more days per year.",
      effects: [
        { kind: "growthCostReduction", pct: 0.03 },
        { kind: "outputRate", commodity: "chemicals", pct: 0.03 },
      ],
    },
    {
      name: "Technical Sales Force",
      description: "Chemists in the sales force sell formulations, not tonnage, at better prices.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Overseas Licensing Deals",
      description: "Licensing processes to foreign partners opens markets without tariff exposure.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "World-Scale Crackers",
      description:
        "Giant single-train crackers drive unit costs below anything smaller rivals can match.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "Application Engineering Teams",
      description: "Engineers embedded with customers lock in premium pricing on tailored grades.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Multinational Production Web",
      description:
        "Plants inside every major trade bloc make tariffs and antitrust suits toothless.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1970": [
    {
      name: "Oil Shock Feedstock Hedging",
      description: "Long-term supply contracts blunt the price shocks hitting crude feedstock.",
      effects: [{ kind: "inputCost", commodity: "oil", pct: 0.08 }],
    },
    {
      name: "Performance Additive Lines",
      description:
        "High-margin additives for fuels and lubricants ride out commodity price swings.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marginBonus", pp: 0.6 },
      ],
    },
    {
      name: "Regulatory Affairs Department",
      description: "A dedicated department turns new EPA and OSHA rules from threats into moats.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Energy Recovery Retrofit",
      description:
        "Waste-heat recovery across every unit cuts the energy bill that inflation doubled.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.13 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Fine Chemicals Pivot",
      description:
        "Shifting capacity into fine chemicals and drug intermediates lifts realized prices sharply.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "outputRate", commodity: "pharmaceuticals", pct: 0.06 },
      ],
    },
    {
      name: "Responsible Operations Compact",
      description:
        "An industry-leading safety and environment record keeps regulators and juries at bay.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1979": [
    {
      name: "Debottlenecking Programs",
      description: "Targeted fixes to choke points add capacity without pouring new concrete.",
      effects: [
        { kind: "growthCostReduction", pct: 0.04 },
        { kind: "outputRate", commodity: "chemicals", pct: 0.04 },
      ],
    },
    {
      name: "Electronic Grade Purity",
      description: "Ultra-pure grades for the semiconductor boom sell at multiples of bulk prices.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Superfund Readiness Audits",
      description:
        "Cleaning up legacy sites before the lawyers arrive protects margins and permits.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Computer-Optimized Units",
      description:
        "Minicomputer control of reactors trims energy and feedstock waste around the clock.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.11 },
        { kind: "laborCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Specialty Portfolio Restructuring",
      description:
        "Divesting bulk lines for specialty businesses resets the whole margin structure.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "outputRate", commodity: "chemicals", pct: 0.06 },
      ],
    },
    {
      name: "Global Toll Manufacturing",
      description: "Toll deals with plants worldwide dodge tariffs and spread expansion cost.",
      effects: [
        { kind: "tariffShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1989": [
    {
      name: "Statistical Process Control",
      description: "Control charts on every line cut off-spec batches and reprocessing waste.",
      effects: [
        { kind: "inputCost", commodity: "chemicals", pct: 0.06 },
        { kind: "laborCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Customer Grade Programs",
      description:
        "Grades certified against each customer's process win pricing power and loyalty.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Emissions Trading Desk",
      description: "Buying and banking emissions credits turns compliance into a traded position.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Site-Wide Automation",
      description: "Plant-wide distributed control slashes operator headcount and utility draw.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "Life Science Ventures",
      description:
        "Biotech joint ventures push the portfolio into drug ingredients with premium pricing.",
      effects: [
        { kind: "outputRate", commodity: "pharmaceuticals", pct: 0.07 },
        { kind: "priceRealization", pct: 0.022 },
      ],
    },
    {
      name: "Free Trade Zone Plants",
      description: "Plants sited in free trade zones make border taxes largely irrelevant.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1999": [
    {
      name: "ERP Supply Integration",
      description:
        "One enterprise system ties orders to reactors, cutting inventory and freight waste.",
      effects: [
        { kind: "inputCost", commodity: "freight", pct: 0.06 },
        { kind: "logisticsStrength", flat: 14 },
      ],
    },
    {
      name: "Formulation Patents Portfolio",
      description: "A thick patent wall around formulations keeps premium grades premium.",
      effects: [
        { kind: "priceRealization", pct: 0.014 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "REACH Compliance Head Start",
      description:
        "Registering substances ahead of global rules turns red tape into a barrier for rivals.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Six Sigma Chemical Operations",
      description: "Defect-hunting programs across every site take structural cost out for good.",
      effects: [
        { kind: "growthCostReduction", pct: 0.07 },
        { kind: "laborCostReduction", pct: 0.07 },
      ],
    },
    {
      name: "Custom Synthesis Franchise",
      description:
        "Exclusive synthesis contracts with drugmakers deliver the richest prices in the industry.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "pharmaceuticals", pct: 0.06 },
      ],
    },
    {
      name: "Verbund Global Network",
      description:
        "Interlinked mega-sites on three continents shrug off tariffs and expansion costs.",
      effects: [
        { kind: "tariffShield", pct: 0.17 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2009": [
    {
      name: "Shale Gas Feedstock Switch",
      description: "Switching crackers to cheap shale-derived feedstock resets the cost curve.",
      effects: [{ kind: "inputCost", commodity: "oil", pct: 0.08 }],
    },
    {
      name: "Green Premium Lines",
      description: "Bio-based and recycled-content grades earn a visible price premium.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 14 },
      ],
    },
    {
      name: "Carbon Disclosure Leadership",
      description: "Leading on emissions reporting buys goodwill with regulators and investors.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Advanced Process Analytics",
      description: "Sensor data and modeling squeeze reactors closer to theoretical yield.",
      effects: [
        { kind: "inputCost", commodity: "chemicals", pct: 0.11 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "High-Performance Materials Suite",
      description: "Aerospace and electronics materials sell on performance, not on price sheets.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "outputRate", commodity: "plastics", pct: 0.07 },
      ],
    },
    {
      name: "Regional Supply Resilience",
      description: "Duplicated regional supply chains absorb trade wars without missing shipments.",
      effects: [
        { kind: "tariffShield", pct: 0.19 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "2019": [
    {
      name: "Predictive Maintenance Fleet",
      description: "Vibration and thermal sensors call maintenance before pumps fail, not after.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "growthCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Certified Circular Content",
      description:
        "Third-party certified recycled content lets brands pay up for the same polymer.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Plastics Treaty Seat",
      description: "A seat at global plastics negotiations shapes rules the firm can already meet.",
      effects: [{ kind: "dominanceShield", pct: 0.12 }],
    },
    {
      name: "Electrified Cracking Pilots",
      description: "Electric furnace crackers cut fuel burn and decouple costs from oil markets.",
      effects: [
        { kind: "inputCost", commodity: "oil", pct: 0.13 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "Battery Materials Franchise",
      description: "Electrolytes and cathode precursors ride the battery boom at premium prices.",
      effects: [
        { kind: "priceRealization", pct: 0.027 },
        { kind: "outputRate", commodity: "chemicals", pct: 0.07 },
      ],
    },
    {
      name: "Friendshored Plant Portfolio",
      description:
        "Capacity placed inside allied blocs keeps product flowing through any trade rupture.",
      effects: [
        { kind: "tariffShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2029": [
    {
      name: "Autonomous Plant Operations",
      description: "Self-tuning control systems run routine operations with skeleton crews.",
      effects: [
        { kind: "laborCostReduction", pct: 0.05 },
        { kind: "inputCost", commodity: "energy", pct: 0.06 },
      ],
    },
    {
      name: "Molecule-as-a-Service Contracts",
      description:
        "Outcome-priced supply contracts sell guaranteed performance instead of tonnage.",
      effects: [
        { kind: "priceRealization", pct: 0.015 },
        { kind: "marginBonus", pp: 0.6 },
      ],
    },
    {
      name: "Carbon Border Credential",
      description: "Verified low-carbon production passes border carbon taxes untouched.",
      effects: [{ kind: "tariffShield", pct: 0.12 }],
    },
    {
      name: "Closed-Loop Feedstock Cycle",
      description:
        "Depolymerization loops feed old plastic back into crackers, shrinking virgin feed buys.",
      effects: [
        { kind: "inputCost", commodity: "oil", pct: 0.14 },
        { kind: "outputRate", commodity: "plastics", pct: 0.08 },
      ],
    },
    {
      name: "Generative Molecule Design",
      description:
        "Model-designed molecules reach markets first and price like patents, not commodities.",
      effects: [
        { kind: "priceRealization", pct: 0.029 },
        { kind: "outputRate", commodity: "pharmaceuticals", pct: 0.07 },
      ],
    },
    {
      name: "Sovereign Supply Charters",
      description:
        "Supply charters with governments guarantee market access whatever politics does.",
      effects: [
        { kind: "dominanceShield", pct: 0.22 },
        { kind: "tariffShield", pct: 0.18 },
      ],
    },
  ],
};
