import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for technology: entries (0-2) and capstones (3-5) per decade. */
export const TECHNOLOGY_V3: V3LaneContent = {
  "1940": [
    {
      name: "Tube Yield Improvement",
      description: "Tighter glasswork and testing raise usable tubes per production batch.",
      effects: [{ kind: "outputRate", commodity: "electronics", pct: 0.04 }],
    },
    {
      name: "Signal Corps Reputation",
      description: "A record of reliable military gear lets the firm quote above commodity rates.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Classified Contract Clearance",
      description: "Security-cleared facilities win restricted work rivals cannot bid on.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Assembly Jig Standardization",
      description:
        "Fixtured chassis wiring lets semi-skilled crews build sets at engineer quality.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "outputRate", commodity: "electronics", pct: 0.06 },
      ],
    },
    {
      name: "Proximity Fuze Prestige",
      description: "Famous precision war work becomes the sales pitch for every postwar product.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Federal Laboratory Ties",
      description: "Standing relationships with government labs channel funded work to new sites.",
      effects: [
        { kind: "expansionDiscount", pct: 0.14 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "1950": [
    {
      name: "Germanium Purification",
      description: "In-house refining lifts transistor yields and cuts scrapped material.",
      effects: [{ kind: "inputCost", commodity: "rare_earth", pct: 0.06 }],
    },
    {
      name: "Hi-Fi Consumer Lines",
      description: "Living-room audio sells laboratory engineering at department-store prices.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Patent Cross-Licensing",
      description: "Broad license swaps keep the firm free to build while rivals litigate.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Automated Component Insertion",
      description: "Machines place and solder components, replacing rows of hand-assembly benches.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "outputRate", commodity: "electronics", pct: 0.07 },
      ],
    },
    {
      name: "Computing Showcase Installations",
      description:
        "Flagship mainframe installations at famous customers set the price for everyone else.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Campus Research Parks",
      description: "University-adjacent labs recruit talent and open new sites at subsidized cost.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Planar Process Discipline",
      description: "Photolithographic batch fabrication drops the cost of every circuit produced.",
      effects: [{ kind: "growthCostReduction", pct: 0.035 }],
    },
    {
      name: "Aerospace Grade Certification",
      description: "Space-rated qualification lets components command program-level prices.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Second Source Agreements",
      description: "Licensed second sources make the firm's designs the safe standard to specify.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Wafer Batch Scaling",
      description: "Larger wafers and tighter process control multiply chips per fabrication run.",
      effects: [
        { kind: "outputRate", commodity: "electronics", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Unbundled Software Pricing",
      description: "Charging separately for programs turns software into its own premium product.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "outputRate", commodity: "software", pct: 0.06 },
      ],
    },
    {
      name: "Offshore Assembly Pioneering",
      description: "Early overseas assembly plants dodge cost pressure and future trade friction.",
      effects: [
        { kind: "expansionDiscount", pct: 0.14 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "1970": [
    {
      name: "Calculator Chip Volume",
      description: "High-volume calculator parts drive down unit cost across the whole fab.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Turnkey Systems Bundles",
      description: "Hardware, software and support sold together price far above parts.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Standards Committee Seats",
      description:
        "Writing the interface standards keeps the market shaped around the firm's parts.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "MOS Process Leadership",
      description: "Denser MOS lines put more circuitry on each wafer at lower power and cost.",
      effects: [
        { kind: "outputRate", commodity: "electronics", pct: 0.08 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "Enterprise Account Teams",
      description:
        "Dedicated teams inside big customers make the firm's stack the default purchase.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "International Sales Subsidiaries",
      description: "Wholly owned country subsidiaries sell direct in every major economy.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1979": [
    {
      name: "Automated Wafer Handling",
      description: "Robotic wafer transport lifts fab throughput and cuts contamination losses.",
      effects: [{ kind: "outputRate", commodity: "electronics", pct: 0.05 }],
    },
    {
      name: "Branded Personal Computers",
      description: "A consumer brand on the box sells silicon at retail prices, not parts prices.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Killer App Exclusives",
      description: "Must-have software locked to the platform makes the hardware the safe choice.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Steppers and Yield Engineering",
      description: "Projection steppers and defect tracking push good die per wafer to new highs.",
      effects: [
        { kind: "outputRate", commodity: "electronics", pct: 0.09 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Software Publisher Margins",
      description: "Shrink-wrapped programs duplicate at almost no cost and sell at list price.",
      effects: [
        { kind: "outputRate", commodity: "software", pct: 0.08 },
        { kind: "priceRealization", pct: 0.022 },
      ],
    },
    {
      name: "Fab Consortium Stakes",
      description: "Shared fabrication ventures spread capital risk across partners and borders.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "1989": [
    {
      name: "Fabless Design Shift",
      description: "Contracting out fabrication turns fixed plant cost into variable cost.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Ingredient Branding",
      description: "A logo on every machine sells the component brand straight to end buyers.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Platform Lock-In",
      description: "File formats and APIs make leaving the ecosystem costlier than staying.",
      effects: [{ kind: "dominanceShield", pct: 0.12 }],
    },
    {
      name: "Six-Inch Fab Conversion",
      description: "Bigger wafers and cleaner rooms multiply output from every fabrication line.",
      effects: [
        { kind: "outputRate", commodity: "electronics", pct: 0.09 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "Suite Bundling Strategy",
      description:
        "Bundled office applications price as one premium product and crowd out point tools.",
      effects: [
        { kind: "outputRate", commodity: "software", pct: 0.07 },
        { kind: "priceRealization", pct: 0.024 },
      ],
    },
    {
      name: "Global Developer Programs",
      description:
        "Funded developer networks in every region make each new market arrive pre-built.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "dominanceShield", pct: 0.18 },
      ],
    },
  ],
  "1999": [
    {
      name: "Server Farm Efficiency",
      description: "Commodity servers and airflow design cut the power bill per computation.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.07 }],
    },
    {
      name: "Dot-Com Brand Building",
      description: "A household web brand lets an unprofitable product command premium terms.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Network Effect Moats",
      description: "Each new user makes the service more valuable and harder to displace.",
      effects: [{ kind: "dominanceShield", pct: 0.12 }],
    },
    {
      name: "Offshore Development Centers",
      description: "Round-the-clock engineering across time zones halves the cost of a release.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "outputRate", commodity: "software", pct: 0.07 },
      ],
    },
    {
      name: "Search Advertising Auctions",
      description: "Auction-priced placement monetizes attention at margins retail never saw.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Acquisition Pipeline",
      description: "A standing deal team folds promising startups in before they become rivals.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.18 },
      ],
    },
  ],
  "2009": [
    {
      name: "Hyperscale Data Centers",
      description: "Warehouse-scale computing drives cost per served request toward zero.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.07 },
        { kind: "growthCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "App Store Revenue Share",
      description: "A platform cut of every third-party sale prices distribution itself.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Patent Portfolio Defense",
      description: "A deep patent arsenal deters suits and keeps products shipping.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Continuous Deployment Culture",
      description: "Automated pipelines ship code daily with a fraction of the release staff.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "outputRate", commodity: "software", pct: 0.08 },
      ],
    },
    {
      name: "Premium Device Ecosystem",
      description: "Hardware, services and accessories sold as one system carry luxury margins.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marketingStrength", flat: 32 },
      ],
    },
    {
      name: "Regional Cloud Zones",
      description: "In-country data centers satisfy local law and open regulated markets.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "2019": [
    {
      name: "Custom Silicon Programs",
      description: "In-house chips tuned to the workload cut bought-in component spend.",
      effects: [{ kind: "inputCost", commodity: "electronics", pct: 0.07 }],
    },
    {
      name: "Subscription Everything",
      description: "Perpetual licenses become monthly plans with steadier, higher lifetime prices.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Data Residency Compliance",
      description:
        "Meeting every privacy regime early keeps services legal where rivals get banned.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "ML-Assisted Operations",
      description: "Models handle support, testing and infrastructure tuning with minimal staff.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "outputRate", commodity: "software", pct: 0.07 },
      ],
    },
    {
      name: "Developer Mindshare Flywheel",
      description: "Free tiers and famous tooling make the platform the default for a generation.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Sovereign Cloud Contracts",
      description:
        "Government-dedicated regions win public sector work sealed off from competitors.",
      effects: [
        { kind: "dominanceShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "2029": [
    {
      name: "Inference Cost Engineering",
      description: "Quantized models and scheduling squeeze more answers from every megawatt.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.08 }],
    },
    {
      name: "Frontier Model Licensing",
      description: "Access to the strongest models prices like infrastructure, not software.",
      effects: [{ kind: "priceRealization", pct: 0.015 }],
    },
    {
      name: "Compute Export Navigation",
      description: "Compliant chip supply chains keep sales open under tightening export rules.",
      effects: [{ kind: "tariffShield", pct: 0.12 }],
    },
    {
      name: "Self-Maintaining Codebases",
      description: "Agent teams write, test and patch software with a small human review layer.",
      effects: [
        { kind: "laborCostReduction", pct: 0.1 },
        { kind: "outputRate", commodity: "software", pct: 0.09 },
      ],
    },
    {
      name: "Personal AI Relationships",
      description: "Assistants users trust daily carry pricing power no app ever had.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marketingStrength", flat: 32 },
      ],
    },
    {
      name: "National Compute Partnerships",
      description: "Co-funded national AI infrastructure makes the firm a strategic asset.",
      effects: [
        { kind: "dominanceShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
};
