import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for automobiles: entries (0-2) and capstones (3-5) per decade. */
export const AUTOMOBILES_V3: V3LaneContent = {
  "1940": [
    {
      name: "Arsenal Line Conversion",
      description: "Retooled war plants stamp vehicle bodies with fewer machine hours per unit.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Staff Car Contracts",
      description: "Officer staff car and ambulance orders carry better prices than basic trucks.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "War Production Board Standing",
      description: "Priority ratings from the board protect allocations against rival producers.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Continuous Shift Rotation",
      description:
        "Around-the-clock crews keep presses hot and spread fixed cost over more vehicles.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "outputRate", commodity: "vehicles", pct: 0.06 },
      ],
    },
    {
      name: "Command Car Prestige Lines",
      description: "Named badge programs for military brass build a brand that survives the peace.",
      effects: [
        { kind: "priceRealization", pct: 0.02 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Defense Plant Corporation Leases",
      description:
        "Government-financed plants let the firm expand capacity with little of its own capital.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1950": [
    {
      name: "Transfer Machining Lines",
      description: "Linked machining stations cut engine block handling and scrap.",
      effects: [
        { kind: "growthCostReduction", pct: 0.03 },
        { kind: "inputCost", commodity: "steel", pct: 0.06 },
      ],
    },
    {
      name: "Two-Tone Styling Studios",
      description: "Chrome and color studios sell the yearly restyle at a premium sticker.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Franchise Territory Locks",
      description: "Exclusive dealer territories keep competing marques out of home markets.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Automation Department",
      description:
        "A dedicated automation office mechanizes handling between presses across every plant.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Halo Convertible Program",
      description:
        "Flagship convertibles headline the showroom and lift prices across the whole range.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Greenfield Assembly Sites",
      description:
        "Purpose-built suburban plants open new regions at a fraction of retooling cost.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Thin-Gauge Stamping",
      description: "Better dies form body panels from lighter steel coil without losing strength.",
      effects: [{ kind: "inputCost", commodity: "steel", pct: 0.07 }],
    },
    {
      name: "Muscle Trim Premiums",
      description:
        "Performance badges and engine options carry sticker markups far above their cost.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Captive Import Agreements",
      description: "Rebadged partner imports fill small-car demand without ceding the segment.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Standardized Body Plants",
      description: "Common body shells across divisions let one press line feed several marques.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "outputRate", commodity: "vehicles", pct: 0.07 },
      ],
    },
    {
      name: "Grand Touring Image Campaigns",
      description: "Racing wins and touring campaigns turn the marque into a premium name.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Overseas Knock-Down Kits",
      description:
        "Kit assembly abroad clears import barriers and opens protected markets cheaply.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1970": [
    {
      name: "Powertrain Consolidation",
      description: "Fewer engine families shared across models cut tooling and parts count.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Luxury Brougham Packages",
      description:
        "Vinyl roofs, plush interiors and badges sell the same platform at a higher price.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Local Content Compliance",
      description:
        "Meeting domestic-content rules early keeps plants ahead of trade policy swings.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Plastic Component Substitution",
      description: "Molded bumpers, trim and tanks replace steel parts across the whole lineup.",
      effects: [
        { kind: "inputCost", commodity: "steel", pct: 0.12 },
        { kind: "inputCost", commodity: "plastics", pct: 0.1 },
      ],
    },
    {
      name: "Personal Luxury Coupes",
      description: "High-margin coupes built on sedan platforms become the most profitable line.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Transplant Negotiations",
      description: "Deals for foreign assembly sites lock in market access before quotas bite.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "1979": [
    {
      name: "Downsized Platforms",
      description: "Smaller shared platforms use less metal per car and fit the fuel-price era.",
      effects: [{ kind: "inputCost", commodity: "steel", pct: 0.07 }],
    },
    {
      name: "Diesel Economy Options",
      description: "Diesel variants command a premium from buyers fleeing gasoline prices.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Voluntary Quota Positioning",
      description: "Early quota compliance and lobbying shield volumes from import restraints.",
      effects: [{ kind: "tariffShield", pct: 0.12 }],
    },
    {
      name: "Kanban Supplier Discipline",
      description: "Pull-based delivery windows strip inventory and idle labor out of assembly.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "logisticsStrength", flat: 25 },
      ],
    },
    {
      name: "European Import Positioning",
      description:
        "Positioning against European sport sedans lifts the brand into a higher price class.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Joint Venture Plants",
      description:
        "Shared plants with foreign partners split capital cost and calm trade politics.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1989": [
    {
      name: "Flexible Body Shops",
      description: "Reprogrammable weld lines run several models down one line as demand shifts.",
      effects: [
        { kind: "growthCostReduction", pct: 0.03 },
        { kind: "laborCostReduction", pct: 0.04 },
      ],
    },
    {
      name: "Luxury Marque Launch",
      description: "A standalone premium channel sells engineering the volume brand cannot price.",
      effects: [{ kind: "priceRealization", pct: 0.015 }],
    },
    {
      name: "Regional Content Networks",
      description:
        "Supplier webs inside each trade bloc keep vehicles tariff-free where they sell.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Stamping Die Quick-Change",
      description: "Minutes-long die swaps let presses run small batches without cost penalty.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "outputRate", commodity: "vehicles", pct: 0.08 },
      ],
    },
    {
      name: "Dealership Experience Standards",
      description: "Uniform premium showrooms and service rituals justify list price everywhere.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Trade Bloc Assembly Grid",
      description: "One plant per major bloc makes the firm a local producer in every market.",
      effects: [
        { kind: "tariffShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1999": [
    {
      name: "Modular Supplier Sequencing",
      description: "Suppliers deliver pre-built modules in line order, shrinking assembly hours.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "logisticsStrength", flat: 12 },
      ],
    },
    {
      name: "SUV Premium Mix",
      description: "Truck-based utilities sell family space at margins sedans never reached.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marginBonus", pp: 1 },
      ],
    },
    {
      name: "Emerging Market Beachheads",
      description: "Early local plants in growth markets pre-empt rivals and import walls.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Global Purchasing Leverage",
      description: "Worldwide commodity contracts squeeze every supplier tier on price.",
      effects: [
        { kind: "inputCost", commodity: "steel", pct: 0.1 },
        { kind: "inputCost", commodity: "electronics", pct: 0.1 },
      ],
    },
    {
      name: "Crossover Segment Creation",
      description: "Car-based utilities define a new segment the firm prices before anyone else.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Full-Line Localization",
      description: "Complete local development and assembly in each region ends import exposure.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2009": [
    {
      name: "Platform Count Halving",
      description: "Cutting platforms in half spreads engineering cost over far more volume.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Premium Compact Push",
      description: "Upscale small cars carry luxury pricing into high-volume segments.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Restructuring War Chest",
      description: "A fortified balance sheet and plant flexibility ride out demand collapses.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Common Module Families",
      description: "Scalable module kits let one parts set build everything from compacts to SUVs.",
      effects: [
        { kind: "growthCostReduction", pct: 0.07 },
        { kind: "inputCost", commodity: "steel", pct: 0.1 },
      ],
    },
    {
      name: "Design Language Unification",
      description: "One recognizable face across the range makes every model advertise the rest.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Multi-Region Risk Spread",
      description:
        "Balanced capacity across regions means no single market slump can idle the firm.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "2019": [
    {
      name: "Battery Cost Curve Riding",
      description:
        "Locked-in cell contracts track falling pack prices straight into the bill of materials.",
      effects: [{ kind: "inputCost", commodity: "electronics", pct: 0.08 }],
    },
    {
      name: "Direct Sales Model",
      description: "Selling online at fixed prices keeps the dealer margin inside the company.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Chip Supply Insurance",
      description: "Long-term semiconductor commitments keep lines running through shortages.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Gigapress Body Casting",
      description:
        "Single-piece castings replace dozens of stamped parts and most of their welding labor.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Feature Subscription Revenue",
      description: "Paid software features turn every delivered vehicle into recurring income.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Battery Plant Partnerships",
      description:
        "Co-invested cell plants near assembly secure supply and subsidy in every region.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "2029": [
    {
      name: "Unboxed Assembly Process",
      description:
        "Parallel sub-assemblies replace the serial line and cut plant footprint per vehicle.",
      effects: [
        { kind: "growthCostReduction", pct: 0.04 },
        { kind: "laborCostReduction", pct: 0.04 },
      ],
    },
    {
      name: "Autonomy Premium Tiers",
      description:
        "Hands-off driving capability sells as the defining premium option of the decade.",
      effects: [{ kind: "priceRealization", pct: 0.015 }],
    },
    {
      name: "Fleet Operator Alliances",
      description:
        "Robotaxi and delivery fleet deals guarantee volume regardless of retail cycles.",
      effects: [{ kind: "dominanceShield", pct: 0.12 }],
    },
    {
      name: "Dark Factory Vehicle Lines",
      description: "Lights-out final assembly runs continuously with a skeleton oversight crew.",
      effects: [
        { kind: "laborCostReduction", pct: 0.1 },
        { kind: "outputRate", commodity: "vehicles", pct: 0.08 },
      ],
    },
    {
      name: "In-Cabin Experience Platform",
      description: "The interior becomes a paid living space, priced like consumer electronics.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Sovereign Mobility Contracts",
      description:
        "National fleet and infrastructure deals embed the firm in transport policy itself.",
      effects: [
        { kind: "dominanceShield", pct: 0.22 },
        { kind: "tariffShield", pct: 0.18 },
      ],
    },
  ],
};
