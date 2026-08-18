import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for construction. */
export const CONSTRUCTION_V3: V3LaneContent = {
  "1940": [
    {
      name: "Round-the-Clock Crews",
      description:
        "Three-shift scheduling on war contracts spreads equipment cost over every hour of the day.",
      effects: [{ kind: "laborCostReduction", pct: 0.035 }],
    },
    {
      name: "Cost-Plus Contract Mastery",
      description:
        "Meticulous cost documentation on cost-plus war work captures every allowable dollar.",
      effects: [{ kind: "priceRealization", pct: 0.011 }],
    },
    {
      name: "War Production Board Standing",
      description:
        "Good standing with the production board keeps allocations flowing and audits friendly.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Standardized Base Construction",
      description:
        "Repeating one base layout hundreds of times drives cost per building to record lows.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "inputCost", commodity: "building_materials", pct: 0.1 },
      ],
    },
    {
      name: "Priority Defense Contracts",
      description:
        "Negotiated priority contracts pay premium rates for guaranteed wartime delivery.",
      effects: [
        { kind: "priceRealization", pct: 0.021 },
        { kind: "outputRate", commodity: "construction_services", pct: 0.06 },
      ],
    },
    {
      name: "Theater Construction Battalions",
      description:
        "Organized mobile divisions follow military work into any region at minimal setup cost.",
      effects: [
        { kind: "expansionDiscount", pct: 0.14 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1950": [
    {
      name: "Owned Aggregate Pits",
      description:
        "Company gravel pits and batch supply cut purchased material cost on every pour.",
      effects: [{ kind: "inputCost", commodity: "building_materials", pct: 0.07 }],
    },
    {
      name: "Negotiated Work Reputation",
      description:
        "A reputation for schedule certainty wins negotiated contracts above hard-bid margins.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Interstate Program Prequalification",
      description:
        "Early federal highway prequalification opens a decade of public work in new states.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Vertically Integrated Materials",
      description:
        "Owning quarries, batch plants, and trucking keeps material margin inside the company.",
      effects: [
        { kind: "inputCost", commodity: "building_materials", pct: 0.13 },
        { kind: "inputCost", commodity: "steel", pct: 0.1 },
      ],
    },
    {
      name: "Design-Bid Package Deals",
      description:
        "Bundling design and construction sells owners certainty at premium contract values.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Multi-State License Network",
      description:
        "Licenses, bonding, and yards in a dozen states let crews chase work anywhere cheaply.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Gang Form Cycling",
      description:
        "Crane-set gang forms cycle floor to floor in days, cutting labor hours per story.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Landmark Project Portfolio",
      description: "Signature towers and stadiums let the firm charge for reputation on every bid.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marketingStrength", flat: 10 },
      ],
    },
    {
      name: "Public Works Relationships",
      description:
        "Long relationships with public agencies keep bid protests and probes at arm's length.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Systems Building Methods",
      description:
        "Factory-cast floors and cores erected by crane cut both labor and site materials waste.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "inputCost", commodity: "building_materials", pct: 0.1 },
      ],
    },
    {
      name: "Turnkey Development Services",
      description:
        "Delivering land, finance, and building as one package commands developer-level fees.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "outputRate", commodity: "construction_services", pct: 0.07 },
      ],
    },
    {
      name: "International Airport Contracts",
      description:
        "Airport and port megaprojects abroad establish beachheads that bypass import politics.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1970": [
    {
      name: "Fuel-Hedged Fleet Operations",
      description:
        "Fuel contracts and efficient equipment blunt the oil shock on every earthmoving job.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.07 }],
    },
    {
      name: "Fast-Track Delivery Premiums",
      description:
        "Overlapping design and construction delivers months early for owners who pay for speed.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Environmental Review Navigation",
      description:
        "In-house permitting specialists carry projects through the new review gauntlet unscathed.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Petrodollar Megaproject Logistics",
      description:
        "Self-contained camps and supply chains execute giant projects with lean imported labor.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "logisticsStrength", flat: 30 },
      ],
    },
    {
      name: "Program Management Fees",
      description:
        "Managing entire capital programs earns professional fees on billions the firm never builds.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Middle East Joint Ventures",
      description:
        "Local partners and sovereign clients open the era's largest markets on protected terms.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1979": [
    {
      name: "Merit Shop Operations",
      description:
        "Open-shop crews with performance pay cut labor cost on private work without losing craft.",
      effects: [{ kind: "laborCostReduction", pct: 0.045 }],
    },
    {
      name: "Interior Fit-Out Specialization",
      description:
        "High-margin corporate interiors work rides the office boom while heavy work stalls.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Claims Avoidance Culture",
      description:
        "Documented changes and clean closeouts keep the firm out of the era's litigation wave.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Lean Overhead Restructuring",
      description:
        "Cutting layers between the field and the office keeps bids sharp through the downturn.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Guaranteed Maximum Price Expertise",
      description:
        "GMP contracts with shared savings win premium work from owners burned by overruns.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "outputRate", commodity: "construction_services", pct: 0.06 },
      ],
    },
    {
      name: "Public Infrastructure Coalitions",
      description:
        "Coalition lobbying for infrastructure spending builds a protected public work pipeline.",
      effects: [
        { kind: "dominanceShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1989": [
    {
      name: "Estimating Database Reuse",
      description: "Historical cost databases produce sharper bids in hours instead of weeks.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Preconstruction Services Fees",
      description:
        "Paid preconstruction work converts estimating from overhead into billable expertise.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Surety Relationship Depth",
      description:
        "Deep bonding capacity lets the firm chase jobs whose size alone excludes competitors.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "National Purchasing Agreements",
      description:
        "Company-wide steel and materials agreements price every project like the largest one.",
      effects: [
        { kind: "inputCost", commodity: "steel", pct: 0.12 },
        { kind: "inputCost", commodity: "building_materials", pct: 0.11 },
      ],
    },
    {
      name: "Design-Build Market Leadership",
      description:
        "Single-contract delivery at scale wins premium work owners will not bid conventionally.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Privatization Concession Bids",
      description:
        "Build-operate-transfer concessions turn one-time projects into decades of protected revenue.",
      effects: [
        { kind: "dominanceShield", pct: 0.17 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "1999": [
    {
      name: "Project Extranet Collaboration",
      description: "Shared web workspaces cut RFI turnaround and the paper staff behind it.",
      effects: [{ kind: "laborCostReduction", pct: 0.035 }],
    },
    {
      name: "Data Center Build Expertise",
      description:
        "Specialized mission-critical delivery earns technology clients' premium budgets.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Public-Private Partnership Desks",
      description:
        "P3 structuring expertise opens infrastructure markets closed to conventional bidders.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Integrated Project Controls",
      description:
        "Live cost and schedule data across every job stops overruns while they are still small.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "laborCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Negotiated National Accounts",
      description:
        "Repeat-build agreements with national chains deliver premium fee work in every region.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "outputRate", commodity: "construction_services", pct: 0.07 },
      ],
    },
    {
      name: "Global Delivery Platform",
      description:
        "Offices, partners, and bonding on four continents chase work wherever margins run highest.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "tariffShield", pct: 0.17 },
      ],
    },
  ],
  "2009": [
    {
      name: "Model-Based Quantity Takeoff",
      description:
        "Quantities pulled straight from the building model cut estimating cost and bid error.",
      effects: [{ kind: "growthCostReduction", pct: 0.035 }],
    },
    {
      name: "Stimulus-Ready Shovel Work",
      description: "Pre-permitted projects capture stimulus funding at healthy negotiated margins.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Countercyclical Sector Mix",
      description:
        "A balanced book of public, health, and energy work rides out the private crash.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Multi-Trade Prefabrication Shops",
      description:
        "Racked mechanical and electrical assemblies built indoors cut field labor and rework.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "inputCost", commodity: "building_materials", pct: 0.1 },
      ],
    },
    {
      name: "Integrated Project Delivery Contracts",
      description:
        "Shared-risk IPD agreements with repeat owners lock in premium fees and zero-claim projects.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 27 },
      ],
    },
    {
      name: "Infrastructure Fund Alliances",
      description:
        "Alliances with infrastructure funds bring patient capital that carries the firm into new markets.",
      effects: [
        { kind: "expansionDiscount", pct: 0.17 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "2019": [
    {
      name: "Telematics Fuel Management",
      description:
        "Idle-time alerts and auto-shutdown across the fleet cut fuel burn on every site.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.06 }],
    },
    {
      name: "Mission-Critical Frameworks",
      description:
        "Framework agreements with hyperscale clients pay premium rates for guaranteed capacity.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Workforce Development Pipelines",
      description:
        "Company trade academies secure scarce craft labor and goodwill with local politicians.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Robotic Layout and Rebar",
      description:
        "Layout robots and tying machines take the slowest crafts off the critical path.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Digital Twin Handover Services",
      description:
        "Delivering a living digital twin with the keys earns fees long after substantial completion.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "outputRate", commodity: "construction_services", pct: 0.07 },
      ],
    },
    {
      name: "Megaproject Consortium Leadership",
      description:
        "Leading multinational consortia puts the firm atop the world's largest protected contracts.",
      effects: [
        { kind: "tariffShield", pct: 0.19 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "2029": [
    {
      name: "Autonomous Earthworks",
      description:
        "Self-operating dozers and excavators grade sites around the clock without operators.",
      effects: [{ kind: "laborCostReduction", pct: 0.05 }],
    },
    {
      name: "Net-Zero Delivery Guarantees",
      description:
        "Guaranteed carbon-neutral delivery wins mandates that exclude conventional builders.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Embodied Carbon Compliance",
      description:
        "Verified low-carbon supply chains clear tightening material rules that stall competitors.",
      effects: [{ kind: "tariffShield", pct: 0.11 }],
    },
    {
      name: "Lights-Out Component Factories",
      description:
        "Automated factories print and assemble building components with almost no direct labor.",
      effects: [
        { kind: "laborCostReduction", pct: 0.1 },
        { kind: "inputCost", commodity: "building_materials", pct: 0.11 },
      ],
    },
    {
      name: "Outcome-Based Building Contracts",
      description:
        "Contracts priced on delivered energy and uptime outcomes carry fees far above cost-plus.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "construction_services", pct: 0.08 },
      ],
    },
    {
      name: "National Resilience Programs",
      description:
        "Standing contracts to harden grids, coasts, and cities make the firm a strategic asset.",
      effects: [
        { kind: "dominanceShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.16 },
      ],
    },
  ],
};
