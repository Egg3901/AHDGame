import type { V3LaneContent } from "./types";

/** v3 slots 10-15: corporate specializations and capstones per decade. */
export const CORPORATE_V3: V3LaneContent = {
  "1940": [
    {
      name: "Shift Scheduling Boards",
      description: "Round-the-clock shift rotations keep plants staffed and hold labor costs down.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "War Bond Tie-In Campaigns",
      description:
        "Patriotic advertising tied to the war effort lifts brand standing and pricing power.",
      effects: [
        { kind: "marketingStrength", flat: 12 },
        { kind: "priceRealization", pct: 0.01 },
      ],
    },
    {
      name: "Priority Ratings Liaison",
      description:
        "A dedicated office works allocation boards so contracts and permits clear faster.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Continuous Operations Doctrine",
      description:
        "Plants run every hour of the war with relief crews and staggered maintenance windows.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Home Front Brand Trust",
      description:
        "Years of wartime goodwill campaigns leave the company a household name it can price on.",
      effects: [
        { kind: "marketingStrength", flat: 28 },
        { kind: "priceRealization", pct: 0.02 },
      ],
    },
    {
      name: "Essential Industry Status",
      description:
        "Official designation as vital to the war effort shields the firm from political attack.",
      effects: [
        { kind: "dominanceShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1950": [
    {
      name: "Work Simplification Programs",
      description: "Trained supervisors strip wasted motion from every job on the floor.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Suburban Market Research",
      description:
        "Door-to-door surveys of the new suburbs sharpen what the company charges and to whom.",
      effects: [
        { kind: "marketingStrength", flat: 14 },
        { kind: "priceRealization", pct: 0.012 },
      ],
    },
    {
      name: "Trade Association Membership",
      description: "Seats on industry associations give early warning of tariffs and regulation.",
      effects: [
        { kind: "tariffShield", pct: 0.1 },
        { kind: "dominanceShield", pct: 0.08 },
      ],
    },
    {
      name: "Standard Work Institute",
      description:
        "An in-house training institute makes efficient practice the default at every site.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "National Brand Campaigns",
      description:
        "Coordinated print, radio and billboard buys make the brand known coast to coast.",
      effects: [
        { kind: "marketingStrength", flat: 30 },
        { kind: "priceRealization", pct: 0.02 },
      ],
    },
    {
      name: "Washington Relations Office",
      description:
        "A permanent capital office keeps the company on the right side of hearings and tariffs.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Corporate Motor Pool Dispatch",
      description:
        "Central dispatch of trucks and freight bookings cuts idle miles across the company.",
      effects: [{ kind: "logisticsStrength", flat: 14 }],
    },
    {
      name: "Market Segmentation Studies",
      description:
        "Splitting customers into segments lets each product line charge what its buyers will pay.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Regional Subsidiary Charters",
      description:
        "Locally chartered subsidiaries make new plants cheaper to open and easier to approve.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Total Distribution Cost Analysis",
      description:
        "Treating freight, warehousing and inventory as one cost reveals savings no department saw alone.",
      effects: [
        { kind: "logisticsStrength", flat: 30 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Flagship Brand Architecture",
      description:
        "A disciplined brand hierarchy lets premium lines carry premium prices without confusing buyers.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Conglomerate Holding Structure",
      description:
        "A diversified holding company spreads political risk and finances entry into new markets.",
      effects: [
        { kind: "dominanceShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1970": [
    {
      name: "Energy Audit Programs",
      description: "Plant-by-plant energy audits squeeze overhead in an era of expensive fuel.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Consumer Focus Groups",
      description:
        "Structured focus group testing tunes products and copy before a dollar is spent on media.",
      effects: [
        { kind: "marketingStrength", flat: 15 },
        { kind: "priceRealization", pct: 0.01 },
      ],
    },
    {
      name: "Regulatory Compliance Office",
      description:
        "A standing compliance staff turns new safety and environment rules into routine paperwork.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Zero-Base Budgeting",
      description:
        "Every department justifies its budget from zero each year, and overhead stays lean.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "laborCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Lifestyle Brand Positioning",
      description:
        "Selling an identity rather than a product lets the company hold prices through the downturn.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Government Affairs Directorate",
      description:
        "Full-time lobbying and trade casework blunt tariffs and antitrust pressure alike.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1979": [
    {
      name: "Overhead Value Analysis",
      description: "Consultant-led reviews cut staff functions that add cost but not output.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "growthCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Direct Mail Databases",
      description:
        "Mailing lists built from purchase records put offers in front of the buyers most likely to pay.",
      effects: [{ kind: "marketingStrength", flat: 16 }],
    },
    {
      name: "Multinational Tax Structuring",
      description:
        "Holding companies across borders soften tariffs and keep expansion capital moving.",
      effects: [
        { kind: "tariffShield", pct: 0.1 },
        { kind: "expansionDiscount", pct: 0.06 },
      ],
    },
    {
      name: "Lean Headquarters Model",
      description:
        "A stripped-down head office pushes decisions to operators and overhead falls with it.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Premium Line Extensions",
      description:
        "Upmarket versions of proven products capture buyers who will pay more for the same name.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Offshore Assembly Network",
      description:
        "Plants inside key trade blocs put the company on the safe side of any tariff wall.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1989": [
    {
      name: "Just-in-Time Office",
      description:
        "A dedicated team drives supplier deliveries to the hour and inventory carrying costs fall.",
      effects: [{ kind: "logisticsStrength", flat: 16 }],
    },
    {
      name: "Category Management",
      description:
        "Managing whole product categories with retailers wins shelf placement and steadier prices.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Joint Venture Playbook",
      description:
        "Standard joint venture terms make entering protected foreign markets fast and cheap.",
      effects: [{ kind: "expansionDiscount", pct: 0.1 }],
    },
    {
      name: "Total Quality Management",
      description: "Company-wide quality circles cut rework and scrap out of every process.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Global Brand Licensing",
      description:
        "Licensing the brand across markets and merchandise turns the name itself into revenue.",
      effects: [
        { kind: "marketingStrength", flat: 32 },
        { kind: "priceRealization", pct: 0.022 },
      ],
    },
    {
      name: "Trade Bloc Manufacturing",
      description:
        "Final assembly inside each major trade bloc makes the firm nearly tariff-proof.",
      effects: [
        { kind: "tariffShield", pct: 0.22 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1999": [
    {
      name: "Shared Services Centers",
      description:
        "Consolidating payroll, billing and IT into shared centers strips duplicate staff cost.",
      effects: [{ kind: "laborCostReduction", pct: 0.05 }],
    },
    {
      name: "Dot-Com Brand Launch",
      description: "An early, polished web brand reaches customers rivals still serve by catalog.",
      effects: [
        { kind: "marketingStrength", flat: 18 },
        { kind: "priceRealization", pct: 0.01 },
      ],
    },
    {
      name: "Cross-Border M&A Desk",
      description:
        "An in-house deal team makes acquiring capacity abroad cheaper than building it.",
      effects: [{ kind: "expansionDiscount", pct: 0.1 }],
    },
    {
      name: "Global Process Outsourcing",
      description: "Back office work moves to lowest-cost locations worldwide and stays there.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "One-to-One Marketing",
      description:
        "Personalized offers built from customer databases lift both response rates and prices paid.",
      effects: [
        { kind: "marketingStrength", flat: 32 },
        { kind: "priceRealization", pct: 0.024 },
      ],
    },
    {
      name: "WTO Market Access Strategy",
      description: "Treaty-savvy counsel opens newly liberalized markets ahead of the competition.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2009": [
    {
      name: "Procurement Reverse Auctions",
      description: "Suppliers bid against each other online and input contracts settle lower.",
      effects: [{ kind: "growthCostReduction", pct: 0.035 }],
    },
    {
      name: "Search Engine Marketing",
      description:
        "Paid search puts the company at the top of results at the moment customers decide.",
      effects: [
        { kind: "marketingStrength", flat: 18 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Emerging Market Partnerships",
      description:
        "Local partners in fast-growing economies cut the cost and friction of new plants.",
      effects: [{ kind: "expansionDiscount", pct: 0.1 }],
    },
    {
      name: "Global Supply Chain Control Tower",
      description:
        "One screen tracks every shipment worldwide and reroutes around delays in real time.",
      effects: [
        { kind: "logisticsStrength", flat: 34 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Omnichannel Brand Experience",
      description:
        "Store, web and mobile present one seamless brand and customers pay full price for it.",
      effects: [
        { kind: "marketingStrength", flat: 30 },
        { kind: "priceRealization", pct: 0.024 },
      ],
    },
    {
      name: "Regulatory Arbitrage Portfolio",
      description:
        "Operations spread across friendly jurisdictions keep any one government from squeezing the firm.",
      effects: [
        { kind: "dominanceShield", pct: 0.2 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "2019": [
    {
      name: "Workflow Automation Suites",
      description:
        "Low-code automation clears routine approvals and paperwork without adding headcount.",
      effects: [{ kind: "laborCostReduction", pct: 0.05 }],
    },
    {
      name: "Influencer Partnerships",
      description: "Paid creators put the product in front of audiences that skip traditional ads.",
      effects: [
        { kind: "marketingStrength", flat: 18 },
        { kind: "priceRealization", pct: 0.012 },
      ],
    },
    {
      name: "Supply Chain Dual Sourcing",
      description:
        "Qualified backup suppliers on every input keep trade disputes from stopping the line.",
      effects: [{ kind: "tariffShield", pct: 0.11 }],
    },
    {
      name: "Machine Learning Operations",
      description:
        "Models tune staffing, maintenance and purchasing decisions across the whole company.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.07 },
      ],
    },
    {
      name: "Direct-to-Consumer Platform",
      description:
        "Selling direct captures the retail margin and the customer relationship in one move.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Friendshoring Network",
      description:
        "Production concentrated in allied countries keeps sanctions and tariff wars at arm's length.",
      effects: [
        { kind: "tariffShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
  "2029": [
    {
      name: "Autonomous Freight Corridors",
      description:
        "Driverless trucks on dedicated corridors move goods around the clock at lower cost.",
      effects: [
        { kind: "logisticsStrength", flat: 18 },
        { kind: "growthCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Synthetic Media Studios",
      description:
        "Generated video and voice produce tailored campaigns for every market overnight.",
      effects: [{ kind: "marketingStrength", flat: 20 }],
    },
    {
      name: "Algorithmic Compliance Engine",
      description:
        "Software reads every jurisdiction's rules and files before regulators come asking.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Lights-Out Administration",
      description: "AI agents run the back office end to end with a small human oversight team.",
      effects: [
        { kind: "laborCostReduction", pct: 0.1 },
        { kind: "growthCostReduction", pct: 0.07 },
      ],
    },
    {
      name: "Personal Pricing Agents",
      description:
        "Negotiation agents settle a price with each buyer and leave little money on the table.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Sovereign Cloud Footprint",
      description:
        "Data and operations mirrored in every major bloc satisfy any government that wants them local.",
      effects: [
        { kind: "dominanceShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.16 },
      ],
    },
  ],
};
