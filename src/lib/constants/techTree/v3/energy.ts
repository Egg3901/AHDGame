import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for energy: entries (0-2) and capstones (3-5) per decade. */
export const ENERGY_V3: V3LaneContent = {
  "1940": [
    {
      name: "Boiler Efficiency Drives",
      description: "Tuned combustion and feedwater heating cut coal burned per kilowatt.",
      effects: [{ kind: "inputCost", commodity: "coal", pct: 0.07 }],
    },
    {
      name: "Industrial Priority Rates",
      description: "War-plant supply contracts pay premium rates for guaranteed power.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Utility Commission Standing",
      description: "Good regulator relationships secure the franchise against rival utilities.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Central Dispatch Offices",
      description: "One dispatch desk runs every plant in merit order, wasting no expensive fuel.",
      effects: [
        { kind: "inputCost", commodity: "coal", pct: 0.11 },
        { kind: "laborCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Victory Power Campaigns",
      description: "Patriotic electrification drives sign up whole towns at favorable tariffs.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Federal Power Project Roles",
      description:
        "Operating contracts on government dams and lines expand reach at public expense.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1950": [
    {
      name: "Larger Generating Units",
      description: "Bigger turbine sets deliver more output per ton of plant steel.",
      effects: [{ kind: "outputRate", commodity: "energy", pct: 0.04 }],
    },
    {
      name: "All-Electric Home Promotion",
      description: "Appliance-era marketing sells rising household loads at healthy rates.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Franchise Territory Defense",
      description: "Long-term municipal franchises lock competitors out of the service area.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Supercritical Steam Plants",
      description: "Higher pressure cycles extract far more electricity from every coal delivery.",
      effects: [
        { kind: "inputCost", commodity: "coal", pct: 0.12 },
        { kind: "outputRate", commodity: "energy", pct: 0.07 },
      ],
    },
    {
      name: "Live Better Electrically",
      description:
        "A national lifestyle campaign makes the utility a household brand with pricing power.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Holding Company Structure",
      description: "A multi-state holding structure finances new territories on favorable terms.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Mine-Mouth Generation",
      description: "Plants built at the coal seam skip the freight bill on every ton burned.",
      effects: [{ kind: "inputCost", commodity: "coal", pct: 0.08 }],
    },
    {
      name: "Firm Power Contracts",
      description: "Guaranteed-delivery contracts with industry price above interruptible supply.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Interutility Power Pools",
      description: "Pooled reserves with neighbors ride through outages that sink lone utilities.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Extra-High-Voltage Backbone",
      description: "765 kV lines move cheap remote generation to load centers with minimal losses.",
      effects: [
        { kind: "logisticsStrength", flat: 30 },
        { kind: "outputRate", commodity: "energy", pct: 0.06 },
      ],
    },
    {
      name: "Regional Rate Leadership",
      description:
        "The lowest headline rates in the region attract industry that pays for the system.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Interstate Transmission Rights",
      description: "Secured corridor rights let the firm build into neighboring states first.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "1970": [
    {
      name: "Heat Rate Programs",
      description: "Plant-by-plant efficiency targets cut fuel burned per unit generated.",
      effects: [{ kind: "inputCost", commodity: "oil", pct: 0.07 }],
    },
    {
      name: "Time-of-Day Pricing",
      description: "Peak-priced tariffs bill power at what it actually costs to make.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Fuel Diversity Hedging",
      description: "A mixed coal, gas and nuclear fleet blunts any single fuel shock.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Coal Conversion Program",
      description: "Oil-fired units rebuilt for domestic coal escape imported fuel entirely.",
      effects: [
        { kind: "inputCost", commodity: "oil", pct: 0.13 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Interruptible Rate Ladders",
      description: "Layered firm and interruptible tariffs sell the same plant twice over.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Crisis-Era Siting Wins",
      description: "Permits banked during the energy crisis let new plants rise while rivals wait.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "1979": [
    {
      name: "Plant Availability Engineering",
      description: "Predictive maintenance keeps units on line more hours per year.",
      effects: [{ kind: "outputRate", commodity: "energy", pct: 0.05 }],
    },
    {
      name: "Qualifying Facility Sales",
      description: "Selling cogenerated power under new law earns rates set by avoided cost.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Rate Case Mastery",
      description: "Winning rate cases quickly keeps returns whole through inflationary years.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Fleet Standardization",
      description: "Identical units and shared spares cut outage time and crew cost fleet-wide.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "outputRate", commodity: "energy", pct: 0.07 },
      ],
    },
    {
      name: "Conservation Service Brands",
      description: "Paid audits and efficiency services turn the meter into a trusted advisor.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Independent Power Ventures",
      description:
        "Unregulated generation subsidiaries build merchant plants outside the home turf.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1989": [
    {
      name: "Gas Turbine Repowering",
      description: "Old steam sites repowered with gas turbines revive capacity at low cost.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Green Pricing Pilots",
      description: "Early clean-power tariffs find customers who will pay extra by choice.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Acid Rain Allowance Bank",
      description: "Banked emission allowances become a tradable cushion against tightening caps.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Merchant Plant Cost Model",
      description:
        "Lean staffing and standard designs build competitive plants at record low cost.",
      effects: [
        { kind: "growthCostReduction", pct: 0.07 },
        { kind: "laborCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Wholesale Trading Desks",
      description:
        "A trading floor prices every megawatt against the open market, not the tariff book.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Privatization Bidding Teams",
      description: "Standing acquisition teams buy newly privatized utilities around the world.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "1999": [
    {
      name: "Combined-Cycle Fleet Buildout",
      description: "Standard gas plants replicated site to site cut cost per new megawatt.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Retail Choice Branding",
      description: "In deregulated markets a consumer brand wins switchers at premium plans.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Transmission Congestion Rights",
      description: "Financial rights on constrained lines hedge delivery into every market.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Remote Operations Centers",
      description: "One control room runs dozens of plants, deleting on-site operator shifts.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "outputRate", commodity: "energy", pct: 0.06 },
      ],
    },
    {
      name: "Structured Power Products",
      description: "Shaped, firmed and optioned contracts price reliability itself as a product.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "logisticsStrength", flat: 26 },
      ],
    },
    {
      name: "Cross-Border Grid Stakes",
      description: "Equity in interconnectors and foreign grids moves power past every border.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "2009": [
    {
      name: "Wind Farm Cost Learning",
      description: "Bigger rotors and serial installation drop the cost of each new turbine.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Renewable Credit Premiums",
      description: "Bundled green certificates earn extra revenue on every clean megawatt.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Interconnection Queue Position",
      description: "Early grid slots for future projects fence off the best sites for years.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Turbine Frame Agreements",
      description:
        "Multi-year equipment orders lock factory slots and bulk prices for the pipeline.",
      effects: [
        { kind: "inputCost", commodity: "steel", pct: 0.11 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Corporate Power Purchase Deals",
      description: "Long-term deals with big brands sell clean output above wholesale for decades.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Stimulus Grant Capture",
      description: "A grants team turns clean-energy programs into cut-rate project capital.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "2019": [
    {
      name: "Solar Tracker Optimization",
      description: "Trackers and bifacial panels harvest more energy from the same field.",
      effects: [{ kind: "outputRate", commodity: "energy", pct: 0.05 }],
    },
    {
      name: "Capacity Market Bidding",
      description: "Paid availability commitments earn revenue even when plants sit idle.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Storm Hardening Programs",
      description: "Hardened lines and substations keep the lights on through extreme weather.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Hybrid Solar-Storage Plants",
      description: "Co-located batteries shift midday surplus into the high-priced evening peak.",
      effects: [
        { kind: "outputRate", commodity: "energy", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Twenty-Four Seven Clean Deals",
      description: "Hourly-matched clean supply is the premium product sophisticated buyers want.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Transition Auction Dominance",
      description: "Winning national renewable auctions locks in subsidized growth for a decade.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "dominanceShield", pct: 0.18 },
      ],
    },
  ],
  "2029": [
    {
      name: "Autonomous Plant Operations",
      description: "Self-tuning control systems run generation with a handful of supervisors.",
      effects: [{ kind: "laborCostReduction", pct: 0.05 }],
    },
    {
      name: "Data Center Power Campuses",
      description: "Dedicated supply for AI campuses sells firm power at compute-era prices.",
      effects: [{ kind: "priceRealization", pct: 0.015 }],
    },
    {
      name: "Grid Resilience Mandates",
      description: "Meeting new reliability standards first makes the firm the backbone operator.",
      effects: [{ kind: "dominanceShield", pct: 0.12 }],
    },
    {
      name: "Drone and Robot Field Crews",
      description:
        "Automated inspection and repair fleets maintain assets at a fraction of crew cost.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "outputRate", commodity: "energy", pct: 0.07 },
      ],
    },
    {
      name: "Firm Clean Power Premium",
      description:
        "Always-on carbon-free supply is the scarcest product on the grid and priced like it.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marketingStrength", flat: 32 },
      ],
    },
    {
      name: "Continental Supergrid Stakes",
      description:
        "Ownership in intercontinental links makes the firm indispensable to every market.",
      effects: [
        { kind: "tariffShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.16 },
      ],
    },
  ],
};
