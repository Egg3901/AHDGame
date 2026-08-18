import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for the financial lane. */
export const FINANCIAL_V3: V3LaneContent = {
  "1940": [
    {
      name: "Payroll Allotment Banking",
      description:
        "Automatic payroll deductions bring in wartime deposits with almost no teller work.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Trust Client Referrals",
      description:
        "Officers court estates and war contractors, moving accounts into higher fee tiers.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Regulator Liaison Office",
      description:
        "A standing desk for examiners keeps the bank in good standing when rules tighten.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Central Proof Departments",
      description:
        "One proof room clears checks for every branch, cutting duplicated back-office staff.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "War Finance Prestige",
      description: "Bond drive leadership makes the bank the trusted name for premium accounts.",
      effects: [
        { kind: "priceRealization", pct: 0.02 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Charter Defense Counsel",
      description: "Retained counsel wins branch charters and blunts hostile hearings.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1950": [
    {
      name: "Punched Card Ledgers",
      description: "Tabulating machines post accounts overnight and shrink the bookkeeping floor.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Personal Banker Programs",
      description: "Named bankers for affluent households justify higher service charges.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "inputCost", commodity: "consulting_services", pct: 0.05 },
      ],
    },
    {
      name: "Suburban Branch Push",
      description: "Standard branch blueprints follow customers out to the new suburbs cheaply.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Unit Record Automation",
      description: "End-to-end card processing turns clerical departments into machine rooms.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "inputCost", commodity: "consulting_services", pct: 0.1 },
      ],
    },
    {
      name: "Blue Chip Advisory Desks",
      description: "Full advisory relationships with corporate treasurers command premium fees.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Holding Company Structure",
      description:
        "A holding company shell adds branches across county lines and shields the charter.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Batch Processing Centers",
      description: "Mainframe batch runs settle the day's business with a fraction of the clerks.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "outputRate", commodity: "financial_services", pct: 0.03 },
      ],
    },
    {
      name: "Charge Account Upselling",
      description: "Revolving credit lines attached to checking accounts lift income per customer.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Interstate Compact Lobbying",
      description: "Quiet work on state compacts opens new markets before rivals arrive.",
      effects: [
        { kind: "expansionDiscount", pct: 0.07 },
        { kind: "dominanceShield", pct: 0.08 },
      ],
    },
    {
      name: "Online Teller Terminals",
      description: "Terminals wired to the mainframe post transactions live and end double entry.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "outputRate", commodity: "financial_services", pct: 0.07 },
      ],
    },
    {
      name: "Premium Card Franchises",
      description: "A prestige card brand with travel perks locks in high-margin cardholders.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Multistate Bank Network",
      description:
        "Affiliate banks in neighboring states spread the franchise and the political risk.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1970": [
    {
      name: "Automated Clearing House",
      description: "Electronic debits and credits replace truckloads of paper checks.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "growthCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Cash Management Sales Force",
      description: "Treasury products sold to corporates carry fees ordinary deposits never could.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Offshore Booking Centers",
      description: "Nassau and London booking desks keep lending outside restrictive caps.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Item Processing Consolidation",
      description:
        "Regional processing hubs run three shifts and cut unit cost per item to pennies.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Merchant Banking Franchise",
      description:
        "Advisory mandates and syndication lead roles put the bank at the top of fee tables.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "outputRate", commodity: "financial_services", pct: 0.06 },
      ],
    },
    {
      name: "Global Booking Network",
      description: "A lattice of offshore entities makes the balance sheet hard to cap or tax.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1979": [
    {
      name: "Shared ATM Consortia",
      description: "Pooled machine networks give customers cash access without staffed branches.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "electronics", pct: 0.05 },
      ],
    },
    {
      name: "Rate Tiering Desks",
      description:
        "Deposit and loan pricing tiered by balance captures what each customer will pay.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Deregulation Task Force",
      description: "A team tracking rule changes files first the day each restriction falls.",
      effects: [
        { kind: "dominanceShield", pct: 0.09 },
        { kind: "expansionDiscount", pct: 0.06 },
      ],
    },
    {
      name: "Self-Service Banking Floors",
      description: "Lobby machines handle routine business and tellers shrink to exception desks.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "inputCost", commodity: "electronics", pct: 0.1 },
      ],
    },
    {
      name: "Yield Product Engineering",
      description: "NOW accounts, sweeps and money desks price every idle dollar at market.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "outputRate", commodity: "financial_services", pct: 0.06 },
      ],
    },
    {
      name: "Nonbank Subsidiary Web",
      description: "Finance, leasing and insurance arms operate where bank rules cannot reach.",
      effects: [
        { kind: "dominanceShield", pct: 0.17 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1989": [
    {
      name: "Back-Office Offsites",
      description: "Operations move from marble headquarters to cheap campuses in low-cost states.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "real_estate_services", pct: 0.05 },
      ],
    },
    {
      name: "Relationship Pricing Models",
      description: "Bundled pricing across the whole relationship raises fee capture per client.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Interstate Acquisition Play",
      description: "Buying weakened thrifts turns each regional crisis into cheap market entry.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Consolidated Operations Hubs",
      description: "One national operations center replaces dozens of state back offices.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Proprietary Trading Floors",
      description: "House trading desks and structured books earn spreads no branch ever saw.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "financial_services", pct: 0.07 },
      ],
    },
    {
      name: "Superregional Rollup",
      description: "Serial mergers build a footprint big enough that regulators plan around it.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "1999": [
    {
      name: "Call Center Migration",
      description: "Phone banking centers absorb routine service work from expensive branches.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "software", pct: 0.05 },
      ],
    },
    {
      name: "Wealth Segment Branding",
      description: "Private client tiers with dedicated advisors carry advisory-level margins.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Financial Holding Charter",
      description:
        "A modern holding charter lets banking, securities and insurance sit under one roof.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Web Self-Service Rollout",
      description: "Customers key their own transactions online and cost per account collapses.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "inputCost", commodity: "software", pct: 0.11 },
      ],
    },
    {
      name: "Universal Bank Cross-Sell",
      description: "Every client sees lending, markets and wealth products in one pitch book.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Global Passporting",
      description:
        "Licenses in every major market let capital land wherever rules are friendliest.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "2009": [
    {
      name: "Straight-Through Exceptions",
      description: "Only broken trades touch human hands; everything else settles itself.",
      effects: [
        { kind: "laborCostReduction", pct: 0.05 },
        { kind: "outputRate", commodity: "financial_services", pct: 0.03 },
      ],
    },
    {
      name: "Fee Transparency Repricing",
      description:
        "Clean, published pricing wins back trust and defends fee income after the crash.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Stress Test Readiness",
      description: "Capital plans that pass every scenario keep supervisors and raiders at bay.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Utility Operations Model",
      description: "Shared industry utilities run settlement and custody at marginal cost.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.07 },
      ],
    },
    {
      name: "Flow Franchise Dominance",
      description: "Being first call for every large order lets the desk price the whole market.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "financial_services", pct: 0.08 },
      ],
    },
    {
      name: "Living Will Architecture",
      description:
        "Cleanly separable entities satisfy resolution rules and unlock foreign approvals.",
      effects: [
        { kind: "dominanceShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "2019": [
    {
      name: "Robotic Process Automation",
      description:
        "Software bots grind through reconciliation queues that once needed whole floors.",
      effects: [
        { kind: "laborCostReduction", pct: 0.05 },
        { kind: "inputCost", commodity: "software", pct: 0.06 },
      ],
    },
    {
      name: "Subscription Banking Tiers",
      description: "Flat monthly plans convert unpredictable fees into steady premium revenue.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Banking-as-a-Service Rails",
      description: "White-label rails put the balance sheet behind other brands in new markets.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Cloud Core Migration",
      description:
        "Retiring the mainframe core cuts run cost and makes new products cheap to launch.",
      effects: [
        { kind: "growthCostReduction", pct: 0.07 },
        { kind: "inputCost", commodity: "software", pct: 0.12 },
      ],
    },
    {
      name: "Data-Driven Wealth Pricing",
      description:
        "Behavioral pricing engines quote each client the rate the relationship supports.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Embedded Finance Network",
      description: "Finance embedded in commerce platforms grows deposits without opening a door.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "2029": [
    {
      name: "Agentic Back Office",
      description: "AI agents run reconciliation, disputes and reporting end to end.",
      effects: [
        { kind: "laborCostReduction", pct: 0.05 },
        { kind: "outputRate", commodity: "financial_services", pct: 0.04 },
      ],
    },
    {
      name: "Outcome-Priced Advice",
      description: "Advisory fees indexed to client outcomes command a durable premium.",
      effects: [{ kind: "priceRealization", pct: 0.015 }],
    },
    {
      name: "Programmable Compliance",
      description: "Rules encoded as software satisfy any jurisdiction's regime at deploy time.",
      effects: [
        { kind: "tariffShield", pct: 0.08 },
        { kind: "dominanceShield", pct: 0.08 },
      ],
    },
    {
      name: "Autonomous Settlement Mesh",
      description: "Machine-to-machine settlement clears in seconds at near-zero marginal cost.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "outputRate", commodity: "financial_services", pct: 0.08 },
      ],
    },
    {
      name: "Sovereign-Grade Custody",
      description: "Custody trusted by treasuries and funds prices at the very top of the market.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Multi-Jurisdiction Ledger",
      description: "One ledger recognized in every bloc keeps capital moving through any embargo.",
      effects: [
        { kind: "tariffShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
};
