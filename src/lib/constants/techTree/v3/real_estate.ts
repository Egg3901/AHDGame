import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for real estate. */
export const REAL_ESTATE_V3: V3LaneContent = {
  "1940": [
    {
      name: "Standard Plan Repetition",
      description:
        "Building the same approved plans block after block cuts development cost per unit.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Defense Worker Housing Priority",
      description:
        "Priority allocations for war workers keep buildings full at controlled but reliable rents.",
      effects: [{ kind: "priceRealization", pct: 0.011 }],
    },
    {
      name: "Rent Board Relations",
      description:
        "Careful standing with wartime rent boards shields the portfolio from punitive rulings.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Materials Priority Certificates",
      description:
        "War board certificates secure scarce lumber and steel at official prices for every project.",
      effects: [
        { kind: "inputCost", commodity: "building_materials", pct: 0.12 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Federal Lease Guarantees",
      description:
        "Government master leases guarantee full occupancy at premium terms for the duration.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "outputRate", commodity: "real_estate_services", pct: 0.06 },
      ],
    },
    {
      name: "Wartime Land Assembly",
      description:
        "Assembling land near new defense plants positions the firm for cheap postwar expansion.",
      effects: [
        { kind: "expansionDiscount", pct: 0.14 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1950": [
    {
      name: "Assembly-Line Subdivisions",
      description:
        "Sequenced crews move house to house like a factory line, cutting build cost per lot.",
      effects: [{ kind: "growthCostReduction", pct: 0.035 }],
    },
    {
      name: "Model Home Showcases",
      description:
        "Furnished model homes and weekend showings sell units faster at full asking price.",
      effects: [
        { kind: "priceRealization", pct: 0.011 },
        { kind: "marketingStrength", flat: 10 },
      ],
    },
    {
      name: "Highway Interchange Options",
      description:
        "Optioning farmland at planned interchanges secures tomorrow's suburbs at today's prices.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Volume Builder Contracts",
      description:
        "Locked volume pricing on lumber and fixtures drops per-unit cost across whole subdivisions.",
      effects: [
        { kind: "inputCost", commodity: "building_materials", pct: 0.11 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Branded Community Development",
      description:
        "Named master communities with schools and parks sell an address, not just a house.",
      effects: [
        { kind: "priceRealization", pct: 0.023 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Metro Ring Land Banking",
      description:
        "A land bank ringing every growth city guarantees decades of cheap, entitled expansion.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Standardized Lease Forms",
      description:
        "Uniform leases and centralized files cut the back-office cost of every tenancy.",
      effects: [{ kind: "laborCostReduction", pct: 0.035 }],
    },
    {
      name: "Prestige Tower Addresses",
      description: "Flagship towers with named lobbies command the top of the office rent card.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Planning Commission Seats",
      description:
        "Relationships on planning boards steer zoning outcomes away from hostile surprises.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Regional Management Companies",
      description:
        "Consolidated regional managers run thousands of units with one lean overhead structure.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Corporate Headquarters Leasing",
      description:
        "Long headquarters leases with blue-chip tenants anchor rents at premium levels for decades.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "outputRate", commodity: "real_estate_services", pct: 0.06 },
      ],
    },
    {
      name: "Downtown Assemblage Rights",
      description:
        "Quietly assembled downtown blocks and air rights make the firm the only bidder that matters.",
      effects: [
        { kind: "dominanceShield", pct: 0.17 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1970": [
    {
      name: "Shared Utility Metering",
      description:
        "Master metering and off-peak contracts cut the energy bill across the whole portfolio.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.06 }],
    },
    {
      name: "Amenity Package Upselling",
      description: "Pools, clubs, and concierge tiers move rents above the neighborhood comp set.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Syndication Risk Sharing",
      description:
        "Limited partnerships spread project risk to outside investors while the firm keeps the fees.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Portfolio Energy Retrofits",
      description:
        "Insulation and controls across every building slash operating cost through the oil shocks.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.13 },
        { kind: "laborCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Trophy Asset Positioning",
      description:
        "A curated trophy portfolio attracts institutions that pay premium rents for the address.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 27 },
      ],
    },
    {
      name: "Sunbelt Migration Play",
      description:
        "Early positions across the booming Sunbelt buy growth markets before prices follow the people.",
      effects: [
        { kind: "expansionDiscount", pct: 0.17 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1979": [
    {
      name: "Workout Specialist Teams",
      description:
        "In-house workout teams restructure troubled assets before losses hit the ledger.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Inflation-Indexed Leases",
      description:
        "CPI escalators in every lease turn runaway inflation into automatic rent growth.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Tax Shelter Structuring",
      description:
        "Depreciation-driven structures keep investor capital flowing when interest rates bite.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Distressed Portfolio Rollups",
      description:
        "Buying overleveraged portfolios at deep discounts adds units for cents on the dollar.",
      effects: [
        { kind: "growthCostReduction", pct: 0.07 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
    {
      name: "Net Lease Conversions",
      description:
        "Shifting tenants to triple-net terms passes costs through and hardens effective rents.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "outputRate", commodity: "real_estate_services", pct: 0.06 },
      ],
    },
    {
      name: "Pension Fund Partnerships",
      description:
        "Pension capital partnerships fund expansion at scale no leveraged rival can match.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1989": [
    {
      name: "Centralized Call Centers",
      description:
        "One leasing and maintenance call center replaces front desks across the portfolio.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Class-A Repositioning",
      description:
        "Lobby, systems, and facade upgrades move tired buildings into the top rent tier.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "RTC Auction Discipline",
      description:
        "Disciplined bidding at resolution auctions builds holdings while regulators clear the wreckage.",
      effects: [{ kind: "expansionDiscount", pct: 0.1 }],
    },
    {
      name: "Shared Services Platform",
      description:
        "One national platform for leasing, billing, and maintenance strips overhead from every asset.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "National Landlord Brand",
      description:
        "A trusted national brand lets tenants pay more for a name they know in every city.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Public REIT Conversion",
      description:
        "Going public as a REIT opens permanent cheap capital and political cover for scale.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.17 },
      ],
    },
  ],
  "1999": [
    {
      name: "Web-Based Work Orders",
      description:
        "Online work orders route maintenance efficiently and cut administrative headcount.",
      effects: [{ kind: "laborCostReduction", pct: 0.035 }],
    },
    {
      name: "Broadband-Ready Buildings",
      description:
        "Wired buildings win tech tenants who pay up for connectivity others cannot offer.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Entitlement Pipeline Depth",
      description:
        "A deep pipeline of pre-entitled sites keeps growth cheap while rivals fight city hall.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Enterprise Property Systems",
      description:
        "A single enterprise system runs leasing, accounting, and facilities across the whole REIT.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Tech Corridor Portfolios",
      description:
        "Concentrated holdings in tech corridors ride the boom's rents to the top of the market.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Cross-Border Property Funds",
      description:
        "International funds carry the platform into foreign markets with local partners and cover.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "tariffShield", pct: 0.18 },
      ],
    },
  ],
  "2009": [
    {
      name: "Distressed Debt Desks",
      description:
        "Buying defaulted mortgage notes acquires buildings through the debt at crisis prices.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "LEED Certification Premiums",
      description:
        "Certified green buildings win corporate tenants with sustainability mandates and bigger budgets.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Foreclosure-to-Rental Pipelines",
      description:
        "Bulk foreclosure purchases convert into rental portfolios across entire metro areas.",
      effects: [{ kind: "expansionDiscount", pct: 0.1 }],
    },
    {
      name: "Institutional Single-Family Platform",
      description:
        "Purpose-built systems manage tens of thousands of scattered homes at apartment-level cost.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Energy Performance Contracts",
      description:
        "Guaranteed-savings retrofit contracts cut utility spend while premium tenants pay for green.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.12 },
        { kind: "priceRealization", pct: 0.02 },
      ],
    },
    {
      name: "Sovereign Wealth Joint Ventures",
      description:
        "Sovereign fund ventures buy landmark assets worldwide with patient, politically shielded capital.",
      effects: [
        { kind: "expansionDiscount", pct: 0.17 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "2019": [
    {
      name: "Self-Guided Tour Systems",
      description: "App-based lockbox tours let one leasing agent cover the workload of five.",
      effects: [{ kind: "laborCostReduction", pct: 0.045 }],
    },
    {
      name: "Amenity-as-a-Service Tiers",
      description: "Subscription amenity tiers layer recurring premium revenue onto base rents.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 11 },
      ],
    },
    {
      name: "Opportunity Zone Structuring",
      description:
        "Tax-advantaged zone structures make marginal expansion projects pencil at low cost.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Centralized Operations Hubs",
      description:
        "Remote hubs run leasing, screening, and maintenance dispatch for entire regions at once.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Dynamic Rent Optimization",
      description:
        "Daily repricing against live demand keeps every unit at the top of what the market bears.",
      effects: [
        { kind: "priceRealization", pct: 0.027 },
        { kind: "outputRate", commodity: "real_estate_services", pct: 0.06 },
      ],
    },
    {
      name: "Housing Policy Coalitions",
      description:
        "Funding pro-supply coalitions keeps zoning fights and rent politics from touching the portfolio.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "2029": [
    {
      name: "Robotic Facility Crews",
      description:
        "Cleaning and inspection robots hold service standards with a fraction of the crew.",
      effects: [{ kind: "laborCostReduction", pct: 0.05 }],
    },
    {
      name: "Wellness-Certified Space",
      description:
        "Air, light, and acoustic certification puts space at the top of corporate leasing lists.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Climate Resilience Ratings",
      description:
        "Flood-proofed, grid-independent assets pass tightening climate rules that strand rivals.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Autonomous Portfolio Management",
      description:
        "AI systems run pricing, maintenance, and renewals portfolio-wide with minimal staff.",
      effects: [
        { kind: "laborCostReduction", pct: 0.1 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Adaptive Space Marketplaces",
      description:
        "Buildings that reconfigure by the hour sell the same square feet several times a day.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "real_estate_services", pct: 0.07 },
      ],
    },
    {
      name: "Megaproject Public Partnerships",
      description:
        "City-scale public partnerships hand the firm entire districts to build and operate.",
      effects: [
        { kind: "expansionDiscount", pct: 0.19 },
        { kind: "dominanceShield", pct: 0.18 },
      ],
    },
  ],
};
