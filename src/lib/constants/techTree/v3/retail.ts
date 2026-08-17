import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for retail. */
export const RETAIL_V3: V3LaneContent = {
  "1940": [
    {
      name: "Ration Book Handling",
      description:
        "Drilled ration-coupon procedures keep lines moving with fewer clerks per counter.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Quality Goods Reputation",
      description: "A name for honest weights and unspoiled stock lets prices hold at the ceiling.",
      effects: [{ kind: "priceRealization", pct: 0.011 }],
    },
    {
      name: "Price Board Cooperation",
      description: "Model compliance with price controls earns allocations rivals get denied.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Consolidated Delivery Pools",
      description: "Pooled delivery trucks across stores cut fuel and freight to a fraction.",
      effects: [
        { kind: "inputCost", commodity: "freight", pct: 0.11 },
        { kind: "logisticsStrength", flat: 26 },
      ],
    },
    {
      name: "Victory Counter Displays",
      description: "Patriotic displays and war-bond tie-ins pull crowds who pay full ticket.",
      effects: [
        { kind: "priceRealization", pct: 0.021 },
        { kind: "marketingStrength", flat: 27 },
      ],
    },
    {
      name: "Essential Retailer Status",
      description: "Official essential status protects stock allocations and store openings.",
      effects: [
        { kind: "dominanceShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1950": [
    {
      name: "Self-Service Conversion Drives",
      description: "Converting counters to self-service floors serves more shoppers per clerk.",
      effects: [
        { kind: "laborCostReduction", pct: 0.05 },
        { kind: "outputRate", commodity: "retail", pct: 0.03 },
      ],
    },
    {
      name: "Trading Stamp Programs",
      description: "Stamp books bring shoppers back weekly and blunt price comparison.",
      effects: [
        { kind: "priceRealization", pct: 0.011 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Suburban Site Scouting",
      description: "A scouting office locks up prime suburban corners before rivals arrive.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Chain Warehouse Network",
      description:
        "Company-owned warehouses feed every store, cutting freight and stockouts together.",
      effects: [
        { kind: "inputCost", commodity: "freight", pct: 0.12 },
        { kind: "logisticsStrength", flat: 28 },
      ],
    },
    {
      name: "Television Sponsorship Slots",
      description: "Sponsored television programs put the store name in every living room.",
      effects: [
        { kind: "marketingStrength", flat: 32 },
        { kind: "priceRealization", pct: 0.02 },
      ],
    },
    {
      name: "Highway Corridor Rollout",
      description: "Standard store plans stamped along new highways open markets at low cost.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Central Meat and Produce Prep",
      description: "Central prep rooms cut in-store butchering labor and shrink losses.",
      effects: [
        { kind: "inputCost", commodity: "food", pct: 0.06 },
        { kind: "laborCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "House Brand Quality Lines",
      description: "Upgraded house brands sell near national-brand prices at better margin.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Fair Trade Law Navigation",
      description: "Legal teams work resale-price laws so discounting stays defensible.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Automated Reorder Points",
      description:
        "Punch-card reorder systems keep shelves full with lean backrooms and fewer clerks.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "inputCost", commodity: "freight", pct: 0.1 },
      ],
    },
    {
      name: "Flagship Downtown Renovations",
      description: "Showcase flagship stores set a premium image the whole chain prices against.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Regional Mall Anchor Rights",
      description: "Anchor-tenant rights in new malls guarantee traffic and squeeze rival siting.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "1970": [
    {
      name: "Energy-Managed Storefronts",
      description: "Timers and setbacks cut the lighting and cooling bills the oil shock doubled.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.07 }],
    },
    {
      name: "Designer Label Partnerships",
      description: "Exclusive designer lines let ordinary racks sell at boutique prices.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 13 },
      ],
    },
    {
      name: "Consumer Protection Compliance",
      description:
        "Clean labeling and refund policies keep new consumer agencies pointed elsewhere.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Scanner-Fed Ordering",
      description:
        "Checkout scan data drives ordering, stripping stale stock and clerical labor out.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Lifestyle Department Concepts",
      description: "Curated lifestyle departments trade on taste and hold full price all season.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marginBonus", pp: 0.8 },
      ],
    },
    {
      name: "Sunbelt Expansion Program",
      description: "A build program follows population south and west ahead of the competition.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1979": [
    {
      name: "Vendor-Managed Inventory",
      description:
        "Suppliers restock their own lines, moving carrying cost off the retailer's books.",
      effects: [
        { kind: "inputCost", commodity: "freight", pct: 0.07 },
        { kind: "growthCostReduction", pct: 0.02 },
      ],
    },
    {
      name: "Premium Service Counters",
      description: "Staffed service counters justify prices the discounters cannot touch.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Import Sourcing Offices",
      description: "Buying offices in Asia hedge quota politics and lock in landed costs.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Hub-and-Spoke Distribution",
      description: "Regional hubs with scheduled runs cut freight per carton to industry lows.",
      effects: [
        { kind: "inputCost", commodity: "freight", pct: 0.13 },
        { kind: "logisticsStrength", flat: 30 },
      ],
    },
    {
      name: "National Brand Campaigns",
      description: "Coast-to-coast advertising makes the store name itself the draw.",
      effects: [
        { kind: "marketingStrength", flat: 34 },
        { kind: "priceRealization", pct: 0.02 },
      ],
    },
    {
      name: "Small-Town Saturation Strategy",
      description:
        "Saturating overlooked small towns builds markets rivals cannot profitably enter.",
      effects: [
        { kind: "expansionDiscount", pct: 0.17 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "1989": [
    {
      name: "Cross-Dock Flow Buildings",
      description:
        "Goods flow dock to dock without storage, shrinking warehouses and handling labor.",
      effects: [
        { kind: "inputCost", commodity: "freight", pct: 0.07 },
        { kind: "laborCostReduction", pct: 0.04 },
      ],
    },
    {
      name: "Everyday Fair Price Positioning",
      description: "Stable honest pricing replaces sale whiplash and holds realized price up.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Community Store Formats",
      description: "Smaller formats tailored to neighborhoods defuse big-box zoning fights.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Satellite-Linked Replenishment",
      description: "A private satellite network links every register to distribution in real time.",
      effects: [
        { kind: "logisticsStrength", flat: 36 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Loyalty Card Analytics",
      description: "Card data targets offers by household, lifting full-price sales chainwide.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 27 },
      ],
    },
    {
      name: "International Format Licensing",
      description: "Licensing formats abroad grows the brand without tariff or capital exposure.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1999": [
    {
      name: "Perpetual Inventory Systems",
      description: "Live item-level counts end safety stock padding and emergency freight.",
      effects: [
        { kind: "inputCost", commodity: "freight", pct: 0.06 },
        { kind: "growthCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Web Storefront Branding",
      description: "An early polished web store extends the brand to shoppers who pay list price.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marketingStrength", flat: 14 },
      ],
    },
    {
      name: "Supplier Diversity Contracts",
      description: "Broad domestic supplier contracts buy goodwill in statehouses and city halls.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Global Sourcing Consolidation",
      description:
        "Direct factory buying worldwide strips importers and brokers from the cost stack.",
      effects: [
        { kind: "inputCost", commodity: "plastics", pct: 0.1 },
        { kind: "inputCost", commodity: "electronics", pct: 0.1 },
      ],
    },
    {
      name: "Personal Shopper Services",
      description:
        "Appointment shopping and registry services turn browsers into full-ticket buyers.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marginBonus", pp: 0.8 },
      ],
    },
    {
      name: "Supercenter Land Bank",
      description: "A pipeline of pre-permitted sites lets supercenters open on schedule anywhere.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "2009": [
    {
      name: "Labor Scheduling Software",
      description: "Demand-based scheduling matches staff hours to traffic curves store by store.",
      effects: [{ kind: "laborCostReduction", pct: 0.05 }],
    },
    {
      name: "Curated Private Collections",
      description: "Design-led private collections earn brand prices without brand royalties.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marginBonus", pp: 0.6 },
      ],
    },
    {
      name: "Marketplace Seller Rules",
      description:
        "Clear third-party seller policies keep counterfeit scandals and subpoenas away.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Ship-from-Store Logistics",
      description: "Every store doubles as a fulfillment node, cutting last-mile freight sharply.",
      effects: [
        { kind: "inputCost", commodity: "freight", pct: 0.12 },
        { kind: "logisticsStrength", flat: 32 },
      ],
    },
    {
      name: "Search and Social Advertising",
      description: "Targeted digital campaigns reach buyers at the moment of intent.",
      effects: [
        { kind: "marketingStrength", flat: 36 },
        { kind: "priceRealization", pct: 0.02 },
      ],
    },
    {
      name: "Urban Small-Format Push",
      description: "Compact city formats slip into dense markets the big boxes could never enter.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "2019": [
    {
      name: "Electronic Shelf Labels",
      description: "Digital shelf tags end weekly relabeling and let prices update centrally.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Retail Media Sponsorships",
      description:
        "Selling ad space on owned screens and pages turns traffic into a second revenue line.",
      effects: [
        { kind: "priceRealization", pct: 0.014 },
        { kind: "marketingStrength", flat: 15 },
      ],
    },
    {
      name: "Data Privacy Certification",
      description:
        "Certified data handling keeps loyalty programs running as privacy laws tighten.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Automated Micro-Warehouses",
      description:
        "Robotic mini-warehouses behind stores pick online orders at a fraction of the labor.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "inputCost", commodity: "freight", pct: 0.1 },
      ],
    },
    {
      name: "Livestream Shopping Events",
      description: "Hosted live selling events move premium stock at full price in minutes.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Nearshored Supply Base",
      description:
        "Shifting sourcing to nearby countries dodges tariff rounds and shipping crises.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "2029": [
    {
      name: "Computer Vision Shrink Control",
      description: "Camera analytics cut theft and scan errors without adding a single guard.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "energy", pct: 0.05 },
      ],
    },
    {
      name: "Agentic Shopping Placement",
      description:
        "Paying to be the default choice of shopping assistants captures orders before search.",
      effects: [
        { kind: "priceRealization", pct: 0.015 },
        { kind: "marketingStrength", flat: 16 },
      ],
    },
    {
      name: "Algorithmic Pricing Compliance",
      description: "Audited pricing algorithms preempt collusion probes aimed at the industry.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Autonomous Delivery Fleets",
      description: "Driverless vans and sidewalk robots collapse the cost of the last mile.",
      effects: [
        { kind: "inputCost", commodity: "freight", pct: 0.14 },
        { kind: "logisticsStrength", flat: 34 },
      ],
    },
    {
      name: "Immersive Brand Flagships",
      description:
        "Mixed-reality flagship experiences make the store a destination that sells at full price.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marketingStrength", flat: 32 },
      ],
    },
    {
      name: "Resilient Commerce Charter",
      description:
        "Disaster-supply agreements with governments protect operations in any crisis or crackdown.",
      effects: [
        { kind: "dominanceShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
};
