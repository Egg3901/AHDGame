import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for the defense lane. */
export const DEFENSE_V3: V3LaneContent = {
  "1940": [
    {
      name: "Shell Line Standardization",
      description: "Standard shell gauges let every line run the same tooling at higher rates.",
      effects: [{ kind: "outputRate", commodity: "ordnance", pct: 0.04 }],
    },
    {
      name: "Proving Ground Demonstrations",
      description: "Live demonstrations for procurement boards win larger orders at better terms.",
      effects: [{ kind: "marketingStrength", flat: 15 }],
    },
    {
      name: "Dispersed Plant Siting",
      description: "Plants spread across regions keep contracts flowing when any one site is hit.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Government-Furnished Machine Tools",
      description: "War board tooling grants cut expansion outlays and steel bills at once.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "inputCost", commodity: "steel", pct: 0.1 },
      ],
    },
    {
      name: "Ordnance Board Endorsements",
      description: "Official acceptance marks let the arsenal quote premium prices on every lot.",
      effects: [
        { kind: "priceRealization", pct: 0.02 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Shadow Factory Network",
      description: "Standby duplicate plants deter rivals and make new sites cheap to activate.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1950": [
    {
      name: "Jig and Fixture Pooling",
      description: "Shared jigs across programs cut skilled labor hours per unit.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Service Trials Publicity",
      description: "Well-publicized service trials justify premium unit pricing.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Allied Sales Missions",
      description: "Standing sales missions to allied capitals soften export barriers.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Automated Ammunition Loading",
      description: "Automated load-assemble-pack lines multiply ordnance output per worker.",
      effects: [
        { kind: "outputRate", commodity: "ordnance", pct: 0.08 },
        { kind: "laborCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Prime Contractor Branding",
      description: "A prime contractor reputation commands top rates on every new program.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "NATO Standardization Contracts",
      description: "Alliance standard fittings open every member market at low entry cost.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1960": [
    {
      name: "Value Engineering Programs",
      description: "Formal value reviews strip cost from designs before they reach the floor.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Competitive Flyoff Wins",
      description: "Head-to-head flyoff victories carry pricing power into contract talks.",
      effects: [
        { kind: "priceRealization", pct: 0.01 },
        { kind: "marketingStrength", flat: 15 },
      ],
    },
    {
      name: "Second-Source Agreements",
      description: "Licensed second sources lock rivals into partnership instead of competition.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Numerical Control Machining",
      description: "Tape-controlled mills turn out airframe and hull parts faster and cheaper.",
      effects: [
        { kind: "outputRate", commodity: "vehicles", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Total Package Procurement Wins",
      description: "Winning whole-lifecycle packages locks in premium pricing for decades.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Offset Agreement Desks",
      description: "Offset deals trade local work share for protected foreign market entry.",
      effects: [
        { kind: "tariffShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1970": [
    {
      name: "Common Chassis Families",
      description: "One hull family across variants cuts the steel bill per delivered vehicle.",
      effects: [{ kind: "inputCost", commodity: "steel", pct: 0.07 }],
    },
    {
      name: "Milestone Award Fees",
      description: "Incentive-fee contracts pay a premium for hitting delivery milestones.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Foreign Military Sales Offices",
      description: "Government-channel sales offices carry exports past trade barriers.",
      effects: [{ kind: "tariffShield", pct: 0.11 }],
    },
    {
      name: "Modular Weapon Assemblies",
      description:
        "Common modules across platforms cut electronics spend and speed final assembly.",
      effects: [
        { kind: "inputCost", commodity: "electronics", pct: 0.12 },
        { kind: "outputRate", commodity: "vehicles", pct: 0.07 },
      ],
    },
    {
      name: "Air Show Flight Demonstrations",
      description: "International air show displays turn spectacle into premium export orders.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Co-Production Licensing",
      description: "Licensed partner assembly abroad makes foreign plants cheap and tariff-proof.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1979": [
    {
      name: "Learning Curve Pricing",
      description: "Planned learning-curve targets drive unit cost down lot after lot.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Flagship Program Marketing",
      description: "A famous flagship program sells the whole catalog behind it.",
      effects: [{ kind: "marketingStrength", flat: 18 }],
    },
    {
      name: "Industrial Base Set-Asides",
      description: "Set-aside contracts guarantee workload when the market turns against you.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Robotic Welding Cells",
      description: "Robot welders take the most expensive labor out of hull and chassis lines.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "outputRate", commodity: "vehicles", pct: 0.06 },
      ],
    },
    {
      name: "Frontline Performance Records",
      description: "Documented combat performance lets sales teams name their price.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Allied Consortium Programs",
      description: "Multinational consortium membership spreads risk and opens partner markets.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1989": [
    {
      name: "Concurrent Engineering Teams",
      description: "Design and production engineers working together cut rework before it starts.",
      effects: [{ kind: "growthCostReduction", pct: 0.035 }],
    },
    {
      name: "Televised Combat Debuts",
      description: "Weapons seen working on the evening news sell themselves worldwide.",
      effects: [{ kind: "marketingStrength", flat: 18 }],
    },
    {
      name: "Defense Conversion Hedging",
      description: "Dual-use product lines cushion the business through procurement droughts.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Flexible Machining Centers",
      description: "Reprogrammable machining centers cut retooling cost and steel waste together.",
      effects: [
        { kind: "growthCostReduction", pct: 0.07 },
        { kind: "inputCost", commodity: "steel", pct: 0.12 },
      ],
    },
    {
      name: "Smart Weapon Showcases",
      description: "Guided-weapon accuracy footage anchors premium pricing across the catalog.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Prime Merger Integration",
      description: "Absorbing rival primes secures market share and cheap ready-built capacity.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1999": [
    {
      name: "Commercial Off-the-Shelf Sourcing",
      description: "Commercial-grade components replace bespoke parts at a fraction of the cost.",
      effects: [{ kind: "inputCost", commodity: "electronics", pct: 0.08 }],
    },
    {
      name: "Performance-Based Contracts",
      description: "Pay-for-availability terms reward reliability with richer margins.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Homeland Security Diversification",
      description: "Civil security contracts steady revenue when military budgets tighten.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Common Avionics Software Lines",
      description: "One reusable software baseline serves every platform and cuts component churn.",
      effects: [
        { kind: "outputRate", commodity: "software", pct: 0.07 },
        { kind: "inputCost", commodity: "electronics", pct: 0.12 },
      ],
    },
    {
      name: "Sole-Source Sustainment Deals",
      description: "Exclusive lifetime support contracts turn every sale into a premium annuity.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Global Supplier Qualification",
      description: "A qualified worldwide supplier bench makes foreign plants fast and duty-safe.",
      effects: [
        { kind: "tariffShield", pct: 0.17 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2009": [
    {
      name: "Should-Cost Reviews",
      description: "Bottom-up cost teardowns expose padding before contracts are signed.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Urgent Operational Needs Wins",
      description: "Fast fielding under urgent-need orders builds a premium reputation.",
      effects: [{ kind: "marketingStrength", flat: 16 }],
    },
    {
      name: "Export Control Compliance Desks",
      description: "In-house licensing expertise keeps export lanes open when rules tighten.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Additive Metal Printing",
      description: "Printed titanium and steel parts cut material buys and tooling spend at once.",
      effects: [
        { kind: "inputCost", commodity: "steel", pct: 0.12 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Combat-Proven Drone Lines",
      description: "Unmanned systems with operational records command premium export pricing.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Allied Interoperability Certification",
      description:
        "Certified alliance compatibility clears exports and cheapens partner-market entry.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "2019": [
    {
      name: "Model-Based Systems Engineering",
      description: "Digital system models catch integration faults before metal is cut.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Rapid Prototyping Contracts",
      description: "Quick-turn prototype awards pay premium rates for speed to field.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Friend-Shored Supply Chains",
      description: "Sourcing from allied economies insulates the line from trade shocks.",
      effects: [{ kind: "tariffShield", pct: 0.12 }],
    },
    {
      name: "Digital Factory Twins",
      description:
        "A live digital copy of the plant tunes ordnance lines and expansion plans daily.",
      effects: [
        { kind: "outputRate", commodity: "ordnance", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Battle-Tested Export Lines",
      description: "Systems proven in current conflicts sell at the top of the market.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Multinational Framework Agreements",
      description: "Standing multi-country frameworks pre-clear tariffs and site approvals.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2029": [
    {
      name: "Autonomous Production Cells",
      description: "Self-running production cells hold output through labor shortages.",
      effects: [{ kind: "laborCostReduction", pct: 0.05 }],
    },
    {
      name: "Live-Fire Data Marketing",
      description: "Verified range telemetry backs every performance claim in the sales deck.",
      effects: [{ kind: "marketingStrength", flat: 18 }],
    },
    {
      name: "Sovereign Arsenal Mandates",
      description: "National-supplier status shelters the order book from foreign challengers.",
      effects: [{ kind: "dominanceShield", pct: 0.12 }],
    },
    {
      name: "Lights-Out Munitions Plants",
      description: "Fully automated plants run around the clock with a skeleton crew.",
      effects: [
        { kind: "laborCostReduction", pct: 0.1 },
        { kind: "outputRate", commodity: "ordnance", pct: 0.09 },
      ],
    },
    {
      name: "Orbital Demonstration Missions",
      description: "On-orbit capability demonstrations set the price ceiling for the industry.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "marketingStrength", flat: 35 },
      ],
    },
    {
      name: "Allied Industrial Treaties",
      description:
        "Treaty-level industrial pacts make partner-nation capacity cheap and duty-free.",
      effects: [
        { kind: "tariffShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.18 },
      ],
    },
  ],
};
