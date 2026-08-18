import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for logistics. Index 0-2 = specializations (Scale, Premium, Resilience); 3-5 = matching capstones. */
export const LOGISTICS_V3: V3LaneContent = {
  "1940": [
    {
      name: "Backhaul Load Matching",
      description: "Filling return trips with paying freight ends the waste of empty miles.",
      effects: [
        { kind: "logisticsStrength", flat: 12 },
        { kind: "inputCost", commodity: "energy", pct: 0.05 },
      ],
    },
    {
      name: "Priority War Contracts",
      description: "Certified priority carrier status wins government freight at premium rates.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Rationing Board Liaison",
      description:
        "A dedicated office keeps fuel and tire allocations flowing when rivals sit idle.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Standardized Fleet Program",
      description:
        "One truck model, one parts bin, and one maintenance drill cut fleet cost to the bone.",
      effects: [
        { kind: "inputCost", commodity: "vehicles", pct: 0.12 },
        { kind: "logisticsStrength", flat: 25 },
      ],
    },
    {
      name: "Guaranteed Delivery Windows",
      description:
        "Published on-time guarantees let the firm bill for reliability, not just miles.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "outputRate", commodity: "freight", pct: 0.06 },
      ],
    },
    {
      name: "Strategic Route Authorities",
      description: "Locked operating rights on key corridors keep competitors off the best lanes.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1950": [
    {
      name: "Terminal Turn Standards",
      description:
        "Timed dock procedures get trucks unloaded, reloaded, and back on the road in hours.",
      effects: [
        { kind: "logisticsStrength", flat: 14 },
        { kind: "laborCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "White Glove Freight",
      description:
        "Trained crews and clean equipment win the high-value cargo that pays premium rates.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marketingStrength", flat: 10 },
      ],
    },
    {
      name: "Rate Bureau Standing",
      description: "A seat at the rate bureau table shapes tariffs before they are filed.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Turnpike Doubles Operation",
      description: "Twin trailers on the new interstates move twice the freight per driver shift.",
      effects: [
        { kind: "outputRate", commodity: "freight", pct: 0.08 },
        { kind: "laborCostReduction", pct: 0.07 },
      ],
    },
    {
      name: "National Account Desks",
      description:
        "Single-contact service for big shippers locks in contract freight at healthy margins.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Interline Alliance Network",
      description:
        "Standing interline agreements deliver anywhere without building terminals everywhere.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "1960": [
    {
      name: "Container Crane Investment",
      description: "Quayside cranes and cell guides cut ship turnaround from weeks to days.",
      effects: [
        { kind: "logisticsStrength", flat: 15 },
        { kind: "growthCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Expedited Freight Brand",
      description: "A named overnight service turns speed into a product shippers ask for by name.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Port Authority Partnerships",
      description:
        "Long leases and joint terminal ventures anchor the firm inside public infrastructure.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Unit Train Contracts",
      description:
        "Dedicated trains running loop schedules move bulk freight at the lowest cost per ton.",
      effects: [
        { kind: "outputRate", commodity: "freight", pct: 0.09 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "Door-to-Door Guarantee",
      description:
        "One bill of lading covers ship, rail, and truck, and the firm owns the whole promise.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "outputRate", commodity: "consulting_services", pct: 0.06 },
      ],
    },
    {
      name: "Free Port Positioning",
      description:
        "Operations planted in free trade zones move cargo across borders untaxed and unstopped.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1970": [
    {
      name: "Fuel Economy Fleets",
      description: "Aerodynamic tractors and governed speeds blunt the oil shock at the pump.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.07 },
        { kind: "logisticsStrength", flat: 12 },
      ],
    },
    {
      name: "Time-Definite Services",
      description:
        "Freight priced by the hour of arrival, not the mile, commands committed premiums.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Deregulation Readiness",
      description: "Contract and pricing teams stand ready to move the day the rate rules fall.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Slurry and Bulk Systems",
      description:
        "Purpose-built bulk handling moves commodity freight at costs no boxcar can match.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.12 },
        { kind: "outputRate", commodity: "freight", pct: 0.07 },
      ],
    },
    {
      name: "Overnight Air Network",
      description: "A hub-fed overnight air system sells certainty at ten times the surface rate.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Multi-Modal Charter",
      description:
        "Owning truck, rail, and barge authority in one charter survives any single-mode squeeze.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1979": [
    {
      name: "Load Consolidation Centers",
      description:
        "Pooling partial loads into full trailers spreads linehaul cost across many shippers.",
      effects: [
        { kind: "logisticsStrength", flat: 14 },
        { kind: "growthCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Contract Logistics Sales",
      description: "Multi-year dedicated contracts replace spot-rate chaos with committed margin.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "outputRate", commodity: "consulting_services", pct: 0.04 },
      ],
    },
    {
      name: "Owner-Operator Buffer",
      description:
        "A flexible owner-operator pool absorbs demand swings without idle company trucks.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Post-Deregulation Land Grab",
      description:
        "Freed pricing and open routes let the firm undercut and absorb sleepy regulated rivals.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "outputRate", commodity: "freight", pct: 0.08 },
      ],
    },
    {
      name: "Integrated Carrier Brand",
      description:
        "One brand promises pickup to delivery anywhere, and shippers pay for the simplicity.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 32 },
      ],
    },
    {
      name: "Union and Non-Union Dual Shop",
      description:
        "Parallel operating companies keep service running through any single labor dispute.",
      effects: [
        { kind: "dominanceShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1989": [
    {
      name: "Optimized Load Planning",
      description:
        "Software builds trailer loads and route sequences no dispatcher could match by hand.",
      effects: [
        { kind: "logisticsStrength", flat: 16 },
        { kind: "inputCost", commodity: "software", pct: 0.05 },
      ],
    },
    {
      name: "Supply Chain Consulting Arm",
      description: "Selling network design studies turns operating expertise into billable advice.",
      effects: [
        { kind: "outputRate", commodity: "consulting_services", pct: 0.05 },
        { kind: "priceRealization", pct: 0.01 },
      ],
    },
    {
      name: "Customs Pre-Clearance",
      description: "Electronic filings clear borders before the truck arrives at the crossing.",
      effects: [{ kind: "tariffShield", pct: 0.12 }],
    },
    {
      name: "Network Optimization Core",
      description: "A central operations research team redesigns the whole network every season.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "logisticsStrength", flat: 30 },
      ],
    },
    {
      name: "Lead Logistics Provider",
      description: "Running a shipper's entire supply chain makes the firm impossible to unplug.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "outputRate", commodity: "consulting_services", pct: 0.07 },
      ],
    },
    {
      name: "Continental Gateway Grid",
      description:
        "Owned gateways on every major border move goods through trade blocs without friction.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "1999": [
    {
      name: "Web-Native Operations",
      description:
        "Browser booking, tracking, and billing strip paper and phone banks from the workflow.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "software", pct: 0.05 },
      ],
    },
    {
      name: "Premium Cold Chain",
      description:
        "Validated temperature control wins pharmaceutical and fresh freight at top rates.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Security Certified Lanes",
      description:
        "Certified secure supply chain status keeps cargo moving through tightened borders.",
      effects: [{ kind: "tariffShield", pct: 0.11 }],
    },
    {
      name: "Paperless Freight Platform",
      description:
        "End-to-end electronic documents cut days of dwell and armies of clerks from every shipment.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "logisticsStrength", flat: 28 },
      ],
    },
    {
      name: "Global Account Management",
      description:
        "One worldwide contract and one invoice make the firm the default for multinationals.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Redundant Hub Architecture",
      description:
        "Overlapping hubs reroute the network around any strike, storm, or closure overnight.",
      effects: [
        { kind: "dominanceShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "2009": [
    {
      name: "Telematics Fuel Programs",
      description:
        "Live driver coaching and idle limits carve percentage points off the fuel bill.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.06 },
        { kind: "logisticsStrength", flat: 12 },
      ],
    },
    {
      name: "Same-Day Metro Delivery",
      description:
        "Urban micro-depots sell same-day service at rates overnight carriers cannot touch.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 10 },
      ],
    },
    {
      name: "Carrier Compliance Shield",
      description:
        "Spotless safety and hours records keep regulators and plaintiffs at a distance.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Robotic Fulfillment Grid",
      description: "Goods-to-person robotics multiply picks per hour while headcount stays flat.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "outputRate", commodity: "freight", pct: 0.07 },
      ],
    },
    {
      name: "E-Commerce Logistics Brand",
      description:
        "Branded checkout delivery promises make the carrier part of the product shoppers buy.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 32 },
      ],
    },
    {
      name: "Nearshore Network Build",
      description: "Capacity planted along nearshoring corridors catches trade as it reroutes.",
      effects: [
        { kind: "expansionDiscount", pct: 0.17 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "2019": [
    {
      name: "Electric Depot Charging",
      description:
        "Depot charging on off-peak power moves the urban fleet at a fraction of diesel cost.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.06 },
        { kind: "logisticsStrength", flat: 12 },
      ],
    },
    {
      name: "Real-Time Visibility Sales",
      description: "Live shipment data sold as a product turns tracking into a revenue line.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "outputRate", commodity: "consulting_services", pct: 0.04 },
      ],
    },
    {
      name: "Pandemic-Proof Playbooks",
      description:
        "Rehearsed contingency operations keep freight moving through lockdowns and port jams.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Micro-Fulfillment Mesh",
      description: "Hundreds of small automated sites put inventory minutes from every doorstep.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "outputRate", commodity: "freight", pct: 0.08 },
      ],
    },
    {
      name: "Instant Delivery Brand",
      description:
        "A household name for two-hour delivery charges for speed the way airlines charge for class.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 32 },
      ],
    },
    {
      name: "Resilience-as-a-Service",
      description:
        "Contracted backup capacity and dual sourcing sell insurance against the next disruption.",
      effects: [
        { kind: "dominanceShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2029": [
    {
      name: "Autonomous Corridor Operations",
      description:
        "Driverless linehaul on certified corridors runs around the clock at falling cost per mile.",
      effects: [
        { kind: "laborCostReduction", pct: 0.05 },
        { kind: "inputCost", commodity: "vehicles", pct: 0.06 },
      ],
    },
    {
      name: "Guaranteed Slot Logistics",
      description:
        "Auctioned delivery slots with hard guarantees price scarce capacity at its true worth.",
      effects: [
        { kind: "priceRealization", pct: 0.015 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Emissions Compliance Fleet",
      description: "A zero-emission fleet clears every city access rule and carbon border charge.",
      effects: [{ kind: "tariffShield", pct: 0.12 }],
    },
    {
      name: "Self-Balancing Network AI",
      description:
        "The network reprices, reroutes, and repositions itself continuously without planners.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "logisticsStrength", flat: 38 },
      ],
    },
    {
      name: "Predictive Commerce Contracts",
      description:
        "Goods ship before the order exists, and customers pay premium rates for instant arrival.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "freight", pct: 0.07 },
      ],
    },
    {
      name: "Sovereign Logistics Compacts",
      description:
        "Treaty-level infrastructure partnerships make the network critical to national supply security.",
      effects: [
        { kind: "dominanceShield", pct: 0.24 },
        { kind: "expansionDiscount", pct: 0.18 },
      ],
    },
  ],
};
