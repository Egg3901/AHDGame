import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for extraction. Index 0-2 = specializations (Scale, Premium, Resilience); 3-5 = matching capstones. */
export const EXTRACTION_V3: V3LaneContent = {
  "1940": [
    {
      name: "Three-Shift Pit Rotation",
      description:
        "Round-the-clock shift rotation keeps shovels digging every hour the war demands.",
      effects: [
        { kind: "laborCostReduction", pct: 0.03 },
        { kind: "outputRate", commodity: "iron", pct: 0.04 },
      ],
    },
    {
      name: "Direct Smelter Contracts",
      description:
        "Selling straight to smelters on long contracts captures the middleman's spread.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Strategic Minerals Status",
      description:
        "Designation as a strategic supplier brings priority equipment and official protection.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Mechanized Loading Fleet",
      description: "Power shovels and belt loaders replace hand mucking across every working face.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "outputRate", commodity: "coal", pct: 0.07 },
      ],
    },
    {
      name: "Graded Ore Guarantees",
      description:
        "Certified grade and consistency guarantees earn a standing premium on every shipment.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "outputRate", commodity: "iron", pct: 0.06 },
      ],
    },
    {
      name: "Allied Supply Compacts",
      description:
        "Government offtake compacts guarantee markets and shelter the mine from disruption.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1950": [
    {
      name: "Bench Height Optimization",
      description: "Redesigned bench geometry lets bigger equipment move more rock per blast.",
      effects: [
        { kind: "growthCostReduction", pct: 0.03 },
        { kind: "outputRate", commodity: "iron", pct: 0.04 },
      ],
    },
    {
      name: "Washed and Sized Product",
      description: "Preparation plants sell clean, sized coal that burns better and prices higher.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "outputRate", commodity: "coal", pct: 0.03 },
      ],
    },
    {
      name: "Mineral Lease Portfolio",
      description: "A deep bank of undeveloped leases secures decades of reserves against rivals.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Truck-and-Shovel Conversion",
      description: "Diesel haul trucks free the pit from rail lines and cut cost per ton moved.",
      effects: [
        { kind: "inputCost", commodity: "vehicles", pct: 0.1 },
        { kind: "outputRate", commodity: "coal", pct: 0.07 },
      ],
    },
    {
      name: "Long-Term Utility Contracts",
      description:
        "Twenty-year fuel contracts with power utilities lock in prices above the spot market.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "outputRate", commodity: "oil", pct: 0.06 },
      ],
    },
    {
      name: "Frontier Concession Rights",
      description:
        "Early concessions in undeveloped basins stake claims rivals will pay dearly to enter.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "1960": [
    {
      name: "Crusher-Conveyor Systems",
      description: "In-pit crushing and conveyors replace half the haul fleet on every level.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.06 },
        { kind: "growthCostReduction", pct: 0.02 },
      ],
    },
    {
      name: "Pelletizing Plants",
      description:
        "Upgrading fines into blast-furnace pellets sells low-grade ore at high-grade prices.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "outputRate", commodity: "iron", pct: 0.03 },
      ],
    },
    {
      name: "Host Nation Joint Ventures",
      description: "Sharing equity with host governments keeps nationalization off the table.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Superpit Consolidation",
      description:
        "Merging adjacent workings into one giant pit unlocks scale no single lease allows.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "outputRate", commodity: "iron", pct: 0.08 },
      ],
    },
    {
      name: "Export Grade Branding",
      description:
        "A named, certified export blend becomes the benchmark other producers price against.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "outputRate", commodity: "rare_earth", pct: 0.06 },
      ],
    },
    {
      name: "Resource Diplomacy Desk",
      description:
        "A standing diplomatic office renews concessions and settles disputes before they escalate.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1970": [
    {
      name: "Energy Recovery Circuits",
      description: "Waste heat and methane capture power the mine through the oil shock.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.07 },
        { kind: "growthCostReduction", pct: 0.02 },
      ],
    },
    {
      name: "Spot Cargo Trading Desk",
      description: "An in-house trading desk times spot cargo sales to catch every price spike.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Reclamation Compliance Lead",
      description: "Getting ahead of new environmental law wins permits rivals wait years for.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Bulk Materials Superchain",
      description:
        "Integrated mine, rail, and port ownership moves tonnage at untouchable unit cost.",
      effects: [
        { kind: "inputCost", commodity: "freight", pct: 0.12 },
        { kind: "outputRate", commodity: "coal", pct: 0.08 },
      ],
    },
    {
      name: "Crisis Pricing Contracts",
      description:
        "Indexed contracts renegotiated in the shock years capture the new energy price floor.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "oil", pct: 0.07 },
      ],
    },
    {
      name: "National Champion Standing",
      description:
        "Deep state partnership makes the firm the government's chosen resource operator.",
      effects: [
        { kind: "dominanceShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1979": [
    {
      name: "Preventive Maintenance Regime",
      description:
        "Scheduled component swaps keep the haul fleet available instead of broken down.",
      effects: [
        { kind: "inputCost", commodity: "vehicles", pct: 0.06 },
        { kind: "laborCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Quality Bonus Clauses",
      description:
        "Contracts that pay bonuses for grade and penalize dilution reward disciplined mining.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Multi-Basin Portfolio",
      description: "Producing from several basins at once rides out any single region's bust.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Thin-Seam Recovery Systems",
      description: "New cutting systems make seams profitable that were written off a decade ago.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "outputRate", commodity: "coal", pct: 0.08 },
      ],
    },
    {
      name: "Refined Product Integration",
      description: "Moving downstream into processing captures margins raw ore never sees.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "outputRate", commodity: "rare_earth", pct: 0.07 },
      ],
    },
    {
      name: "Sanction-Proof Marketing",
      description:
        "Diversified buyers, flags, and settlement channels keep exports moving through any embargo.",
      effects: [
        { kind: "tariffShield", pct: 0.22 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "1989": [
    {
      name: "Dispatch Optimization Software",
      description: "Computerized truck assignment squeezes idle minutes out of every haul cycle.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.05 },
        { kind: "laborCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Certified Assay Laboratories",
      description:
        "Accredited on-site labs settle grade disputes in the mine's favor at the weighbridge.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Closure Bond Discipline",
      description: "Fully funded closure plans reassure regulators and speed every new permit.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Grade Engineering Program",
      description:
        "Blast-to-mill grade control lifts recovered metal without moving one extra ton.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "outputRate", commodity: "rare_earth", pct: 0.08 },
      ],
    },
    {
      name: "Hedged Premium Sales",
      description:
        "A hedging book locks forward prices at peaks while rivals ride the spot market down.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "outputRate", commodity: "natural_gas", pct: 0.06 },
      ],
    },
    {
      name: "Post-Soviet Asset Entry",
      description:
        "Early positions in newly opened resource states buy world-class deposits cheap.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1999": [
    {
      name: "Owner Mining Conversion",
      description:
        "Bringing contracted mining back in-house cuts the contractor margin from every ton.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "growthCostReduction", pct: 0.02 },
      ],
    },
    {
      name: "Traceable Origin Premiums",
      description: "Documented chain of custody sells certified ethical material at a markup.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Community Development Accords",
      description: "Signed local benefit agreements keep the social license to operate intact.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Global Procurement Platform",
      description:
        "Pooled worldwide purchasing beats down the price of tires, steel, and explosives.",
      effects: [
        { kind: "inputCost", commodity: "chemicals", pct: 0.12 },
        { kind: "inputCost", commodity: "vehicles", pct: 0.1 },
      ],
    },
    {
      name: "China Boom Positioning",
      description: "Expanded capacity aimed at Asian demand sells every ton into a rising market.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "outputRate", commodity: "iron", pct: 0.08 },
      ],
    },
    {
      name: "Continental Reserve Network",
      description:
        "Reserves spread across stable jurisdictions on four continents defuse every political risk.",
      effects: [
        { kind: "expansionDiscount", pct: 0.17 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "2009": [
    {
      name: "Remote Operations Migration",
      description: "City-based control rooms run remote sites without flying whole crews to camp.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "freight", pct: 0.05 },
      ],
    },
    {
      name: "Battery Metals Pivot",
      description:
        "Repointing exploration and product lines at battery demand catches the richest new market.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "outputRate", commodity: "rare_earth", pct: 0.03 },
      ],
    },
    {
      name: "Water Stewardship Compacts",
      description:
        "Shared water infrastructure with local users neutralizes the biggest permit objection.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Integrated Operations Center",
      description: "One control floor runs pits, plants, and trains as a single optimized machine.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "outputRate", commodity: "oil", pct: 0.07 },
      ],
    },
    {
      name: "Critical Minerals Premiums",
      description:
        "Long-term supply pacts with manufacturers price scarcity years into the future.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "rare_earth", pct: 0.07 },
      ],
    },
    {
      name: "Resource Security Alliances",
      description:
        "Supply agreements folded into allied industrial policy shield the firm from trade wars.",
      effects: [
        { kind: "tariffShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2019": [
    {
      name: "Autonomous Haul Conversion",
      description:
        "Driverless trucks run the pit around the clock with no shift change and fewer incidents.",
      effects: [
        { kind: "laborCostReduction", pct: 0.05 },
        { kind: "inputCost", commodity: "vehicles", pct: 0.05 },
      ],
    },
    {
      name: "Low-Carbon Product Lines",
      description:
        "Verified low-emission extraction sells into green procurement mandates at a premium.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Tailings Safety Certification",
      description:
        "Independent dam audits and monitoring keep insurers, lenders, and regulators calm.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Full Fleet Automation",
      description:
        "Drills, trucks, and trains run as one autonomous system under a handful of supervisors.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "outputRate", commodity: "iron", pct: 0.08 },
      ],
    },
    {
      name: "Green Premium Certification",
      description:
        "Audited renewable-powered operations command the top tier of every green price index.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "natural_gas", pct: 0.06 },
      ],
    },
    {
      name: "Friendshoring Charters",
      description:
        "Charter agreements inside allied blocs guarantee market access whatever the tariff walls do.",
      effects: [
        { kind: "tariffShield", pct: 0.24 },
        { kind: "expansionDiscount", pct: 0.16 },
      ],
    },
  ],
  "2029": [
    {
      name: "Predictive Asset Intelligence",
      description:
        "Machine learning predicts component failure and orders the part before anything breaks.",
      effects: [
        { kind: "inputCost", commodity: "vehicles", pct: 0.07 },
        { kind: "laborCostReduction", pct: 0.04 },
      ],
    },
    {
      name: "Digital Provenance Ledger",
      description:
        "Cryptographic origin records sell verified material into the strictest supply mandates.",
      effects: [{ kind: "priceRealization", pct: 0.015 }],
    },
    {
      name: "Closed-Loop Site Standard",
      description:
        "Near-zero discharge operations make new permits a formality in any jurisdiction.",
      effects: [{ kind: "dominanceShield", pct: 0.12 }],
    },
    {
      name: "Lights-Out Extraction",
      description:
        "Fully robotic sites mine, process, and load with no humans on the ground at all.",
      effects: [
        { kind: "laborCostReduction", pct: 0.1 },
        { kind: "outputRate", commodity: "rare_earth", pct: 0.09 },
      ],
    },
    {
      name: "Scarcity Auction Platforms",
      description:
        "Direct auctions of critical material clear at prices no negotiated contract reaches.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "outputRate", commodity: "oil", pct: 0.06 },
      ],
    },
    {
      name: "Planetary Reserve Doctrine",
      description:
        "Seabed claims, polar leases, and strategic stockpiles secure supply beyond any one nation's reach.",
      effects: [
        { kind: "dominanceShield", pct: 0.25 },
        { kind: "expansionDiscount", pct: 0.2 },
      ],
    },
  ],
};
