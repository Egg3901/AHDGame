import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for the manufacturing lane. */
export const MANUFACTURING_V3: V3LaneContent = {
  "1940": [
    {
      name: "Scrap Reclamation Drives",
      description: "Reclaimed scrap charges the furnaces and cuts the bill for virgin iron.",
      effects: [{ kind: "inputCost", commodity: "iron", pct: 0.06 }],
    },
    {
      name: "Arsenal Grade Certification",
      description: "Certified wartime quality lets the mill quote above the going rate for steel.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "War Production Board Seats",
      description: "A seat at the allocation table keeps materials flowing when quotas bite.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Continuous Furnace Campaigns",
      description: "Round-the-clock furnace campaigns spread fuel cost over far more tonnage.",
      effects: [
        { kind: "inputCost", commodity: "coal", pct: 0.12 },
        { kind: "outputRate", commodity: "steel", pct: 0.06 },
      ],
    },
    {
      name: "Prime Contractor Status",
      description: "Prime contracts with cost-plus terms pay premium prices for reliable output.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Dispersed Plant Network",
      description: "Duplicate plants across regions survive shortages and hostile politics alike.",
      effects: [
        { kind: "tariffShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1950": [
    {
      name: "Open Hearth Fuel Economy",
      description: "Regenerative burners and better charging practice cut coal per heat.",
      effects: [{ kind: "inputCost", commodity: "coal", pct: 0.07 }],
    },
    {
      name: "Alloy Steel Lines",
      description: "Specialty alloy grades sell into aerospace and autos at premium prices.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Industry Association Leadership",
      description:
        "Leading the trade association shapes tariffs and standards in the mill's favor.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Basic Oxygen Conversion",
      description: "Oxygen converters make a heat in under an hour instead of a shift.",
      effects: [
        { kind: "outputRate", commodity: "steel", pct: 0.08 },
        { kind: "inputCost", commodity: "coal", pct: 0.1 },
      ],
    },
    {
      name: "Branded Structural Products",
      description: "Branded beams and sheet with certified specs hold price through downturns.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Greenfield Mill Program",
      description: "A standard mill design stamped onto cheap land opens capacity fast.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Pelletized Ore Burden",
      description: "Uniform ore pellets smooth furnace burdens and stretch every ton of iron.",
      effects: [{ kind: "inputCost", commodity: "iron", pct: 0.06 }],
    },
    {
      name: "Coated Sheet Premiums",
      description: "Galvanized and coated sheet earns more per ton than commodity coil.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Import Quota Advocacy",
      description: "Organized advocacy for orderly import quotas holds the home market.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Continuous Casting Lines",
      description: "Casting straight to slab skips the ingot yard and its energy bill.",
      effects: [
        { kind: "outputRate", commodity: "steel", pct: 0.08 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "Applications Engineering Sales",
      description: "Engineers embedded with customers design the product in and defend the price.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Export Consortium Membership",
      description:
        "Joint export consortia land orders behind tariff walls the mill cannot cross alone.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1970": [
    {
      name: "Waste Heat Recovery",
      description: "Recovered furnace heat preheats stock and trims the energy bill.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.07 }],
    },
    {
      name: "Certified Pressure Grades",
      description: "Certified pipe and vessel grades sell into energy projects at a premium.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Trigger Price Monitoring",
      description: "Documented fair pricing keeps dumping cases pointed at foreign rivals instead.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Electric Arc Minimills",
      description: "Scrap-fed arc furnaces make bar and rod without coke ovens or blast furnaces.",
      effects: [
        { kind: "inputCost", commodity: "iron", pct: 0.13 },
        { kind: "inputCost", commodity: "coal", pct: 0.12 },
      ],
    },
    {
      name: "Long-Term Supply Contracts",
      description: "Indexed multi-year contracts with big buyers lock in price and volume.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "outputRate", commodity: "steel", pct: 0.06 },
      ],
    },
    {
      name: "Overseas Joint Ventures",
      description: "Minority stakes in foreign mills earn from markets tariffs keep shut.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1979": [
    {
      name: "Ladle Metallurgy Stations",
      description: "Refining in the ladle cuts reheats and the power they burn.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.06 }],
    },
    {
      name: "High-Strength Light Grades",
      description: "Lighter high-strength grades win auto contracts at better prices per ton.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Plant Community Compacts",
      description: "Jobs pacts with plant towns turn local politics into a defensive wall.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Computerized Process Control",
      description: "Closed-loop furnace control holds every heat on spec with less fuel and scrap.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.11 },
        { kind: "outputRate", commodity: "steel", pct: 0.06 },
      ],
    },
    {
      name: "Just-in-Time Supply Slots",
      description: "Guaranteed delivery windows to assembly lines command contract premiums.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "logisticsStrength", flat: 28 },
      ],
    },
    {
      name: "Capacity Rationalization Deals",
      description: "Negotiated capacity swaps close weak plants and fortify the strong ones.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1989": [
    {
      name: "Thin Slab Casting",
      description: "Casting near-final thickness cuts rolling passes and the energy they take.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.06 },
        { kind: "growthCostReduction", pct: 0.02 },
      ],
    },
    {
      name: "Prefabricated Building Systems",
      description: "Engineered building packages sell as systems, not tonnage, at system prices.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "outputRate", commodity: "building_materials", pct: 0.03 },
      ],
    },
    {
      name: "Environmental Compliance Lead",
      description: "Beating emission rules early turns each new standard into a rival's problem.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Integrated Mill Automation",
      description: "Plant-wide automation runs melt to coil with a fraction of the crews.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "outputRate", commodity: "steel", pct: 0.07 },
      ],
    },
    {
      name: "Engineered Systems Divisions",
      description:
        "Design, fabrication and install sold together capture the whole project margin.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "outputRate", commodity: "building_materials", pct: 0.06 },
      ],
    },
    {
      name: "Cross-Border Plant Buyouts",
      description: "Buying privatized foreign plants plants production inside every trade wall.",
      effects: [
        { kind: "tariffShield", pct: 0.19 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1999": [
    {
      name: "Reverse Auction Procurement",
      description: "Online reverse auctions squeeze quotes on plastics and components.",
      effects: [{ kind: "inputCost", commodity: "plastics", pct: 0.07 }],
    },
    {
      name: "Traceable Quality Records",
      description: "Full heat-to-coil traceability wins certified orders at better prices.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Antidumping Petition Desk",
      description: "A standing legal desk files trade cases the week import surges appear.",
      effects: [{ kind: "tariffShield", pct: 0.11 }],
    },
    {
      name: "Networked Plant Scheduling",
      description: "One order book schedules every plant and freight lane for lowest landed cost.",
      effects: [
        { kind: "inputCost", commodity: "freight", pct: 0.12 },
        { kind: "logisticsStrength", flat: 30 },
      ],
    },
    {
      name: "Vendor-Managed Inventory",
      description:
        "Managing the customer's steel stock on site makes the mill impossible to quote out.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "logisticsStrength", flat: 26 },
      ],
    },
    {
      name: "Global Capacity Arbitrage",
      description: "Shifting orders between plants on three continents beats any single tariff.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "2009": [
    {
      name: "Energy Demand Response",
      description: "Arc furnaces melt when power is cheap and idle through peak pricing.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.07 }],
    },
    {
      name: "Green Steel Certification",
      description: "Certified low-carbon steel sells to committed buyers above market.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Regional Content Compliance",
      description: "Meeting local content rules keeps orders flowing under every trade pact.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Predictive Line Maintenance",
      description: "Sensors call the outage before the breakdown and lines stop standing idle.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "outputRate", commodity: "steel", pct: 0.07 },
      ],
    },
    {
      name: "Custom Alloy Programs",
      description: "Alloys engineered per customer program price on performance, not the index.",
      effects: [
        { kind: "priceRealization", pct: 0.027 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Nearshore Plant Web",
      description: "Plants placed one border from every big market dodge tariffs and long freight.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2019": [
    {
      name: "Digital Twin Commissioning",
      description: "Simulated lines shake out faults before steel is poured on new equipment.",
      effects: [
        { kind: "growthCostReduction", pct: 0.03 },
        { kind: "inputCost", commodity: "electronics", pct: 0.05 },
      ],
    },
    {
      name: "Additive Spare Parts",
      description: "Printed spares and short runs sell at premium prices with zero tooling.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Carbon Border Readiness",
      description: "Audited carbon accounting clears border adjustment regimes without penalty.",
      effects: [{ kind: "tariffShield", pct: 0.11 }],
    },
    {
      name: "Machine Vision Quality Gates",
      description: "Cameras inspect every meter of product and scrap rates fall to fractions.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "outputRate", commodity: "steel", pct: 0.08 },
      ],
    },
    {
      name: "Outcome-Based Contracts",
      description:
        "Selling guaranteed uptime and performance instead of parts lifts realized price.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Friendshoring Alliances",
      description: "Allied-bloc supply pacts keep orders moving when trade blocs harden.",
      effects: [
        { kind: "tariffShield", pct: 0.21 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "2029": [
    {
      name: "Hydrogen Ready Furnaces",
      description: "Furnaces that switch fuels on price burn the cheapest energy every shift.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.08 }],
    },
    {
      name: "Materials Passport Products",
      description:
        "Products shipped with full lifecycle passports command circular-economy premiums.",
      effects: [{ kind: "priceRealization", pct: 0.015 }],
    },
    {
      name: "Strategic Industry Designation",
      description: "Designation as critical industry brings procurement priority and legal cover.",
      effects: [
        { kind: "dominanceShield", pct: 0.1 },
        { kind: "tariffShield", pct: 0.08 },
      ],
    },
    {
      name: "Self-Optimizing Mills",
      description:
        "AI schedules melt, roll and ship end to end and squeezes waste out of every heat.",
      effects: [
        { kind: "outputRate", commodity: "steel", pct: 0.09 },
        { kind: "inputCost", commodity: "energy", pct: 0.12 },
      ],
    },
    {
      name: "Certified Circular Steel",
      description:
        "Closed-loop recycled steel with audited provenance sets the market's top price.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "marketingStrength", flat: 27 },
      ],
    },
    {
      name: "Bloc-Spanning Production Grid",
      description:
        "Interchangeable plants across rival blocs keep supply unbroken through any embargo.",
      effects: [
        { kind: "tariffShield", pct: 0.24 },
        { kind: "expansionDiscount", pct: 0.16 },
      ],
    },
  ],
};
