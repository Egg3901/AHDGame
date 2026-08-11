/**
 * Sector tech-tree node content (v2 — branching lanes).
 *
 * Each decade tier forks into two lanes:
 *  - **generic** (Corporate): shared across all 17 sectors, authored once below;
 *  - **sector** (Specialist): unique to each sector type.
 *
 * Each lane has up to 5 unique nodes per decade. The CEO commits to ONE lane per
 * decade (first unlock commits); switching requires abandoning that decade. Some
 * nodes carry an `unlockStrategy` effect that makes a production method
 * (SECTOR_STRATEGIES entry) available — modern methods stay locked until then.
 *
 * Cost model: rdScore cost is ~1/6 of v1 (nodes are cheaper but plural), and
 * unlocking also debits cash as a fraction of the corp's daily gross revenue
 * (TECH_NODE_CASH_REVENUE_FRACTION, optionally overridden per node).
 *
 * Tier ART is shared per (lane, sector, decade) — resolved in ./images.ts, not
 * stored on the node.
 */

import { CORPORATION_TYPES, type CorporationType } from "../corporations";
import type { TechEffect } from "./effects";
import { TECH_DECADES } from "./decades";
import { SECTOR_EARLY_FILL } from "./earlySectorFill";

export type TechLane = "generic" | "sector";

export interface TechTreeNode {
  /** `corp-<decade>-<slot>` (generic) or `<sectorType>-<decade>-<slot>` (sector). */
  id: string;
  decadeId: string;
  lane: TechLane;
  /** 1-based position within the lane for this decade. */
  slot: number;
  name: string;
  description: string;
  /** rdScore spent to unlock. */
  cost: number;
  /** Per-node override of the cash cost fraction (of daily gross revenue). */
  cashRevenueFraction?: number;
  effects: TechEffect[];
}

/** Authoring shape for a single node (id/decade/lane/slot are derived). */
interface NodeSpec {
  name: string;
  description: string;
  effects: TechEffect[];
  cashRevenueFraction?: number;
}

/** rdScore cost per decade tier — ~1/6 of v1 (40/55/70/85/100/120). */
const DECADE_COST: Record<string, number> = {
  "1940": 6,
  "1950": 8,
  "1960": 10,
  "1970": 14,
  "1979": 16,
  "1989": 22,
  "1999": 30,
  "2009": 38,
  "2019": 48,
  "2029": 60,
};

export function corpNodeId(decadeId: string, slot: number): string {
  return `corp-${decadeId}-${slot}`;
}

export function sectorNodeId(sectorType: CorporationType, decadeId: string, slot: number): string {
  return `${sectorType}-${decadeId}-${slot}`;
}

// ─── Corporate lane (shared across every sector) ─────────────────────────────
// Five distinct business functions per decade: automation, info systems,
// marketing/brand, analytics/finance, and ops/logistics.
const CORPORATE: Record<string, NodeSpec[]> = {
  "1940": [
    {
      name: "Assembly Line Management",
      description: "Mass-production scheduling disciplines cut per-unit overhead.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "Wartime Supply Chain",
      description: "Priority routing and rationing disciplines harden logistics.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Radio Advertising",
      description: "National radio campaigns reach mass consumer audiences.",
      effects: [{ kind: "marketingStrength", flat: 20 }],
    },
    {
      name: "Standard Cost Accounting",
      description: "Factory cost standards sharpen pricing and budget discipline.",
      effects: [{ kind: "marginBonus", pp: 0.5 }],
    },
    {
      name: "Labor Efficiency Programs",
      description: "Time-and-motion studies lift worker productivity.",
      effects: [{ kind: "logisticsStrength", flat: 10 }],
    },
  ],
  "1950": [
    {
      name: "Management by Objectives",
      description: "Goal-setting frameworks align departments to financial targets.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "Batch Data Processing",
      description: "Early mainframe computing automates large-scale back-office work.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Television Advertising",
      description: "TV spots reach mass consumer markets at scale.",
      effects: [{ kind: "marketingStrength", flat: 25 }],
    },
    {
      name: "Operations Research",
      description: "Quantitative methods optimize scheduling and allocation.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "Corporate Organizational Design",
      description: "Divisional structures clarify accountability and decision rights.",
      effects: [{ kind: "logisticsStrength", flat: 12 }],
    },
  ],
  "1960": [
    {
      name: "Long-Range Corporate Planning",
      description: "Five-year plans align investment with strategy.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "IBM Mainframe Adoption",
      description: "Business computing automates accounting and payroll at scale.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Brand Management Systems",
      description: "Structured brand architecture builds equity across product lines.",
      effects: [{ kind: "marketingStrength", flat: 30 }],
    },
    {
      name: "Divisional P&L Accounting",
      description: "Decentralized profit centers sharpen operating discipline.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "National Distribution Networks",
      description: "Interstate infrastructure enables nationwide market reach.",
      effects: [{ kind: "logisticsStrength", flat: 15 }],
    },
  ],
  "1970": [
    {
      name: "MRP Production Planning",
      description: "Material requirements planning cuts waste and idle inventory.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Minicomputer Administration",
      description: "Departmental minis automate mid-tier data and reporting tasks.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "Mass Market Advertising",
      description: "Primetime TV slots command consumer attention at scale.",
      effects: [{ kind: "marketingStrength", flat: 25 }],
    },
    {
      name: "Portfolio Management Theory",
      description: "Diversification and risk models sharpen capital allocation.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "Containerization Adoption",
      description: "ISO containers slash intermodal handling cost worldwide.",
      effects: [{ kind: "logisticsStrength", flat: 15 }],
    },
  ],
  "1979": [
    {
      name: "Mainframe Accounting",
      description: "Batch back-office automation trims clerical overhead.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "Inventory Control Systems",
      description: "Computerized stock tracking cuts waste and carrying cost.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Corporate Telephony (PBX)",
      description: "In-house switchboards widen sales reach and coordination.",
      effects: [{ kind: "marketingStrength", flat: 30 }],
    },
    {
      name: "Time-and-Motion Management",
      description: "Scientific scheduling lifts labor productivity.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "Centralized Procurement",
      description: "Consolidated purchasing wins volume discounts.",
      effects: [{ kind: "logisticsStrength", flat: 15 }],
    },
  ],
  "1989": [
    {
      name: "Local Area Networks",
      description: "Office networking speeds coordination and scaling.",
      effects: [{ kind: "growthCostReduction", pct: 0.05 }],
    },
    {
      name: "Spreadsheet Financial Modeling",
      description: "PC-based modeling tightens budgeting and pricing.",
      effects: [{ kind: "marginBonus", pp: 1.5 }],
    },
    {
      name: "EDI Supply Links",
      description: "Electronic data interchange streamlines suppliers.",
      effects: [{ kind: "logisticsStrength", flat: 20 }],
    },
    {
      name: "Desktop Publishing & Brand",
      description: "In-house design strengthens marketing output.",
      effects: [{ kind: "marketingStrength", flat: 40 }],
    },
    {
      name: "ERP Foundations",
      description: "Integrated resource planning reduces friction.",
      effects: [
        { kind: "marginBonus", pp: 1 },
        { kind: "growthCostReduction", pct: 0.03 },
      ],
    },
  ],
  "1999": [
    {
      name: "Corporate Web Presence",
      description: "A web storefront extends reach at low marginal cost.",
      effects: [{ kind: "marketingStrength", flat: 50 }],
    },
    {
      name: "E-Procurement",
      description: "Online sourcing lowers input and expansion cost.",
      effects: [{ kind: "growthCostReduction", pct: 0.06 }],
    },
    {
      name: "Business Intelligence",
      description: "Data warehousing sharpens operating decisions.",
      effects: [{ kind: "marginBonus", pp: 2 }],
    },
    {
      name: "VoIP & Remote Offices",
      description: "Internet telephony cuts fixed communication cost.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "CRM Platforms",
      description: "Customer relationship management lifts retention.",
      effects: [
        { kind: "marginBonus", pp: 1.5 },
        { kind: "marketingStrength", flat: 20 },
      ],
    },
  ],
  "2009": [
    {
      name: "Cloud Migration",
      description: "Elastic infrastructure lowers fixed cost and speeds scaling.",
      effects: [{ kind: "growthCostReduction", pct: 0.07 }],
    },
    {
      name: "Mobile Workforce",
      description: "Smartphone-enabled staff raise field productivity.",
      effects: [{ kind: "marginBonus", pp: 1.5 }],
    },
    {
      name: "Social Media Marketing",
      description: "Owned social channels amplify brand reach.",
      effects: [{ kind: "marketingStrength", flat: 60 }],
    },
    {
      name: "Big Data Analytics",
      description: "Large-scale analytics squeeze out inefficiency.",
      effects: [{ kind: "marginBonus", pp: 2 }],
    },
    {
      name: "SaaS Operations",
      description: "Subscription tooling trims IT overhead.",
      effects: [{ kind: "growthCostReduction", pct: 0.05 }],
    },
  ],
  "2019": [
    {
      name: "Robotic Process Automation",
      description: "Bots handle repetitive back-office work.",
      effects: [
        { kind: "marginBonus", pp: 2 },
        { kind: "growthCostReduction", pct: 0.04 },
        { kind: "laborCostReduction", pct: 0.1 },
      ],
    },
    {
      name: "Predictive Analytics",
      description: "Forecasting models optimize pricing and supply.",
      effects: [{ kind: "marginBonus", pp: 2.5 }],
    },
    {
      name: "Programmatic Advertising",
      description: "Automated ad buying lifts marketing efficiency.",
      effects: [{ kind: "marketingStrength", flat: 70 }],
    },
    {
      name: "Digital Twin Operations",
      description: "Virtual models de-risk expansion and tuning.",
      effects: [{ kind: "growthCostReduction", pct: 0.06 }],
    },
    {
      name: "Zero-Trust Security",
      description: "Modern security averts costly breaches.",
      effects: [{ kind: "marginBonus", pp: 1.5 }],
    },
  ],
  "2029": [
    {
      name: "Generative AI Back Office",
      description: "AI runs large swaths of operations autonomously.",
      effects: [
        { kind: "marginBonus", pp: 3 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Autonomous Agents",
      description: "Agentic systems execute multi-step workflows.",
      effects: [{ kind: "growthCostReduction", pct: 0.08 }],
    },
    {
      name: "AI Customer Engagement",
      description: "Generative outreach scales marketing at low cost.",
      effects: [{ kind: "marketingStrength", flat: 90 }],
    },
    {
      name: "Quantum-Assisted Optimization",
      description: "Quantum methods crack hard logistics problems.",
      effects: [{ kind: "marginBonus", pp: 3 }],
    },
    {
      name: "Self-Optimizing Supply Chain",
      description: "Closed-loop AI tunes the network continuously.",
      effects: [
        { kind: "logisticsStrength", flat: 35 },
        { kind: "growthCostReduction", pct: 0.04 },
      ],
    },
  ],
};

// ─── Sector lanes (per sector type) ──────────────────────────────────────────
// Phase 1 authors energy as the working example; remaining 16 sectors are
// authored in Phase 4. Sectors without content expose the Corporate lane only.
const SECTOR: Partial<Record<CorporationType, Record<string, NodeSpec[]>>> = {
  energy: {
    "1940": [
      {
        name: "Wartime Energy Contracts",
        description: "Defense-priority supply contracts guarantee output margins.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Rural Electrification",
        description: "Government grid programs open new consumer markets.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1950": [
      {
        name: "Nuclear Energy Program",
        description: "Early reactor expertise enables high-output nuclear generation.",
        effects: [
          { kind: "unlockStrategy", strategyId: "nuclear" },
          { kind: "marginBonus", pp: 1 },
        ],
      },
      {
        name: "Hydroelectric Expansion",
        description: "Dam capacity adds reliable baseload generation.",
        effects: [{ kind: "outputRate", commodity: "energy", pct: 0.07 }],
      },
    ],
    "1960": [
      {
        name: "Natural Gas Grid",
        description: "Interstate gas pipelines diversify the fuel mix.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "LNG Technology",
        description: "Liquefied gas enables export and peak-load flexibility.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
    ],
    "1970": [
      {
        name: "Offshore Continental Shelf",
        description: "OCS drilling programs expand domestic reserves.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "OPEC Shock Response",
        description: "Efficiency programs hedge against import price shocks.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1979": [
      {
        name: "Enhanced Oil Recovery",
        description: "Secondary recovery wrings more from existing fields.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Refinery Optimization",
        description: "Catalytic upgrades halve crude oil consumed per unit of output.",
        effects: [{ kind: "inputCost", commodity: "oil", pct: 0.5 }],
      },
      {
        name: "Pipeline Network",
        description: "Dedicated pipelines lower transport cost.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
      {
        name: "Coal Plant Scaling",
        description: "Baseload coal capacity raises steady output.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Nuclear Program",
        description: "Reactor expertise opens high-output nuclear generation.",
        effects: [
          { kind: "unlockStrategy", strategyId: "nuclear" },
          { kind: "marginBonus", pp: 1 },
        ],
      },
    ],
    "1989": [
      {
        name: "Combined-Cycle Turbines",
        description: "Gas-and-steam plants raise generating output per plant.",
        effects: [
          { kind: "marginBonus", pp: 1.5 },
          { kind: "outputRate", commodity: "energy", pct: 0.1 },
        ],
      },
      {
        name: "Offshore Platforms",
        description: "Offshore rigs open high-yield reserves.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Grid Interconnects",
        description: "Regional ties improve dispatch and reach.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
      {
        name: "Natural Gas Shift",
        description: "Cleaner gas generation hedges fuel cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Emissions Scrubbers",
        description: "Pollution controls cut regulatory exposure.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
    ],
    "1999": [
      {
        name: "Deepwater Drilling",
        description: "Deep offshore wells reach premium reserves.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "LNG Export",
        description: "Liquefied gas opens global markets.",
        effects: [
          { kind: "marketingStrength", flat: 30 },
          { kind: "marginBonus", pp: 1 },
        ],
      },
      {
        name: "Renewables R&D",
        description: "Early solar and wind capability diversifies output.",
        effects: [
          { kind: "unlockStrategy", strategyId: "renewables" },
          { kind: "marginBonus", pp: 1 },
        ],
      },
      {
        name: "Demand Forecasting",
        description: "Load prediction trims spinning-reserve cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Grid Automation",
        description: "Automated controls raise reliability and margin.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Shale Fracking",
        description: "Horizontal fracking unlocks the high-output Hydraulic Fracturing method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "fracking" },
          { kind: "marginBonus", pp: 2 },
        ],
      },
      {
        name: "Smart Grid",
        description: "Telemetry and demand response unlock smart-grid operations.",
        effects: [
          { kind: "unlockStrategy", strategyId: "smart_grid" },
          { kind: "marginBonus", pp: 1.5 },
        ],
      },
      {
        name: "Utility Solar",
        description: "Large solar farms add fuel-free generating output.",
        effects: [{ kind: "outputRate", commodity: "energy", pct: 0.12 }],
      },
      {
        name: "Battery Pilots",
        description: "Early storage smooths peak pricing.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Wind Farms",
        description: "Onshore wind hedges fuel exposure.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "Utility-Scale Renewables",
        description: "Solar-plus-wind portfolios dominate new capacity.",
        effects: [{ kind: "marginBonus", pp: 3.5 }],
      },
      {
        name: "Grid Storage",
        description: "Large batteries arbitrage price and firm renewables.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
      {
        name: "Carbon Capture",
        description: "CCS keeps thermal assets viable under carbon rules.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "EV Charging Networks",
        description: "Charging infrastructure opens a new demand channel.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Distributed Energy",
        description: "Rooftop and microgrid assets broaden the base.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2029": [
      {
        name: "Fusion Pilots",
        description: "Pilot fusion reactors anchor next-era baseload output.",
        effects: [
          { kind: "unlockStrategy", strategyId: "fusion" },
          { kind: "marginBonus", pp: 2 },
        ],
      },
      {
        name: "Long-Duration Storage",
        description: "Multi-day storage firms an all-renewable grid.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Smart Grid AI",
        description: "AI dispatch maximizes yield across the network.",
        effects: [
          { kind: "marginBonus", pp: 2.5 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Green Hydrogen",
        description: "Electrolytic hydrogen opens industrial offtake.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Autonomous Grid",
        description: "Self-healing automation strips out operating cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
    ],
  },
  technology: {
    "1940": [
      {
        name: "Vacuum Tube Computing",
        description: "Early electronics capabilities open defense and research contracts.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Military Electronics",
        description: "Wartime electronics contracts build deep technical expertise.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1950": [
      {
        name: "Transistor Technology",
        description: "Bell Labs transistors replace vacuum tubes and slash hardware cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Commercial Mainframes",
        description: "UNIVAC-era systems automate large enterprise operations.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1960": [
      {
        name: "Integrated Circuits",
        description: "IC chips shrink hardware cost and raise computational density.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Time-Sharing Systems",
        description: "Multi-user compute maximizes hardware utilization.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1970": [
      {
        name: "Microprocessor Era",
        description: "Intel 4004-generation chips reshape computing economics.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Consumer Electronics",
        description: "Mass-market home electronics open a broad retail channel.",
        effects: [{ kind: "marketingStrength", flat: 35 }],
      },
    ],
    "1979": [
      {
        name: "Microprocessor Fabrication",
        description: "In-house chip fabs capture margin across the stack.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Minicomputers",
        description: "Departmental machines widen the customer base.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Operating Systems",
        description: "Owned OS lowers integration cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Magnetic Storage",
        description: "Disk capacity scaling cuts cost per byte.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Semiconductor Scaling",
        description: "Process shrinks raise yield and margin.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1989": [
      {
        name: "Graphical Computing",
        description: "GUIs broaden the addressable market.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
      {
        name: "Networking Protocols",
        description: "Standard networking eases scaling.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Relational Databases",
        description: "Enterprise data platforms add sticky revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Consumer Software",
        description: "Shrink-wrapped apps build a retail brand.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "RISC Architectures",
        description: "Efficient chips win workstation share.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "Broadband & E-Commerce",
        description: "Always-on access unlocks recurring revenue.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Search & Web Services",
        description: "Web platforms compound at low marginal cost.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
      {
        name: "Open-Source Stack",
        description: "Community software slashes build cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Mobile Devices",
        description: "Handheld hardware opens a new category.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Data Centers",
        description: "Owned compute capacity firms up margins.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.04 },
        ],
      },
    ],
    "2009": [
      {
        name: "Cloud Platforms",
        description: "Elastic platforms capture recurring spend.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
      {
        name: "Smartphones & Apps",
        description: "App ecosystems compound returns.",
        effects: [{ kind: "marginBonus", pp: 3.5 }],
      },
      {
        name: "Social Networks",
        description: "Network effects amplify reach.",
        effects: [{ kind: "marketingStrength", flat: 70 }],
      },
      {
        name: "Virtualization",
        description: "Higher utilization lowers infra cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Big Data",
        description: "Data pipelines monetize scale.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "Machine Learning at Scale",
        description: "Large models become defensible products.",
        effects: [{ kind: "marginBonus", pp: 4 }],
      },
      {
        name: "Edge Computing",
        description: "Distributed compute trims latency cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Cybersecurity Suite",
        description: "Security products add recurring margin.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "SaaS Everywhere",
        description: "Subscription everything lifts retention.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "marketingStrength", flat: 40 },
        ],
      },
      {
        name: "GPU Acceleration",
        description: "Parallel compute powers premium services.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
    "2029": [
      {
        name: "AGI Research",
        description: "Frontier models unlock AI-platform operations.",
        effects: [
          { kind: "unlockStrategy", strategyId: "ai_platforms" },
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.1 },
        ],
      },
      {
        name: "Quantum Computing",
        description: "Quantum advantage unlocks the Quantum Computing production method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "quantum_computing" },
          { kind: "marginBonus", pp: 2.5 },
        ],
      },
      {
        name: "Neuromorphic Chips",
        description: "Brain-like silicon slashes inference cost.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Autonomous Software",
        description: "Self-writing systems collapse build cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Brain-Computer Interfaces",
        description: "Neural products open a frontier market.",
        effects: [{ kind: "marketingStrength", flat: 90 }],
      },
    ],
  },
  manufacturing: {
    "1940": [
      {
        name: "Mass Production Scale",
        description: "Wartime surge expands assembly line capacity and expertise.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Wartime Industrial Surge",
        description: "Defense contracts maximize plant utilization and throughput.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1950": [
      {
        name: "Early Factory Automation",
        description: "Transfer machines reduce manual assembly steps.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Statistical Quality Control",
        description: "Deming-era SQC methods cut defect and rework cost.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
    ],
    "1960": [
      {
        name: "Numerical Control Machines",
        description: "NC lathes and mills raise machining precision.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Plastics Integration",
        description: "Lightweight plastic components cut materials cost.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
    ],
    "1970": [
      {
        name: "Early CNC Systems",
        description: "Computer-guided machining raises throughput and quality.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Industrial Robotics Pilots",
        description: "Programmable arms begin exploring lights-out assembly.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1979": [
      {
        name: "Just-in-Time Production",
        description: "Lean inventory frees working capital.",
        effects: [
          { kind: "marginBonus", pp: 1.5 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Numerical Control",
        description: "NC machines raise precision and rate.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Quality Circles",
        description: "Shop-floor quality cuts defect cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Assembly Automation",
        description: "Automated lines lower labor cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Materials Handling",
        description: "Conveyors and forklifts speed flow.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1989": [
      {
        name: "Robotic Assembly",
        description: "Programmable robots cut labor and trim coal-fired energy input.",
        effects: [
          { kind: "marginBonus", pp: 1.5 },
          { kind: "inputCost", commodity: "coal", pct: 0.3 },
        ],
      },
      {
        name: "CAD/CAM",
        description: "Digital design cuts rework.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Flexible Manufacturing",
        description: "Retoolable cells widen the product mix.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Six Sigma",
        description: "Statistical quality lifts yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Electronics Lines",
        description: "Circuit-board capability sharpens electronics-line margins.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
    ],
    "1999": [
      {
        name: "Global Supply Chains",
        description: "Diversified offshore sourcing blunts tariff exposure.",
        effects: [
          { kind: "marginBonus", pp: 1.5 },
          { kind: "tariffShield", pct: 0.3 },
        ],
      },
      {
        name: "ERP Integration",
        description: "End-to-end planning trims friction.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Lean Six Sigma",
        description: "Combined lean and quality lift margin.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Outsourced Tooling",
        description: "Contract tooling speeds ramp.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Heavy Metals Scale",
        description: "Metals expertise lifts heavy-metals margins.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
    ],
    "2009": [
      {
        name: "Additive Manufacturing",
        description: "Industrial 3D printing unlocks the Additive Manufacturing method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "additive_manufacturing" },
          { kind: "marginBonus", pp: 2 },
        ],
      },
      {
        name: "Industrial Robotics",
        description: "Faster robots raise throughput.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
      {
        name: "Predictive Maintenance",
        description: "Sensor analytics cut downtime.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Composite Materials",
        description: "Advanced materials command premiums.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Nearshoring",
        description: "Closer supply shortens lead times.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2019": [
      {
        name: "Smart Factories (IIoT)",
        description: "Connected sensors lift uptime and yield.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Digital Twins",
        description: "Virtual lines de-risk expansion.",
        effects: [{ kind: "growthCostReduction", pct: 0.07 }],
      },
      {
        name: "Collaborative Robots",
        description: "Cobots flex with demand.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.04 },
        ],
      },
      {
        name: "Advanced Robotics",
        description: "Dexterous robots automate complex tasks.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Supply-Chain Analytics",
        description: "Network optimization lowers logistics cost.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
    ],
    "2029": [
      {
        name: "Lights-Out Plants",
        description: "Fully autonomous lines unlock autonomous manufacturing.",
        effects: [
          { kind: "unlockStrategy", strategyId: "autonomous_factory" },
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.12 },
        ],
      },
      {
        name: "Generative Design",
        description: "AI-designed parts cut weight and waste.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Self-Healing Materials",
        description: "Durable materials lower warranty cost.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Modular Microfactories",
        description: "Distributed micro-plants scale cheaply.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Autonomous Intralogistics",
        description: "Self-driving floor logistics strip cost.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
    ],
  },
  financial: {
    "1940": [
      {
        name: "War Bond Distribution",
        description: "Government bond campaigns build retail customer networks.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
      {
        name: "Regulated Banking Operations",
        description: "Glass-Steagall stability framework reduces systemic risk cost.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
    ],
    "1950": [
      {
        name: "Consumer Credit Expansion",
        description: "Postwar credit and mortgage lending scale retail banking revenue.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Correspondent Banking",
        description: "Interbank partnerships extend geographic reach.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
    ],
    "1960": [
      {
        name: "Credit Card Issuance",
        description: "BankAmericard revolving credit opens a new revenue stream.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Institutional Asset Management",
        description: "Pension and trust mandates build assets under management.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
    "1970": [
      {
        name: "Money Market Funds",
        description: "Rate deregulation and money funds diversify deposit products.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "SWIFT Network Access",
        description: "International wire transfer capability opens cross-border markets.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1979": [
      {
        name: "Electronic Trading Desks",
        description: "Computerized books shrink spreads.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Credit Scoring Models",
        description: "Statistical underwriting cuts losses.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "ATM Networks",
        description: "Self-service banking widens reach.",
        effects: [{ kind: "marketingStrength", flat: 30 }],
      },
      {
        name: "Back-Office Automation",
        description: "Processing automation trims overhead.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Telex Settlement",
        description: "Faster settlement frees capital.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
    ],
    "1989": [
      {
        name: "Derivatives Engineering",
        description: "Quant pricing opens structured products.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Program Trading",
        description: "Automated strategies capture flow.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Securitization",
        description: "Packaged assets free balance sheet.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Global Custody",
        description: "Cross-border custody adds fee income.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
      {
        name: "Risk Models",
        description: "VaR models temper losses.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1999": [
      {
        name: "Online Brokerage",
        description: "Self-serve trading cuts servicing cost.",
        effects: [
          { kind: "marginBonus", pp: 2.5 },
          { kind: "marketingStrength", flat: 40 },
        ],
      },
      {
        name: "Electronic Exchanges",
        description: "ECNs tighten internal spreads.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
      {
        name: "Structured Products",
        description: "Bespoke notes lift fee margin.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Straight-Through Processing",
        description: "Automated settlement lowers cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Internet Banking",
        description: "Online banking infrastructure unlocks fintech operations.",
        effects: [
          { kind: "unlockStrategy", strategyId: "fintech" },
          { kind: "marketingStrength", flat: 50 },
        ],
      },
    ],
    "2009": [
      {
        name: "Algorithmic Execution",
        description: "Low-latency algos unlock the Algorithmic Trading method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "algorithmic_trading" },
          { kind: "marginBonus", pp: 2.5 },
        ],
      },
      {
        name: "HFT Infrastructure",
        description: "Co-located systems win microstructure edge.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.04 },
        ],
      },
      {
        name: "Robo-Advisory",
        description: "Automated advice scales wealth management.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
      {
        name: "Mobile Payments",
        description: "App payments widen the customer base.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
      {
        name: "Cloud Risk Systems",
        description: "Elastic risk compute lowers cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2019": [
      {
        name: "Fintech & Mobile Banking",
        description: "App-first banking trims branch cost.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "marketingStrength", flat: 60 },
        ],
      },
      {
        name: "RegTech Automation",
        description: "Automated compliance lowers overhead.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
      {
        name: "Real-Time Settlement",
        description: "Instant settlement frees liquidity.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Open Banking APIs",
        description: "Platform APIs add fee revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Quant Machine Learning",
        description: "ML signals sharpen execution.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
    ],
    "2029": [
      {
        name: "AI Underwriting",
        description: "AI risk pricing lifts margin and speed.",
        effects: [
          { kind: "marginBonus", pp: 4 },
          { kind: "growthCostReduction", pct: 0.08 },
        ],
      },
      {
        name: "Tokenized Assets",
        description: "On-chain assets open new markets.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "On-Chain Settlement",
        description: "Programmable settlement strips cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Autonomous Treasury",
        description: "Self-managing treasury optimizes yield.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Personalized Wealth AI",
        description: "AI advisors scale premium relationships.",
        effects: [{ kind: "marketingStrength", flat: 90 }],
      },
    ],
  },
  media: {
    "1940": [
      {
        name: "Radio Network Dominance",
        description: "National radio networks lock in mass advertising revenue.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Wartime Press Partnerships",
        description: "Government media access builds institutional relationships.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1950": [
      {
        name: "Television Broadcasting",
        description: "TV network affiliates lock in prime-time advertising revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Magazine Publishing Scale",
        description: "Glossy magazines capture consumer brand advertising spend.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
    "1960": [
      {
        name: "Color Television",
        description: "Color programming commands significantly higher advertising rates.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Cable Access Pilots",
        description: "Early cable wiring builds subscriber infrastructure.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
    "1970": [
      {
        name: "Cable Television Rollout",
        description: "HBO and cable channels add subscription revenue to ad income.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Satellite Distribution",
        description: "Uplink capability reaches a national content footprint.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1979": [
      {
        name: "Network Broadcasting",
        description: "Mass reach builds ad franchises.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
      {
        name: "Color Production",
        description: "Color content commands premium rates.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Syndication Deals",
        description: "Library licensing adds recurring income.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Satellite Uplinks",
        description: "Satellite distribution widens reach.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Ratings Analytics",
        description: "Audience measurement lifts ad yield.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "Cable Syndication",
        description: "Niche channels multiply revenue.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "marketingStrength", flat: 50 },
        ],
      },
      {
        name: "Home Video",
        description: "Tape and disc create a second window.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Niche Channels",
        description: "Targeted programming raises CPMs.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Desktop Production",
        description: "Digital editing cuts production cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Ad Sales Networks",
        description: "Bundled inventory lifts sell-through.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "1999": [
      {
        name: "Digital Publishing",
        description: "Web distribution collapses print cost.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Web Portals",
        description: "Portals aggregate audience and ads.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
      {
        name: "Online Advertising",
        description: "Banner and search ads add yield.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "marketingStrength", flat: 30 },
        ],
      },
      {
        name: "Content Management",
        description: "CMS speeds publishing at scale.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Streaming Pilots",
        description: "Early streaming tests new formats.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "2009": [
      {
        name: "Streaming Platforms",
        description: "Direct subscriptions unlock the Streaming Media method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "streaming_media" },
          { kind: "marketingStrength", flat: 70 },
        ],
      },
      {
        name: "Mobile Content",
        description: "On-the-go formats grow consumption.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Programmatic Ads",
        description: "Automated buying lifts ad efficiency.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Social Distribution",
        description: "Social sharing amplifies reach.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
      {
        name: "Cloud Production",
        description: "Remote workflows cut production cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2019": [
      {
        name: "Social & Programmatic",
        description: "Targeted ad tech lifts yield per view.",
        effects: [{ kind: "marginBonus", pp: 3.5 }],
      },
      {
        name: "Influencer Networks",
        description: "Creator partnerships extend reach.",
        effects: [{ kind: "marketingStrength", flat: 70 }],
      },
      {
        name: "Short-Form Video",
        description: "Snackable video boosts engagement.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "marketingStrength", flat: 40 },
        ],
      },
      {
        name: "Subscription Bundles",
        description: "Bundled services raise lifetime value.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Audience Analytics",
        description: "First-party data sharpens monetization.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "AI-Generated Content",
        description: "Generative pipelines slash production cost.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.1 },
        ],
      },
      {
        name: "Personalized Media AI",
        description: "AI curation maximizes engagement.",
        effects: [{ kind: "marketingStrength", flat: 90 }],
      },
      {
        name: "Immersive AR/VR",
        description: "Immersive formats open premium tiers.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Synthetic Voices",
        description: "Synthetic talent scales localization.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
      {
        name: "Real-Time Localization",
        description: "Instant translation widens markets.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
  },
  chemical_industries: {
    "1940": [
      {
        name: "Synthetic Polymer Production",
        description: "Nylon and polyethylene industrialization improves plastics margins.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Wartime Chemical Scale-Up",
        description: "Defense contracts fund large-scale chemical plant capacity.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1950": [
      {
        name: "Pharmaceutical Mass Production",
        description: "Antibiotic and drug production scales specialty pharma margins.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Petrochemical Revolution",
        description: "Postwar petrochemicals supply mass consumer goods markets.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1960": [
      {
        name: "Agrochemical Industry",
        description: "Herbicides and pesticides expand the product portfolio.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Environmental Compliance R&D",
        description: "Clean-chemistry investments hedge regulatory risk.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
    ],
    "1970": [
      {
        name: "Specialty Chemicals Emergence",
        description: "High-value fine chemicals command premium margin.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Catalytic Process Improvements",
        description: "Advanced catalysts cut energy cost per unit of output.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1979": [
      {
        name: "Continuous Process Control",
        description: "Automated reactors steady yields.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Catalytic Cracking",
        description: "Better cracking lifts output per barrel.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Polymer Synthesis",
        description: "In-house polymers add product lines.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Process Safety",
        description: "Safety systems cut incident cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Bulk Logistics",
        description: "Tank and rail networks lower transport cost.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1989": [
      {
        name: "Advanced Catalysts",
        description: "Selective catalysts raise yield.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Specialty Chemicals",
        description: "Fine-chemical expertise unlocks the Specialty Chemicals method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "specialty_chemicals" },
          { kind: "marginBonus", pp: 2 },
        ],
      },
      {
        name: "Fertilizer Scale",
        description: "Nutrient expertise lifts fertilizer margins.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Process Optimization",
        description: "Tuning trims energy and feedstock.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Membrane Separation",
        description: "Efficient separation lowers cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "Pharmaceuticals",
        description: "Drug-manufacturing capability improves pharma margins.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Plastics & Polymers",
        description: "Resin scale improves plastics margins.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Green Chemistry",
        description: "Cleaner processes cut regulatory cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Supply Integration",
        description: "Vertical integration secures feedstock.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
      {
        name: "Continuous Reactors",
        description: "Flow chemistry raises throughput.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
    ],
    "2009": [
      {
        name: "Biotech Feedstocks",
        description: "Bio-inputs replace costly petrochemicals.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Catalysis 2.0",
        description: "Next-gen catalysts lift selectivity.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Specialty Coatings",
        description: "Performance coatings command premiums.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Process Intensification",
        description: "Compact plants lower capex.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Emissions Control",
        description: "Abatement keeps plants compliant.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "2019": [
      {
        name: "Engineered Biology",
        description: "Synthetic routes open new products.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Digital Process Twins",
        description: "Virtual plants de-risk scale-up.",
        effects: [{ kind: "growthCostReduction", pct: 0.07 }],
      },
      {
        name: "Advanced Materials",
        description: "Nanomaterials win high-value markets.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Carbon-Neutral Plants",
        description: "Decarbonized sites cut carbon cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Continuous Manufacturing",
        description: "End-to-end flow lowers unit cost.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
    ],
    "2029": [
      {
        name: "AI Materials Discovery",
        description: "ML-led R&D shortens time to market.",
        effects: [
          { kind: "marginBonus", pp: 3.5 },
          { kind: "growthCostReduction", pct: 0.1 },
        ],
      },
      {
        name: "Synthetic Biology",
        description: "Designer organisms produce specialty molecules.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "CO2-to-Chemicals",
        description: "Carbon utilization turns waste into feedstock.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Self-Optimizing Reactors",
        description: "Closed-loop control maximizes yield.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Programmable Polymers",
        description: "Smart polymers open premium uses.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  healthcare: {
    "1940": [
      {
        name: "Wartime Medical Networks",
        description: "Field medicine and triage protocols scale patient throughput.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Antibiotic Revolution",
        description: "Penicillin and streptomycin reshape market demand for care.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1950": [
      {
        name: "Hospital Construction Boom",
        description: "Hill-Burton Act funding builds large public hospital capacity.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Health Insurance Expansion",
        description: "Employer coverage broadens the paying patient base.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
    "1960": [
      {
        name: "Medicare/Medicaid Readiness",
        description: "Government reimbursement programs guarantee steady revenue flow.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Diagnostic Technology",
        description: "X-ray and lab automation cut per-patient processing cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1970": [
      {
        name: "HMO Movement",
        description: "Managed care models trim per-case cost and improve throughput.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Medical Devices Expansion",
        description: "Diagnostic and imaging devices raise procedure revenue.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1979": [
      {
        name: "Clinical Lab Automation",
        description: "Automated diagnostics raise throughput.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Patient Records",
        description: "Computerized records cut admin cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Medical Devices",
        description: "In-house devices add margin.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Pharmacy Systems",
        description: "Inventory systems reduce drug waste.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Diagnostic Imaging",
        description: "Imaging suites command premium procedures.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1989": [
      {
        name: "MRI/CT Imaging",
        description: "Advanced imaging lifts high-margin volume.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Hospital Information Systems",
        description: "HIS reduces administrative overhead.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Minimally Invasive Surgery",
        description: "Laparoscopy shortens stays.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Managed Care Networks",
        description: "Network contracting widens reach.",
        effects: [{ kind: "marketingStrength", flat: 30 }],
      },
      {
        name: "Lab Robotics",
        description: "Automated labs scale testing.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1999": [
      {
        name: "Electronic Health Records",
        description: "Digitized records cut overhead.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Genomics Pilots",
        description: "Early genomics opens premium tests.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Telehealth Pilots",
        description: "Remote consults extend reach cheaply.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Pharmacy Benefit Mgmt",
        description: "PBM scale wins drug pricing.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Digital Imaging",
        description: "PACS streamlines radiology.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "Telemedicine",
        description: "Remote care unlocks the Telehealth Network method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "telehealth" },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
      {
        name: "Genomic Medicine",
        description: "Targeted therapies open premium lines.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Robotic Surgery",
        description: "Surgical robots raise throughput.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Health Analytics",
        description: "Population analytics lower cost of care.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Connected Devices",
        description: "Remote monitoring builds recurring revenue.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2019": [
      {
        name: "Precision Medicine",
        description: "Tailored therapies command premiums.",
        effects: [{ kind: "marginBonus", pp: 3.5 }],
      },
      {
        name: "AI Diagnostics",
        description: "AI triage raises throughput and accuracy.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Wearable Monitoring",
        description: "Wearables grow a consumer health channel.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Cloud EHR",
        description: "Cloud records cut IT cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Immunotherapies",
        description: "Breakthrough biologics drive growth.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
    "2029": [
      {
        name: "AI Care & Robotics",
        description: "AI and robots raise throughput and margin.",
        effects: [
          { kind: "marginBonus", pp: 4 },
          { kind: "growthCostReduction", pct: 0.08 },
        ],
      },
      {
        name: "Gene Editing Therapies",
        description: "Curative edits open premium markets.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Patient Digital Twins",
        description: "Simulated patients optimize treatment.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Autonomous Diagnostics",
        description: "Self-running diagnostics cut labor.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
      {
        name: "Longevity Medicine",
        description: "Anti-aging care opens a premium segment.",
        effects: [{ kind: "marketingStrength", flat: 90 }],
      },
    ],
  },
  retail: {
    "1940": [
      {
        name: "Department Store Expansion",
        description: "Full-line department stores capture postwar suburban spending.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Mail Order Catalogs",
        description: "Sears and JCPenney catalogs reach rural and small-town markets.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1950": [
      {
        name: "Shopping Mall Development",
        description: "Suburban enclosed malls concentrate retail foot traffic.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Self-Service Stores",
        description: "Supermarket self-service cuts labor cost per transaction.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1960": [
      {
        name: "Discount Retail",
        description: "Kmart and Walmart high-volume, low-margin model scales nationally.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Credit Card Acceptance",
        description: "Credit card infrastructure lifts basket size and conversion.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
    "1970": [
      {
        name: "UPC Barcode Scanning",
        description: "Barcode checkout slashes cashier cost and inventory errors.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Franchise Retail Models",
        description: "Franchise expansion multiplies brand reach without capital.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
    "1979": [
      {
        name: "Barcode & POS",
        description: "Scanned checkout cuts shrink and labor.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Category Stores",
        description: "Focused formats build brand pull.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Distribution Centers",
        description: "Owned DCs lower replenishment cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Private Label",
        description: "Own brands lift margin.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Catalog Sales",
        description: "Mail order extends reach.",
        effects: [{ kind: "marketingStrength", flat: 30 }],
      },
    ],
    "1989": [
      {
        name: "Category Superstores",
        description: "Big-box scale wins buying power.",
        effects: [
          { kind: "marginBonus", pp: 1.5 },
          { kind: "marketingStrength", flat: 50 },
        ],
      },
      {
        name: "Just-in-Time Retail",
        description: "Lean inventory frees capital.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Loyalty Programs",
        description: "Loyalty data lifts repeat purchase.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "EDI Replenishment",
        description: "Automated reorder cuts stockouts.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Warehouse Clubs",
        description: "Membership model raises basket size.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "E-Commerce Storefronts",
        description: "Online sales extend reach cheaply.",
        effects: [
          { kind: "marginBonus", pp: 2.5 },
          { kind: "marketingStrength", flat: 60 },
        ],
      },
      {
        name: "Supply-Chain Integration",
        description: "Vendor links lower input cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Online Marketplaces",
        description: "Third-party sellers widen assortment.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
      {
        name: "Demand Planning",
        description: "Forecasting trims markdowns.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Self-Checkout",
        description: "Self-service lowers labor cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Omnichannel Fulfillment",
        description: "Integrated fulfillment unlocks the E-Commerce Fulfillment method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "ecommerce_fulfillment" },
          { kind: "logisticsStrength", flat: 20 },
        ],
      },
      {
        name: "Mobile Commerce",
        description: "App shopping grows the customer base.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
      {
        name: "Same-Day Delivery",
        description: "Fast delivery wins share.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
      {
        name: "Dynamic Pricing",
        description: "Real-time pricing optimizes margin.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Cloud POS",
        description: "Cloud registers cut IT overhead.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2019": [
      {
        name: "Personalized Mobile Commerce",
        description: "Recommendations raise basket size.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "marketingStrength", flat: 70 },
        ],
      },
      {
        name: "Micro-Fulfillment",
        description: "Local micro-DCs speed delivery.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
      {
        name: "Social Commerce",
        description: "Shoppable social lifts impulse sales.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
      {
        name: "Subscription Retail",
        description: "Recurring boxes raise lifetime value.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "AR Try-On",
        description: "Virtual try-on reduces returns.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2029": [
      {
        name: "Autonomous Retail",
        description: "Cashierless stores strip out labor cost.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.1 },
        ],
      },
      {
        name: "Cashierless Stores",
        description: "Just-walk-out tech cuts checkout cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
      {
        name: "Robotic Fulfillment",
        description: "Robotic warehouses lift pick rates.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
      {
        name: "AI Demand Sensing",
        description: "Real-time demand cuts overstock.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Drone Delivery",
        description: "Aerial last-mile lowers delivery cost.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
    ],
  },
  automobiles: {
    "1940": [
      {
        name: "Wartime Vehicle Production",
        description: "Defense vehicle contracts build large-scale manufacturing expertise.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Full-Frame Assembly Lines",
        description: "Standardized body-on-frame production cuts per-unit assembly cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
    ],
    "1950": [
      {
        name: "Post-War Consumer Boom",
        description: "Surging consumer demand for personal vehicles drives volume.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Model Year Marketing",
        description: "Annual model refreshes and advertising drive showroom traffic.",
        effects: [{ kind: "marketingStrength", flat: 25 }],
      },
    ],
    "1960": [
      {
        name: "Safety Standards",
        description: "NHTSA safety regulations improve quality reputation.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Pony Car Segment",
        description: "Sporty, affordable models open new demographic markets.",
        effects: [{ kind: "marketingStrength", flat: 30 }],
      },
    ],
    "1970": [
      {
        name: "Catalytic Converter Compliance",
        description: "Emissions controls retain market access in regulated markets.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "CAFE Fuel Efficiency Programs",
        description: "Fuel-efficiency investment hedges against oil-price exposure.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1979": [
      {
        name: "Robotic Body Assembly",
        description: "Automated welding raises build quality.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Fuel Injection",
        description: "Electronic injection improves efficiency.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Front-Wheel Drive",
        description: "Compact platforms cut material cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Just-in-Time Parts",
        description: "JIT supply lowers inventory cost.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
      {
        name: "Emission Controls",
        description: "Catalytic converters meet regulations.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "Lean Production System",
        description: "Just-in-time and kaizen cut waste.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Anti-Lock Brakes",
        description: "Safety tech commands premium trims.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Platform Sharing",
        description: "Shared platforms cut per-model cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Airbag Systems",
        description: "Safety content lifts ASP.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "CAD Vehicle Design",
        description: "Digital design shortens development.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "Onboard Electronics",
        description: "Electronic systems raise trim margins.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Common-Rail Diesel",
        description: "Efficient diesels win fleet demand.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Global Platforms",
        description: "World platforms maximize scale.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Modular Assembly",
        description: "Module supply speeds the line.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Telematics Pilots",
        description: "Connected services test new revenue.",
        effects: [{ kind: "marketingStrength", flat: 30 }],
      },
    ],
    "2009": [
      {
        name: "Hybrid Drivetrains",
        description: "Efficient hybrids win share as fuel bites.",
        effects: [
          { kind: "marginBonus", pp: 2.5 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Turbocharging",
        description: "Downsized turbos boost efficiency.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Lightweight Materials",
        description: "Aluminum and composites cut weight.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Infotainment",
        description: "Screens and connectivity lift ASP.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Supplier Networks",
        description: "Tiered suppliers lower input cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2019": [
      {
        name: "EV Platforms",
        description: "Dedicated EV skateboards cut per-model cost and unlock EV production.",
        effects: [
          { kind: "unlockStrategy", strategyId: "ev" },
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "ADAS Sensors",
        description: "Driver assistance commands premiums.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Battery Gigafactories",
        description: "Cell scale lowers pack cost.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
      {
        name: "Connected Cars",
        description: "Connectivity opens service revenue.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Over-the-Air Updates",
        description: "OTA cuts recall and service cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2029": [
      {
        name: "Autonomous Drive Stack",
        description: "Self-driving software unlocks autonomous-vehicle production.",
        effects: [
          { kind: "unlockStrategy", strategyId: "autonomous_driving" },
          { kind: "marginBonus", pp: 4 },
          { kind: "growthCostReduction", pct: 0.08 },
        ],
      },
      {
        name: "Solid-State Batteries",
        description: "Next-gen cells extend range and margin.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Robotaxi Fleets",
        description: "Owned fleets add a mobility revenue layer.",
        effects: [{ kind: "marketingStrength", flat: 70 }],
      },
      {
        name: "Software-Defined Vehicles",
        description: "Feature subscriptions compound margin.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Vehicle-to-Grid",
        description: "Bidirectional charging opens energy revenue.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  agriculture: {
    "1940": [
      {
        name: "Mechanized Cultivation",
        description: "Tractors and combines raise industrial-farming margins.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Hybrid Crop Programs",
        description: "Hybrid corn and wheat raise per-acre yields significantly.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
    ],
    "1950": [
      {
        name: "Chemical Fertilizer Adoption",
        description: "Postwar synthetic nitrogen fertilizers surge crop yields.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Cooperative Distribution",
        description: "Grain cooperatives improve market access and bargaining power.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
    ],
    "1960": [
      {
        name: "Green Revolution Seeds",
        description: "High-yield varieties transform staple crop production globally.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Organic Farming Movement",
        description: "Early organics certification lifts premium-niche margins.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1970": [
      {
        name: "Large-Scale Irrigation",
        description: "Center-pivot systems expand arable land at scale.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Commodity Futures Hedging",
        description: "Exchange-traded futures stabilize agricultural revenue.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1979": [
      {
        name: "Green Revolution Inputs",
        description: "High-yield seed and fertilizer lift output.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Mechanized Harvesting",
        description: "Machinery lowers labor cost.",
        effects: [
          { kind: "marginBonus", pp: 1.5 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Hybrid Seeds",
        description: "Hybrids raise yield per acre.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Irrigation Systems",
        description: "Reliable water stabilizes output.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Grain Storage",
        description: "Silos cut spoilage and timing risk.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1989": [
      {
        name: "Center-Pivot Irrigation",
        description: "Efficient irrigation expands arable yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Integrated Pest Management",
        description: "Smarter pest control cuts losses.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Cold Chain",
        description: "Refrigerated logistics reduce spoilage.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Farm Machinery Scale",
        description: "Bigger equipment lowers per-acre cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Soil Testing",
        description: "Lab testing optimizes inputs.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1999": [
      {
        name: "Biotech Crops",
        description: "Engineered traits cut pest and drought loss.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "GPS Guidance Pilots",
        description: "Guided equipment trims overlap.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Contract Farming",
        description: "Forward contracts stabilize revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Commodity Hedging",
        description: "Hedging dampens price swings.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Greenhouse Tech",
        description: "Controlled environments raise yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "GPS Precision Agriculture",
        description: "Variable-rate application cuts fertilizer use sharply.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "inputCost", commodity: "fertilizers", pct: 0.35 },
        ],
      },
      {
        name: "Variable-Rate Inputs",
        description: "Targeted application cuts waste.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Drip Irrigation",
        description: "Precision water lowers cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Farm Management Software",
        description: "Digital records lift efficiency.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Cold-Chain Logistics",
        description: "Integrated cold chain widens reach.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2019": [
      {
        name: "Drone & Sensor Farming",
        description: "Aerial imaging fine-tunes yields.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Vertical Farming",
        description: "Indoor stacked farms unlock the Vertical Farming method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "vertical_farming" },
          { kind: "marginBonus", pp: 1.5 },
        ],
      },
      {
        name: "Soil Microbiome",
        description: "Biologicals reduce fertilizer need.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Ag Analytics",
        description: "Field analytics raise efficiency.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Robotic Harvesting",
        description: "Harvest robots cut peak labor.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
    ],
    "2029": [
      {
        name: "Autonomous Agriculture",
        description: "Self-driving fleets unlock precision-ag operations.",
        effects: [
          { kind: "unlockStrategy", strategyId: "precision_ag" },
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.1 },
        ],
      },
      {
        name: "Gene-Edited Crops",
        description: "Edited crops resist stress and disease.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Cellular Agriculture",
        description: "Cultured products open new markets.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Climate-Resilient Seeds",
        description: "Resilient seeds protect yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Farm Robotics Fleet",
        description: "Coordinated robots strip out labor.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
    ],
  },
  real_estate: {
    "1940": [
      {
        name: "FHA Mortgage Programs",
        description: "Federal housing insurance and wartime programs fuel early demand.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Urban Wartime Housing",
        description: "Defense worker housing contracts provide steady project flow.",
        effects: [{ kind: "marketingStrength", flat: 12 }],
      },
    ],
    "1950": [
      {
        name: "Suburban Expansion",
        description: "Postwar suburbanization drives mass residential development demand.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Shopping Strip Development",
        description: "Suburban strip retail follows population movement.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
    "1960": [
      {
        name: "Urban Renewal Programs",
        description: "Federal redevelopment funding drives large commercial projects.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Early REIT Structures",
        description: "Tax-efficient structures lower capital cost for property portfolios.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1970": [
      {
        name: "Office Building Boom",
        description: "Corporate headquarters construction drives commercial leasing.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Condominium Conversions",
        description: "Condo legislation enables residential asset recycling.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
    "1979": [
      {
        name: "Computerized Property Mgmt",
        description: "Automated leasing cuts overhead.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "REIT Structuring",
        description: "Tax-efficient REITs lower capital cost.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Mortgage Automation",
        description: "Faster underwriting speeds deals.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Mall Development",
        description: "Anchored retail centers draw traffic.",
        effects: [{ kind: "marketingStrength", flat: 30 }],
      },
      {
        name: "Facilities Management",
        description: "In-house FM lowers operating cost.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
    ],
    "1989": [
      {
        name: "Portfolio Diversification",
        description: "Diversified holdings smooth income.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "CMBS Financing",
        description: "Securitized debt lowers funding cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Property Databases",
        description: "Market data sharpens acquisition.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Build-to-Suit",
        description: "Pre-leased builds de-risk development.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Brokerage Networks",
        description: "Broker reach speeds leasing.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "1999": [
      {
        name: "Online Listings",
        description: "Web marketplaces widen tenant reach.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "marketingStrength", flat: 50 },
        ],
      },
      {
        name: "REIT Analytics",
        description: "Data-driven asset management lifts NOI.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Green Building",
        description: "Efficient buildings cut operating cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Mixed-Use Development",
        description: "Blended use raises yield per parcel.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Facility Automation",
        description: "Automated systems lower cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2009": [
      {
        name: "Portfolio Analytics",
        description: "Analytics improve occupancy and pricing.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Energy Management",
        description: "Smart energy cuts utility cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Co-Working Spaces",
        description: "Flexible space lifts revenue per sqft.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Smart Access",
        description: "Digital access lowers staffing.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Property Crowdfunding",
        description: "Crowd capital widens the funding base.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2019": [
      {
        name: "PropTech Platforms",
        description: "Smart-building tools unlock the PropTech Platforms method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "proptech" },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Smart Buildings",
        description: "IoT controls optimize operations.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Digital Leasing",
        description: "Online leasing speeds lease-up.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
      {
        name: "Logistics Real Estate",
        description: "Warehouses ride e-commerce demand.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Build-to-Rent",
        description: "Purpose-built rentals add stable income.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "AI Valuation & Smart Buildings",
        description: "Automated pricing and building AI optimize yield.",
        effects: [
          { kind: "marginBonus", pp: 3.5 },
          { kind: "growthCostReduction", pct: 0.08 },
        ],
      },
      {
        name: "Autonomous Property Mgmt",
        description: "Self-running operations cut cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Modular RE Construction",
        description: "Factory-built units lower dev cost.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Net-Zero Portfolios",
        description: "Decarbonized assets command premiums.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Digital Twin Estates",
        description: "Twin models optimize the whole portfolio.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
    ],
  },
  construction: {
    "1940": [
      {
        name: "Defense Facility Construction",
        description: "Military base and factory contracts scale project volume.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Standard Building Codes",
        description: "Uniform code adoption streamlines permitting across markets.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
    ],
    "1950": [
      {
        name: "Highway Construction Contracts",
        description: "Eisenhower Interstate System drives large civil engineering projects.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Prefab Housing Methods",
        description: "Prefabricated components speed residential delivery timelines.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1960": [
      {
        name: "High-Rise Construction",
        description: "Steel-frame techniques enable cost-effective urban towers.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Concrete Formwork Systems",
        description: "Reusable formwork systems cut concrete pour cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1970": [
      {
        name: "Environmental Site Management",
        description: "EPA-era compliance programs reduce legal and remediation exposure.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Construction Management at Risk",
        description: "CM-at-risk delivery model reduces cost overruns and disputes.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1979": [
      {
        name: "Prefabrication",
        description: "Factory components speed projects.",
        effects: [
          { kind: "marginBonus", pp: 1.5 },
          { kind: "logisticsStrength", flat: 20 },
        ],
      },
      {
        name: "Tower Cranes",
        description: "Heavy lift enables taller builds.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Ready-Mix Concrete",
        description: "On-demand concrete cuts waste.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Critical-Path Scheduling",
        description: "CPM tightens timelines.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Heavy Equipment Fleet",
        description: "Owned fleet lowers rental cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "1989": [
      {
        name: "CAD Engineering",
        description: "Digital design reduces rework.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Steel-Frame Systems",
        description: "Steel framing speeds erection.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Project Controls",
        description: "Cost controls protect margin.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Curtain-Wall Systems",
        description: "Facade systems standardize builds.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Equipment Telematics",
        description: "Fleet tracking lifts utilization.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1999": [
      {
        name: "Project Management Software",
        description: "Integrated scheduling tightens delivery.",
        effects: [
          { kind: "growthCostReduction", pct: 0.08 },
          { kind: "logisticsStrength", flat: 20 },
        ],
      },
      {
        name: "Design-Build Delivery",
        description: "Single-source delivery cuts change orders.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Precast Systems",
        description: "Precast speeds structural work.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Value Engineering",
        description: "Optimized designs lower cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Supply Procurement",
        description: "Bulk procurement lowers material cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2009": [
      {
        name: "Building Information Modeling",
        description: "Shared 3D models cut clashes.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Green Building Standards",
        description: "LEED builds win premium projects.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Modular Components",
        description: "Modules compress build time.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Equipment GPS",
        description: "GPS fleet tracking trims idle.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Lean Construction",
        description: "Lean methods reduce waste.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "Modular Construction",
        description: "Volumetric modules unlock the Modular Construction method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "modular_construction" },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Drone Surveying",
        description: "Aerial survey speeds sitework.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Prefab Volumetric",
        description: "Whole-room prefab accelerates builds.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Construction Robotics",
        description: "Robotic tasks raise productivity.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Mass Timber",
        description: "Engineered timber lowers carbon and cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Robotic & 3D-Printed Builds",
        description: "On-site robotics and printing slash labor.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.12 },
        ],
      },
      {
        name: "Autonomous Equipment",
        description: "Self-driving machines run sites continuously.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
      {
        name: "Self-Healing Concrete",
        description: "Durable concrete cuts maintenance.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "AI Project Delivery",
        description: "AI planning de-risks complex builds.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Carbon-Negative Materials",
        description: "Green materials win regulated projects.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
  },
  defense: {
    "1940": [
      {
        name: "Military-Industrial Scale",
        description: "WWII contracts establish large defense production capacity.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Weapons Systems Integration",
        description: "Standardized weapon platforms reduce per-unit cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
    ],
    "1950": [
      {
        name: "Cold War R&D Contracts",
        description: "Pentagon funding accelerates advanced systems research.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Nuclear Systems Programs",
        description: "Strategic deterrence contracts provide long-horizon revenue.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1960": [
      {
        name: "Vietnam War Procurement",
        description: "Combat operations drive sustained demand for ordnance and vehicles.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Space-Military Crossover",
        description: "NASA and DoD contracts fund dual-use aerospace technology.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1970": [
      {
        name: "Precision Guided Munitions",
        description: "Laser-guided munitions command premium contract pricing.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Logistics Modernization",
        description: "Supply chain reforms cut peacetime readiness cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1979": [
      {
        name: "Precision Guidance",
        description: "Guided munitions win premium contracts.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Composite Armor",
        description: "Advanced armor commands higher value.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Radar Systems",
        description: "Sensor programs add sticky revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Secure Comms",
        description: "Encrypted comms lock in customers.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Jet Propulsion",
        description: "Engine programs underpin platforms.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "Stealth Materials",
        description: "Low-observable tech wins flagship programs.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Smart Munitions",
        description: "Precision weapons lift margin.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Night Vision",
        description: "Optics dominance adds product lines.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Naval Systems",
        description: "Shipboard systems diversify revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Electronic Countermeasures",
        description: "EW pods add high-value content.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "Networked Warfare",
        description: "Data links and cyberspace capabilities unlock cyber operations.",
        effects: [
          { kind: "unlockStrategy", strategyId: "cyber" },
          { kind: "marginBonus", pp: 3 },
        ],
      },
      {
        name: "GPS-Guided Weapons",
        description: "Affordable precision scales demand.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Systems Integration",
        description: "Prime integration locks in margin.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
      {
        name: "Satellite ISR",
        description: "Space sensing adds recurring data revenue.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
      {
        name: "Simulation Training",
        description: "Sim programs add services revenue.",
        effects: [{ kind: "marketingStrength", flat: 30 }],
      },
    ],
    "2009": [
      {
        name: "Unmanned Systems",
        description: "Drones open a fast-growing category.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Precision Strike",
        description: "Long-range precision wins programs.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "C4ISR",
        description: "Command and ISR suites add integration revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Body Armor 2.0",
        description: "Lighter protection lifts demand.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Logistics Automation",
        description: "Automated sustainment lowers cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2019": [
      {
        name: "Cyber & Electronic Warfare",
        description: "Cyber/EW add software-like margins.",
        effects: [{ kind: "marginBonus", pp: 3.5 }],
      },
      {
        name: "Hypersonics",
        description: "Hypersonic programs anchor new budgets.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Directed Energy",
        description: "Laser systems open a new category.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Space Systems",
        description: "Space programs diversify revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "AI Targeting",
        description: "AI fire control raises effectiveness.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
    ],
    "2029": [
      {
        name: "Autonomous Combat Systems",
        description: "AI-piloted platforms anchor contracts.",
        effects: [
          { kind: "marginBonus", pp: 4 },
          { kind: "growthCostReduction", pct: 0.08 },
        ],
      },
      {
        name: "Swarm Drones",
        description: "Coordinated swarms scale cheaply.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Quantum Sensing",
        description: "Quantum sensors defy jamming.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "AI Command Systems",
        description: "Decision AI compresses kill chains.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Orbital Defense",
        description: "Space defense opens a frontier market.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  telecommunications: {
    "1940": [
      {
        name: "Long-Distance Telephone",
        description: "National long-lines infrastructure monetizes voice traffic.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Military Communications Contracts",
        description: "Signal corps contracts build deep technical and scale expertise.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1950": [
      {
        name: "Microwave Relay Networks",
        description: "Microwave towers carry long-distance calls at lower cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Coaxial Cable Infrastructure",
        description: "Coax plant seeds an early subscriber base.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
    "1960": [
      {
        name: "Satellite Communications",
        description: "Telstar and Early Bird open global voice and data circuits.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Telex and Data Networks",
        description: "Telex systems provide B2B data transmission capability.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
    ],
    "1970": [
      {
        name: "Fiber Optic R&D",
        description: "Corning fiber research heralds high-capacity backbone potential.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Packet Switching Research",
        description: "ARPANET foundations inform future network architecture.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1979": [
      {
        name: "Digital Switching",
        description: "Electronic exchanges cut maintenance cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Microwave Relay",
        description: "Relay networks extend coverage.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "PBX Systems",
        description: "Business telephony adds recurring revenue.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Trunk Networks",
        description: "Long-haul trunks lower transport cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Cable TV Plant",
        description: "Coax plant opens a subscriber base.",
        effects: [{ kind: "marketingStrength", flat: 30 }],
      },
    ],
    "1989": [
      {
        name: "Fiber Backbone",
        description: "Optical trunks slash per-bit cost.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Cellular Rollout",
        description: "Mobile coverage opens a new market.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "ISDN",
        description: "Digital lines add data revenue.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "SONET Rings",
        description: "Resilient rings improve uptime.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Network Management",
        description: "OSS tooling lowers operating cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1999": [
      {
        name: "Mobile Networks",
        description: "Cellular buildout grows subscribers.",
        effects: [
          { kind: "marginBonus", pp: 2.5 },
          { kind: "marketingStrength", flat: 50 },
        ],
      },
      {
        name: "DSL Broadband",
        description: "DSL monetizes the copper plant.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "IP Backbone",
        description: "IP cores lower transport cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Submarine Cables",
        description: "Subsea cables add wholesale revenue.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Prepaid Plans",
        description: "Prepaid widens the customer base.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2009": [
      {
        name: "Broadband Convergence",
        description: "Triple-play and broadband infrastructure unlocks cloud service operations.",
        effects: [
          { kind: "unlockStrategy", strategyId: "cloud" },
          { kind: "marginBonus", pp: 3 },
        ],
      },
      {
        name: "3G Data",
        description: "Mobile data becomes a growth engine.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "marketingStrength", flat: 40 },
        ],
      },
      {
        name: "Fiber-to-Home",
        description: "FTTH commands premium broadband.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
      {
        name: "Network Virtualization",
        description: "Virtual cores cut capex.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Tower Infrastructure",
        description: "Owned towers add lease income.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2019": [
      {
        name: "4G/LTE Data",
        description: "Mobile data dominates revenue.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "SD-WAN",
        description: "Software networking adds enterprise revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Small Cells",
        description: "Dense cells boost capacity.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Cloud RAN",
        description: "Virtual radio lowers network cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "IoT Connectivity",
        description: "Connected devices add new revenue.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2029": [
      {
        name: "5G/6G & Edge",
        description: "Dense next-gen networks unlock 5G operations.",
        effects: [
          { kind: "unlockStrategy", strategyId: "mobile_5g" },
          { kind: "marginBonus", pp: 3.5 },
          { kind: "growthCostReduction", pct: 0.08 },
        ],
      },
      {
        name: "Satellite Broadband",
        description: "LEO constellations reach new markets.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Network AI",
        description: "Self-optimizing networks cut opex.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Private 5G",
        description: "Enterprise networks add premium revenue.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Quantum Networking",
        description: "Secure quantum links open a frontier.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  entertainment: {
    "1940": [
      {
        name: "Hollywood Studio System",
        description: "Vertically integrated studios maximize film revenue and control.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Radio Entertainment Networks",
        description: "Sponsored radio dramas and variety shows reach mass audiences.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
    "1950": [
      {
        name: "Television Studios",
        description: "TV production migrates entertainment spending from radio.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Record Labels",
        description: "LP records monetize music at consumer scale.",
        effects: [{ kind: "marketingStrength", flat: 25 }],
      },
    ],
    "1960": [
      {
        name: "Concert Touring",
        description: "Live music touring adds a high-margin revenue stream.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Theme Parks",
        description: "Disneyland-era destination parks create branded experiences.",
        effects: [{ kind: "marketingStrength", flat: 25 }],
      },
    ],
    "1970": [
      {
        name: "Home Video",
        description: "VHS and Betamax open catalog licensing and retail channels.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Blockbuster Film Economics",
        description: "Tent-pole films raise per-release financial returns.",
        effects: [{ kind: "marketingStrength", flat: 25 }],
      },
    ],
    "1979": [
      {
        name: "Home Video Distribution",
        description: "Tape licensing creates a second window.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Multiplex Theaters",
        description: "Multi-screen venues lift utilization.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Arcade Games",
        description: "Coin-op machines add cash revenue.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Record Distribution",
        description: "Distribution scale lowers cost.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Theme Parks",
        description: "Destination parks build the brand.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "1989": [
      {
        name: "Console Gaming",
        description: "Console platforms capture recurring spend.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "marketingStrength", flat: 40 },
        ],
      },
      {
        name: "Cable Premium",
        description: "Premium channels add subscription revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "CD Production",
        description: "Optical media lifts music margin.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Animation Studios",
        description: "Owned animation builds durable IP.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Licensing & Merch",
        description: "Merchandising compounds franchise value.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "1999": [
      {
        name: "Digital Production",
        description: "CGI and editing cut production cost.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "DVD & Home Cinema",
        description: "DVD sales expand the home window.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Online Gaming",
        description: "Multiplayer adds recurring revenue.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Music Downloads",
        description: "Digital sales bypass physical cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Franchise IP",
        description: "Tentpole franchises drive demand.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "2009": [
      {
        name: "Streaming Distribution",
        description: "Direct subscribers capture recurring revenue.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "marketingStrength", flat: 70 },
        ],
      },
      {
        name: "Mobile Gaming",
        description: "Mobile titles reach mass audiences.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Social Games",
        description: "Viral games monetize networks.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
      {
        name: "Digital Storefronts",
        description: "Owned stores cut distribution cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Live Events Platforms",
        description: "Ticketing and live add high-margin revenue.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2019": [
      {
        name: "Mobile & Live-Service Gaming",
        description: "Live-ops monetization unlocks the Live-Service Platforms method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "live_service" },
          { kind: "marginBonus", pp: 2.5 },
        ],
      },
      {
        name: "Esports",
        description: "Competitive gaming opens sponsorship revenue.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
      {
        name: "Subscription Bundles",
        description: "Bundled services raise retention.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Cloud Gaming",
        description: "Streamed games lower hardware barriers.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Creator Platforms",
        description: "Creator ecosystems scale content cheaply.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
    ],
    "2029": [
      {
        name: "Immersive & AI Experiences",
        description: "Generative content scales at low cost.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.1 },
        ],
      },
      {
        name: "VR Worlds",
        description: "Persistent VR opens premium tiers.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Generative Game Content",
        description: "AI-built worlds slash production cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
      {
        name: "Holographic Entertainment",
        description: "Holographic shows command premiums.",
        effects: [{ kind: "marketingStrength", flat: 90 }],
      },
      {
        name: "Persistent Metaverse",
        description: "Always-on worlds add recurring revenue.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  logistics: {
    "1940": [
      {
        name: "Military Supply Chain",
        description: "WWII theater logistics industrialize large-scale supply chain ops.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "ICC Regulated Freight",
        description: "Regulated freight routes provide stable, predictable volume.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
    ],
    "1950": [
      {
        name: "Interstate Trucking Growth",
        description: "Highway network expansion enables efficient long-haul trucking.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Freight Forwarders",
        description: "Specialized forwarders expand international shipping capability.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
    ],
    "1960": [
      {
        name: "Containerization Pioneers",
        description: "Malcolm McLean's container revolution slashes port handling cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Air Freight Expansion",
        description: "Jet-age air freight opens premium time-sensitive shipping lanes.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
    "1970": [
      {
        name: "Rail Intermodal",
        description: "Double-stack intermodal pairs rail efficiency with truck reach.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Warehouse Automation Pilots",
        description: "Early conveyor and picker systems lay the groundwork for automation.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
    ],
    "1979": [
      {
        name: "Containerization",
        description: "Standard containers transform handling cost.",
        effects: [
          { kind: "marginBonus", pp: 1.5 },
          { kind: "logisticsStrength", flat: 25 },
        ],
      },
      {
        name: "Hub Terminals",
        description: "Consolidation hubs raise utilization.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
      {
        name: "Dispatch Systems",
        description: "Centralized dispatch trims empty miles.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Air Freight",
        description: "Air capacity wins premium shipments.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Bonded Warehousing",
        description: "Customs-bonded storage adds services.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1989": [
      {
        name: "Hub-and-Spoke Networks",
        description: "Optimized routing lifts asset utilization.",
        effects: [
          { kind: "growthCostReduction", pct: 0.06 },
          { kind: "logisticsStrength", flat: 25 },
        ],
      },
      {
        name: "Barcode Tracking",
        description: "Scanning and WMS unlock automated logistics operations.",
        effects: [
          { kind: "unlockStrategy", strategyId: "automated" },
          { kind: "marginBonus", pp: 2 },
        ],
      },
      {
        name: "Refrigerated Transport",
        description: "Reefer capability opens cold markets.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
      {
        name: "Intermodal Rail",
        description: "Rail-truck mix lowers line-haul cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "EDI Freight",
        description: "Electronic docs speed clearance.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "Track-and-Trace",
        description: "End-to-end visibility cuts loss.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Web Booking",
        description: "Online booking widens the customer base.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Warehouse Management Systems",
        description: "WMS raises pick efficiency.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Global Forwarding",
        description: "Forwarding network adds fee revenue.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Just-in-Time Delivery",
        description: "JIT service commands premium rates.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "GPS Fleet Optimization",
        description: "Real-time routing trims fuel and idle.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "logisticsStrength", flat: 30 },
        ],
      },
      {
        name: "E-Commerce Fulfillment",
        description: "Parcel fulfillment rides online growth.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Route Analytics",
        description: "Network analytics lower cost per mile.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Cross-Docking",
        description: "Flow-through docks cut storage.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Parcel Networks",
        description: "Dense parcel networks win last-mile.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2019": [
      {
        name: "Automated Warehousing",
        description: "Robotic fulfillment raises pick rates.",
        effects: [
          { kind: "marginBonus", pp: 2.5 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Last-Mile Optimization",
        description: "Smart last-mile lowers delivery cost.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
      {
        name: "Visibility Platforms",
        description: "Real-time visibility wins shippers.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Cold-Chain IoT",
        description: "Monitored cold chain reduces spoilage.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Predictive ETA",
        description: "Accurate ETAs improve service.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Autonomous Freight",
        description: "Driverless trucking unlocks the Autonomous Freight method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "autonomous_freight" },
          { kind: "logisticsStrength", flat: 30 },
        ],
      },
      {
        name: "Drone & Robot Delivery",
        description: "Aerial and ground robots cut last-mile cost.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
      {
        name: "Digital Freight Marketplace",
        description: "Matching platforms add high-margin revenue.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
      {
        name: "Self-Optimizing Network",
        description: "Closed-loop AI tunes the network continuously.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Hyperloop Freight",
        description: "Ultra-fast corridors open premium lanes.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  extraction: {
    "1940": [
      {
        name: "Open-Pit Mining Scale",
        description: "Large open-pit operations cut per-ton extraction cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Wartime Mining Surge",
        description: "Strategic material demands maximize mine utilization.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1950": [
      {
        name: "Dragline Excavators",
        description: "Walking draglines enable efficient stripping of overburden.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Postwar Resource Boom",
        description: "Consumer goods demand drives strong metals markets.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1960": [
      {
        name: "Solution Mining",
        description: "In-situ leaching opens access to low-grade deposits.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Computer-Aided Geology",
        description: "Early geological computing improves resource estimation accuracy.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1970": [
      {
        name: "Deepwater Offshore Oil",
        description: "Continental shelf platforms add high-yield offshore reserve access.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Environmental Permitting",
        description: "Early EIA processes streamline complex permit applications.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1979": [
      {
        name: "Improved Drilling Rigs",
        description: "Better rigs raise recovery and uptime.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Open-Pit Scaling",
        description: "Large pits lower unit cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Ore Processing",
        description: "On-site processing lifts grade.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Haul Fleet",
        description: "Heavy haul fleet lowers movement cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Seismic Survey",
        description: "Surveys cut dry-hole risk.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "3D Seismic Imaging",
        description: "High-res imaging targets the best zones.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Heap Leaching",
        description: "Leaching unlocks low-grade ore.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Directional Drilling",
        description: "Steered wells reach more reserves.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Bulk Rail",
        description: "Dedicated rail lowers haul cost.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
      {
        name: "Mine Safety Systems",
        description: "Safety systems cut incident cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1999": [
      {
        name: "Deepwater Extraction",
        description: "Offshore capability opens high-yield reserves.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "In-Situ Recovery",
        description: "In-situ methods lower extraction cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Flotation Advances",
        description: "Better separation raises recovery.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Pipeline Tie-Ins",
        description: "Pipeline access lowers transport cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Reserve Modeling",
        description: "Geological models de-risk development.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Mine Automation",
        description: "Automated haulage lowers unit cost.",
        effects: [
          { kind: "marginBonus", pp: 2.5 },
          { kind: "growthCostReduction", pct: 0.06 },
        ],
      },
      {
        name: "Shale Extraction",
        description: "Fracking transforms supply economics.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Autonomous Haulage",
        description: "Self-driving trucks cut labor cost.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
      {
        name: "Ore Sorting",
        description: "Sensor sorting raises feed grade.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Tailings Management",
        description: "Better tailings reduce liability.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "2019": [
      {
        name: "Remote Sensing & Analytics",
        description: "Satellite data targets rich deposits.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Electric Mining Fleet",
        description: "Electrified fleets cut fuel cost.",
        effects: [
          { kind: "marginBonus", pp: 2 },
          { kind: "growthCostReduction", pct: 0.05 },
        ],
      },
      {
        name: "Digital Mine Twins",
        description: "Twin models optimize the whole mine.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Drone Surveying",
        description: "Drones speed survey and inventory.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Water Recycling",
        description: "Closed-loop water lowers cost and risk.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Autonomous Extraction",
        description: "Fully autonomous mines run with minimal crews.",
        effects: [
          { kind: "marginBonus", pp: 3 },
          { kind: "growthCostReduction", pct: 0.1 },
        ],
      },
      {
        name: "Deep-Sea Mining",
        description: "Seabed nodules open vast new reserves.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Bioleaching",
        description: "Microbial extraction unlocks tough ores.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "AI Exploration",
        description: "AI prospecting raises discovery rates.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
      {
        name: "Robotic Processing",
        description: "Robotic plants strip out labor cost.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
    ],
  },
};

// ─── Deeper branch extensions (slots 6 & 7) ──────────────────────────────────
// Two more nodes per lane per decade: slot 6 extends the left branch (under
// slot 4), slot 7 extends the right branch (under slot 5).
const CORPORATE_EXTRA: Record<string, NodeSpec[]> = {
  "1940": [
    {
      name: "Industrial Psychology",
      description: "Worker motivation research improves productivity.",
      effects: [{ kind: "marginBonus", pp: 0.5 }],
    },
    {
      name: "Wartime Cost Controls",
      description: "Price and cost disciplines harden operating efficiency.",
      effects: [{ kind: "growthCostReduction", pct: 0.02 }],
    },
  ],
  "1950": [
    {
      name: "Pension Fund Management",
      description: "Employee benefit programs improve retention and morale.",
      effects: [{ kind: "marginBonus", pp: 0.5 }],
    },
    {
      name: "Time-Sharing Services",
      description: "Shared compute services cut administrative overhead.",
      effects: [{ kind: "growthCostReduction", pct: 0.02 }],
    },
  ],
  "1960": [
    {
      name: "Matrix Organization",
      description: "Cross-functional teams accelerate execution.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Licensing Strategy",
      description: "IP licensing opens new revenue streams.",
      effects: [{ kind: "marketingStrength", flat: 20 }],
    },
  ],
  "1970": [
    {
      name: "Strategic Planning Offices",
      description: "Dedicated planning units improve long-term allocation.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "Early Quality Management",
      description: "TQM disciplines cut defect and rework cost.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
  ],
  "1979": [
    {
      name: "Industrial Engineering",
      description: "Work-study refines every process step.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "Vendor Consolidation",
      description: "Fewer suppliers, deeper volume discounts.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
  ],
  "1989": [
    {
      name: "Brand Management Systems",
      description: "Coordinated brand assets sharpen marketing.",
      effects: [{ kind: "marketingStrength", flat: 35 }],
    },
    {
      name: "MRP II",
      description: "Closed-loop planning ties finance to the shop floor.",
      effects: [{ kind: "marginBonus", pp: 1.5 }],
    },
  ],
  "1999": [
    {
      name: "Unified Communications",
      description: "Converged voice and data cut comms cost.",
      effects: [{ kind: "growthCostReduction", pct: 0.05 }],
    },
    {
      name: "Sales Force Automation",
      description: "Pipeline tooling lifts conversion.",
      effects: [{ kind: "marketingStrength", flat: 45 }],
    },
  ],
  "2009": [
    {
      name: "Real-Time Dashboards",
      description: "Live KPIs speed operating decisions.",
      effects: [{ kind: "marginBonus", pp: 2 }],
    },
    {
      name: "DevOps Automation",
      description: "Continuous delivery lowers IT overhead.",
      effects: [{ kind: "growthCostReduction", pct: 0.06 }],
    },
  ],
  "2019": [
    {
      name: "Process Mining",
      description: "Discover and fix hidden process waste.",
      effects: [{ kind: "growthCostReduction", pct: 0.06 }],
    },
    {
      name: "Threat Intelligence",
      description: "Proactive defense averts breach losses.",
      effects: [{ kind: "marginBonus", pp: 1.5 }],
    },
  ],
  "2029": [
    {
      name: "Quantum Logistics",
      description: "Quantum solvers optimize the whole network.",
      effects: [{ kind: "logisticsStrength", flat: 30 }],
    },
    {
      name: "Autonomous Procurement AI",
      description: "AI sourcing negotiates and reorders itself.",
      effects: [{ kind: "growthCostReduction", pct: 0.08 }],
    },
  ],
};

const SECTOR_EXTRA: Partial<Record<CorporationType, Record<string, NodeSpec[]>>> = {
  energy: {
    "1979": [
      {
        name: "Secondary Recovery",
        description: "Water-flooding lifts field output.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Load Balancing",
        description: "Smarter dispatch trims spinning reserve.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
    ],
    "1989": [
      {
        name: "Cogeneration",
        description: "Combined heat-and-power raises usable output.",
        effects: [{ kind: "outputRate", commodity: "energy", pct: 0.08 }],
      },
      {
        name: "Flue-Gas Treatment",
        description: "Cleaner stacks cut compliance cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1999": [
      {
        name: "Subsea Completions",
        description: "Seafloor wellheads reach deeper reserves.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "District Heating",
        description: "Sell waste heat as a second product.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Microgrid Control",
        description: "Islandable grids improve reliability and margin.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Demand Response",
        description: "Paid load-shedding firms the grid cheaply.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2019": [
      {
        name: "Floating Offshore Wind",
        description: "Deep-water wind opens vast new capacity.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Virtual Power Plant",
        description: "Aggregated DERs trade as one asset.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Small Modular Reactors",
        description: "Factory-built reactors scale clean baseload.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Grid-Forming Inverters",
        description: "Inverter-led grids run stably on renewables.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
  },
  technology: {
    "1979": [
      {
        name: "VLSI Design",
        description: "Dense chips cut cost per function.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Compiler Toolchains",
        description: "Better tooling speeds software output.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1989": [
      {
        name: "Object-Oriented Platforms",
        description: "Reusable code accelerates products.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "CD-ROM Distribution",
        description: "Optical media widens software reach.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "1999": [
      {
        name: "Application Servers",
        description: "Middleware monetizes enterprise apps.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Content Delivery Networks",
        description: "Edge caching lowers bandwidth cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Container Orchestration",
        description: "Automated ops slash infrastructure cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "App Store Ecosystem",
        description: "Platform fees compound at scale.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
    ],
    "2019": [
      {
        name: "Transformer Models",
        description: "Foundation models power premium products.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Vector Databases",
        description: "Semantic search underpins AI features.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Photonic Computing",
        description: "Light-based chips slash inference cost.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Agentic Dev Platforms",
        description: "AI agents build and ship software.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
    ],
  },
  manufacturing: {
    "1979": [
      {
        name: "Statistical Quality Control",
        description: "Control charts cut scrap and rework.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Group Technology",
        description: "Part families streamline tooling.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1989": [
      {
        name: "Cellular Manufacturing",
        description: "Work cells cut handling and WIP.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "MRP II Integration",
        description: "Plant-wide planning trims inventory.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "1999": [
      {
        name: "Vendor-Managed Inventory",
        description: "Suppliers own replenishment risk.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Six Sigma Black Belts",
        description: "Deep quality programs lift yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "Laser Cutting",
        description: "Precision cutting reduces material waste.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Cobot Cells",
        description: "Collaborative robots flex with demand.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2019": [
      {
        name: "Predictive Quality AI",
        description: "In-line AI catches defects early.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Digital Thread",
        description: "End-to-end traceability de-risks scale-up.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2029": [
      {
        name: "Self-Reconfiguring Lines",
        description: "Lines retool themselves between products.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Closed-Loop Recycling",
        description: "In-house material loops cut input cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
  },
  financial: {
    "1979": [
      {
        name: "Portfolio Theory Models",
        description: "Mean-variance tools sharpen allocation.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Wire Transfer Networks",
        description: "Faster settlement frees working capital.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
    ],
    "1989": [
      {
        name: "Index Funds",
        description: "Low-cost passive products scale AUM.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Repo Markets",
        description: "Secured funding lowers cost of capital.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "Electronic Bond Trading",
        description: "Screen-based fixed income tightens spreads.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Online Wealth Tools",
        description: "Self-serve planning grows the client base.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2009": [
      {
        name: "Dark Pools",
        description: "Off-exchange venues capture block flow.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Cloud Core Banking",
        description: "Modern cores cut IT and ops cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2019": [
      {
        name: "Real-Time Fraud AI",
        description: "Instant detection cuts loss rates.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Embedded Finance",
        description: "Banking-as-a-service opens new channels.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "2029": [
      {
        name: "DeFi Liquidity Pools",
        description: "On-chain market-making earns fee yield.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "AI Portfolio Management",
        description: "Autonomous strategies scale advisory.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  media: {
    "1979": [
      {
        name: "First-Run Syndication",
        description: "Direct-to-station sales bypass networks.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Affiliate Networks",
        description: "Station groups widen ad reach.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "1989": [
      {
        name: "Pay-Per-View",
        description: "Event pricing captures premium demand.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Music Video Channels",
        description: "Youth channels build durable brands.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "1999": [
      {
        name: "Ad Servers",
        description: "Targeted serving lifts ad yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Subscription Walls",
        description: "Paywalls add recurring revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "Recommendation Engines",
        description: "Personalized feeds boost engagement.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
      {
        name: "Original Programming",
        description: "Owned hits drive subscriber growth.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
    "2019": [
      {
        name: "Creator Monetization",
        description: "Revenue-share keeps creators on-platform.",
        effects: [{ kind: "marketingStrength", flat: 70 }],
      },
      {
        name: "Dynamic Ad Insertion",
        description: "Server-side ads raise fill and yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "AI Dubbing",
        description: "Instant localization cuts versioning cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
      {
        name: "Interactive Narratives",
        description: "Branching content commands premiums.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  chemical_industries: {
    "1979": [
      {
        name: "Distillation Optimization",
        description: "Column tuning saves energy per ton.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Catalyst Recovery",
        description: "Reclaimed catalysts lower input cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "Zeolite Catalysts",
        description: "Shape-selective catalysts raise yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Solvent Recovery",
        description: "Recycled solvents cut chemical input.",
        effects: [{ kind: "inputCost", commodity: "chemicals", pct: 0.2 }],
      },
    ],
    "1999": [
      {
        name: "High-Throughput Screening",
        description: "Rapid R&D finds winning formulations.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Process Analytical Tech",
        description: "In-line sensors steady quality.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Enzyme Catalysis",
        description: "Mild biocatalysis lowers energy use.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Heat Integration",
        description: "Pinch analysis recovers process heat.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2019": [
      {
        name: "Continuous Flow Chemistry",
        description: "Flow reactors raise safe throughput.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Bio-Based Monomers",
        description: "Renewable feedstocks hedge oil cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Electrochemical Synthesis",
        description: "Electrified routes decarbonize output.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "AI Reaction Design",
        description: "ML route-finding shortens development.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
    ],
  },
  healthcare: {
    "1979": [
      {
        name: "Automated Analyzers",
        description: "High-volume chemistry raises lab margin.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Sterile Processing",
        description: "Central sterilization cuts infection cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "Endoscopy",
        description: "Scope procedures shorten recovery.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Cardiac Devices",
        description: "Implantables open high-margin lines.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "PACS Imaging",
        description: "Filmless radiology cuts cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Clinical Decision Support",
        description: "Guideline tools reduce errors.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "Remote Patient Monitoring",
        description: "Home monitoring opens recurring revenue.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Minimally Invasive Robotics",
        description: "Robotic surgery lifts throughput.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "Liquid Biopsy",
        description: "Blood-based screening commands premiums.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Digital Therapeutics",
        description: "Software treatments scale at low cost.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2029": [
      {
        name: "mRNA Platforms",
        description: "Rapid biologics open new markets.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Surgical Autonomy",
        description: "Autonomous steps cut OR time.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
    ],
  },
  retail: {
    "1979": [
      {
        name: "Planogram Systems",
        description: "Optimized shelves lift sales per foot.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Regional DCs",
        description: "Closer distribution speeds replenishment.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "1989": [
      {
        name: "Frequent-Shopper Data",
        description: "Loyalty data sharpens promotions.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Cross-Dock Replenishment",
        description: "Flow-through cuts inventory cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "1999": [
      {
        name: "Personalization Engines",
        description: "Recommendations raise basket size.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
      {
        name: "Drop-Ship Networks",
        description: "Supplier shipping widens assortment.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Buy-Online-Pickup",
        description: "BOPIS lifts conversion and footfall.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Mobile Wallets",
        description: "Frictionless pay grows mobile sales.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "2019": [
      {
        name: "Computer-Vision Inventory",
        description: "Shelf cameras cut out-of-stocks.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Curbside Fulfillment",
        description: "Curbside pickup wins convenience demand.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
    ],
    "2029": [
      {
        name: "Autonomous Stores 2.0",
        description: "Sensor-fusion stores need no checkout.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Predictive Restock AI",
        description: "Demand AI keeps shelves full.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  automobiles: {
    "1979": [
      {
        name: "Unibody Construction",
        description: "Integrated bodies cut weight and cost.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Robotic Painting",
        description: "Automated paint shops lift quality.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1989": [
      {
        name: "Multi-Valve Engines",
        description: "Efficient engines win premium trims.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Crash Safety Cells",
        description: "Safety leadership lifts pricing.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1999": [
      {
        name: "Drive-by-Wire",
        description: "Electronic controls cut mechanical cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Shared Architectures",
        description: "Common platforms maximize scale.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2009": [
      {
        name: "Dual-Clutch Transmissions",
        description: "Efficient gearboxes raise margins.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Active Safety",
        description: "ADAS content commands premiums.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "800V Architectures",
        description: "High-voltage EVs charge faster.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Cell-to-Pack Batteries",
        description: "Packless designs cut battery cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2029": [
      {
        name: "Sensor Fusion AI",
        description: "Robust perception enables autonomy.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Megacasting",
        description: "Single-piece casts slash assembly cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
    ],
  },
  agriculture: {
    "1979": [
      {
        name: "No-Till Farming",
        description: "Reduced tillage saves fuel and soil.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Crop Rotation Science",
        description: "Rotations lift yield and cut inputs.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "Advanced Plant Breeding",
        description: "Better cultivars raise yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Grain Drying",
        description: "On-farm drying reduces spoilage.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1999": [
      {
        name: "Drought-Tolerant Hybrids",
        description: "Resilient seed protects yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Satellite Yield Maps",
        description: "Field maps target inputs.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Variable-Rate Seeding",
        description: "Zone seeding optimizes stands.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Section Control",
        description: "Auto shut-off cuts fertilizer overlap.",
        effects: [{ kind: "inputCost", commodity: "fertilizers", pct: 0.2 }],
      },
    ],
    "2019": [
      {
        name: "Soil-Moisture IoT",
        description: "Sensor networks fine-tune irrigation.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Biological Crop Protection",
        description: "Biologicals reduce chemical spend.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Robotic Weeding",
        description: "AI weeders slash herbicide use.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Gene-Edited Yield",
        description: "Edited traits push yield ceilings.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  real_estate: {
    "1979": [
      {
        name: "Sale-Leaseback Finance",
        description: "Off-balance-sheet capital fuels growth.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Energy Audits",
        description: "Efficiency upgrades cut operating cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1989": [
      {
        name: "Master-Planned Communities",
        description: "Repeatable large-scale schemes make new-market entry cheap.",
        effects: [
          { kind: "marginBonus", pp: 1.5 },
          { kind: "expansionDiscount", pct: 0.25 },
        ],
      },
      {
        name: "Tenant Improvement Systems",
        description: "Standard fit-outs speed leasing.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "Revenue Management",
        description: "Dynamic rents lift occupancy yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Virtual Tours",
        description: "Online tours widen the tenant funnel.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2009": [
      {
        name: "Building Automation",
        description: "Smart systems cut utility cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Flexible Leasing",
        description: "Short-term space lifts revenue per foot.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2019": [
      {
        name: "IoT Submetering",
        description: "Granular metering recovers utility cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Tenant Experience Apps",
        description: "Amenity apps raise retention and rent.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "2029": [
      {
        name: "Predictive Maintenance AI",
        description: "AI upkeep avoids costly failures.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
      {
        name: "Net-Zero Retrofits",
        description: "Decarbonized assets win premium tenants.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
  },
  construction: {
    "1979": [
      {
        name: "Slip-Form Casting",
        description: "Continuous pours speed concrete cores.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Crane Logistics",
        description: "Optimized lifts raise site productivity.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1989": [
      {
        name: "Post-Tensioning",
        description: "Tensioned concrete spans more cheaply.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Fleet Maintenance Systems",
        description: "Planned upkeep lifts equipment uptime.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "4D Scheduling",
        description: "Time-linked models tighten delivery.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Off-Site Fabrication",
        description: "Shop-built assemblies cut site time.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "Clash Detection",
        description: "Model coordination avoids rework.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Laser Scanning",
        description: "As-built scans speed verification.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2019": [
      {
        name: "Construction Exoskeletons",
        description: "Wearables lift worker output and safety.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Reality Capture",
        description: "Drone-fed models track progress.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2029": [
      {
        name: "Swarm Construction Robots",
        description: "Coordinated robots build continuously.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
      {
        name: "Bio-Concrete",
        description: "Self-healing concrete cuts maintenance.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
  },
  defense: {
    "1979": [
      {
        name: "Inertial Navigation",
        description: "Precise nav commands premium systems.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Composite Airframes",
        description: "Lighter airframes win programs.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "Phased-Array Radar",
        description: "Electronic scanning dominates sensing.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Thermal Imaging",
        description: "Night dominance adds product lines.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "Tactical Datalinks",
        description: "Networked fires lock in integration.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Loitering Munitions",
        description: "Persistent strike opens new demand.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "ISR Fusion",
        description: "Sensor fusion sells as a service.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Counter-IED",
        description: "Protection systems win urgent budgets.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "Counter-UAS",
        description: "Drone defense becomes a fast-growth line.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Software-Defined Radio",
        description: "Reprogrammable comms add recurring value.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Directed-Energy Arrays",
        description: "Laser arrays unlock the Directed-Energy Systems method.",
        effects: [
          { kind: "unlockStrategy", strategyId: "directed_energy" },
          { kind: "marginBonus", pp: 2.5 },
        ],
      },
      {
        name: "Autonomous Wingmen",
        description: "Loyal-wingman drones extend platforms.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
    ],
  },
  telecommunications: {
    "1979": [
      {
        name: "Stored-Program Control",
        description: "Software switches cut maintenance.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Coaxial Trunking",
        description: "Higher-capacity trunks lower cost.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
    ],
    "1989": [
      {
        name: "Packet Switching",
        description: "Data networks add a growth line.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Cellular Handoff",
        description: "Seamless mobility grows subscribers.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "1999": [
      {
        name: "DWDM Optics",
        description: "Wavelength multiplexing multiplies fiber capacity.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Mobile Data (GPRS)",
        description: "Always-on data seeds new revenue.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2009": [
      {
        name: "LTE-Advanced",
        description: "Carrier aggregation lifts data revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Carrier Wi-Fi",
        description: "Offload networks ease congestion cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2019": [
      {
        name: "Network Slicing",
        description: "Virtual networks sell tailored SLAs.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Massive MIMO",
        description: "Dense antennas multiply capacity.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Terahertz Links",
        description: "Ultra-wideband backhaul unlocks bandwidth.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Non-Terrestrial Networks",
        description: "Satellite-mobile blends reach everywhere.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
    ],
  },
  entertainment: {
    "1979": [
      {
        name: "Stereo Sound Systems",
        description: "Premium audio lifts venue revenue.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Touring Productions",
        description: "Live tours build franchise reach.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "1989": [
      {
        name: "Computer Animation",
        description: "CGI opens premium production lines.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Premium Cable Bundles",
        description: "Tiered channels add subscription revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "Motion Capture",
        description: "Performance capture cuts animation cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Massively Multiplayer",
        description: "Persistent worlds drive recurring revenue.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2009": [
      {
        name: "Free-to-Play Monetization",
        description: "In-app purchases scale lifetime value.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Second-Screen Apps",
        description: "Companion apps deepen engagement.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "2019": [
      {
        name: "Live-Service Worlds",
        description: "Persistent updates sustain spend.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Battle Pass Models",
        description: "Seasonal passes lift retention.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
    ],
    "2029": [
      {
        name: "Generative NPCs",
        description: "AI characters cut content cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
      {
        name: "Volumetric Capture",
        description: "Holographic capture opens new formats.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  logistics: {
    "1979": [
      {
        name: "Pallet Standardization",
        description: "Standard units speed every transfer.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
      {
        name: "Linehaul Optimization",
        description: "Route planning cuts empty miles.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1989": [
      {
        name: "Hub Automation",
        description: "Automated sort hubs lift throughput.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Satellite Tracking",
        description: "Fleet visibility cuts loss and delay.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "Yard Management",
        description: "Smart yards reduce dwell time.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Freight Exchanges",
        description: "Load matching fills empty capacity.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2009": [
      {
        name: "Telematics Routing",
        description: "Live routing trims fuel and time.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
      {
        name: "Reverse Logistics",
        description: "Returns handling adds a revenue line.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "Warehouse Robotics 2.0",
        description: "Goods-to-person systems boost picks.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
      {
        name: "Control Towers",
        description: "End-to-end visibility lowers expediting.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2029": [
      {
        name: "Autonomous Yards",
        description: "Self-running yards strip out labor.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
      {
        name: "Predictive Network AI",
        description: "AI orchestration optimizes the whole network.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
    ],
  },
  extraction: {
    "1979": [
      {
        name: "Rotary Drilling Advances",
        description: "Faster bits raise drilling rates.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Bulk Haulage",
        description: "Bigger trucks lower cost per ton.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "1989": [
      {
        name: "Reservoir Simulation",
        description: "Modeling lifts recovery factors.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Froth Flotation",
        description: "Better separation raises grade.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "Horizontal Drilling",
        description: "Lateral wells reach more reserve.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Autonomous Survey",
        description: "Robotic survey speeds development.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Multi-Stage Fracturing",
        description: "Staged fracs unlock tight rock.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Fleet Telemetry",
        description: "Connected fleets cut downtime.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
    ],
    "2019": [
      {
        name: "Sensor-Based Sorting",
        description: "Ore sensing raises feed grade.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Electrified Haulage",
        description: "Electric trucks cut fuel cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2029": [
      {
        name: "In-Situ Leaching AI",
        description: "Controlled leaching lifts recovery.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Robotic Drill Rigs",
        description: "Autonomous rigs run around the clock.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
    ],
  },
};

// ─── Second branch extension (slots 8 & 9) ───────────────────────────────────
// One more node on each sub-path: slot 8 under slot 6 (left), slot 9 under
// slot 7 (right), so each sub-path holds two added techs.
const CORPORATE_EXTRA2: Record<string, NodeSpec[]> = {
  "1940": [
    {
      name: "Wartime Procurement",
      description: "Government contract expertise builds enduring supply chain ties.",
      effects: [{ kind: "marginBonus", pp: 0.5 }],
    },
    {
      name: "Union Negotiations",
      description: "Stable labor agreements cut disruption cost.",
      effects: [{ kind: "growthCostReduction", pct: 0.02 }],
    },
  ],
  "1950": [
    {
      name: "Corporate Communications",
      description: "Annual reports and investor relations build stakeholder trust.",
      effects: [{ kind: "marketingStrength", flat: 15 }],
    },
    {
      name: "Batch Data Processing",
      description: "Mainframe batch runs accelerate payroll and billing cycles.",
      effects: [{ kind: "growthCostReduction", pct: 0.02 }],
    },
  ],
  "1960": [
    {
      name: "Conglomerate Structure",
      description: "Diversified holding structure spreads risk and captures synergies.",
      effects: [{ kind: "marginBonus", pp: 0.5 }],
    },
    {
      name: "Market Research",
      description: "Survey and focus-group data sharpen positioning.",
      effects: [{ kind: "marketingStrength", flat: 20 }],
    },
  ],
  "1970": [
    {
      name: "Portfolio Management",
      description: "BCG-style portfolio analysis directs capital to high-return units.",
      effects: [{ kind: "marginBonus", pp: 1 }],
    },
    {
      name: "Stagflation Hedging",
      description: "Inflation-indexed contracts and inventory timing cut cost creep.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
  ],
  "1979": [
    {
      name: "Operations Research",
      description: "Optimization models squeeze out slack.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Strategic Sourcing",
      description: "Multi-region sourcing softens cross-border tariff drag.",
      effects: [{ kind: "tariffShield", pct: 0.2 }],
    },
  ],
  "1989": [
    {
      name: "Category Management",
      description: "Data-led ranging lifts sell-through.",
      effects: [{ kind: "marketingStrength", flat: 35 }],
    },
    {
      name: "Activity-Based Costing",
      description: "True cost visibility sharpens pricing.",
      effects: [{ kind: "marginBonus", pp: 1.5 }],
    },
  ],
  "1999": [
    {
      name: "Knowledge Management",
      description: "Captured expertise speeds every team.",
      effects: [{ kind: "growthCostReduction", pct: 0.04 }],
    },
    {
      name: "Customer Analytics",
      description: "Segment insight lifts campaign yield.",
      effects: [{ kind: "marketingStrength", flat: 40 }],
    },
  ],
  "2009": [
    {
      name: "Self-Service BI",
      description: "Everyone queries data, decisions speed up.",
      effects: [{ kind: "marginBonus", pp: 1.5 }],
    },
    {
      name: "Microservices",
      description: "Decoupled services scale features cheaply.",
      effects: [{ kind: "growthCostReduction", pct: 0.06 }],
    },
  ],
  "2019": [
    {
      name: "Hyperautomation",
      description: "Orchestrated bots automate whole workflows.",
      effects: [{ kind: "growthCostReduction", pct: 0.06 }],
    },
    {
      name: "Security Orchestration",
      description: "Automated response contains incidents fast.",
      effects: [{ kind: "marginBonus", pp: 1.5 }],
    },
  ],
  "2029": [
    {
      name: "Swarm Optimization",
      description: "Multi-agent solvers tune the whole firm.",
      effects: [{ kind: "logisticsStrength", flat: 30 }],
    },
    {
      name: "Self-Negotiating Contracts",
      description: "Agentic deals close without humans.",
      effects: [{ kind: "growthCostReduction", pct: 0.08 }],
    },
  ],
};

const SECTOR_EXTRA2: Partial<Record<CorporationType, Record<string, NodeSpec[]>>> = {
  energy: {
    "1979": [
      {
        name: "Gas Reinjection",
        description: "Reinjected gas sustains reservoir pressure.",
        effects: [{ kind: "outputRate", commodity: "energy", pct: 0.06 }],
      },
      {
        name: "Transmission Upgrades",
        description: "Higher-capacity lines reach more demand.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1989": [
      {
        name: "Heat-Rate Optimization",
        description: "Tuned plants burn less fuel per MWh.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Acid Gas Removal",
        description: "Sour-gas treatment opens new fields.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1999": [
      {
        name: "FPSO Vessels",
        description: "Floating production reaches remote offshore.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "SCADA Telemetry",
        description: "Remote control lifts uptime and margin.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Battery Arbitrage",
        description: "Store cheap, sell dear across the day.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Wholesale Trading Desk",
        description: "Market trading captures price spreads.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "Green Hydrogen Pilots",
        description: "Electrolysis adds an industrial offtake.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Grid-Scale Batteries",
        description: "Utility storage firms renewable output.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Tritium Breeding",
        description: "Closed fuel cycle de-risks fusion supply.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Superconducting Grid",
        description: "Lossless transmission slashes waste.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
  },
  technology: {
    "1979": [
      {
        name: "EDA Tools",
        description: "Electronic design automation speeds chips.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Networking Stack",
        description: "Owned protocols capture infrastructure value.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1989": [
      {
        name: "Client-Server Architecture",
        description: "Distributed apps win the enterprise.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Localization Toolkits",
        description: "Easy localization opens global markets.",
        effects: [{ kind: "marketingStrength", flat: 30 }],
      },
    ],
    "1999": [
      {
        name: "Web Frameworks",
        description: "Reusable frameworks speed delivery.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Ad Networks",
        description: "Owned ad networks monetize traffic.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "2009": [
      {
        name: "Serverless Compute",
        description: "Pay-per-use compute cuts idle cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Mobile SDKs",
        description: "Developer kits expand the platform.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "2019": [
      {
        name: "MLOps Pipelines",
        description: "Industrialized ML ships models reliably.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Inference Accelerators",
        description: "Custom silicon cuts AI serving cost.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
    "2029": [
      {
        name: "Federated Learning",
        description: "Privacy-safe training widens data access.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Self-Healing Systems",
        description: "Autonomous ops eliminate downtime cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
    ],
  },
  manufacturing: {
    "1979": [
      {
        name: "Tool-and-Die Automation",
        description: "Automated tooling shortens changeovers.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Kanban Replenishment",
        description: "Pull signals minimize inventory.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1989": [
      {
        name: "SPC Networks",
        description: "Plant-wide quality data lifts yield.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Concurrent Engineering",
        description: "Parallel design speeds time-to-volume.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "Postponement Strategy",
        description: "Late customization cuts finished stock.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Supplier Portals",
        description: "Connected suppliers tighten the chain.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2009": [
      {
        name: "Additive Tooling",
        description: "Printed jigs and fixtures cut tooling cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Machine Vision Inspection",
        description: "Automated inspection catches defects.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "Edge Analytics",
        description: "On-machine analytics cut downtime.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Autonomous Mobile Robots",
        description: "AMRs flow material without fixed lines.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
    ],
    "2029": [
      {
        name: "Generative Process Planning",
        description: "AI plans optimal routings instantly.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Zero-Defect AI",
        description: "Predictive control approaches zero scrap.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  financial: {
    "1979": [
      {
        name: "Cash Management Systems",
        description: "Sweep accounts optimize idle balances.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Risk-Adjusted Pricing",
        description: "Price for risk to protect spread.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1989": [
      {
        name: "Asset-Backed Securities",
        description: "Off-balance funding frees capital.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Treasury Workstations",
        description: "Automated treasury cuts ops cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "Electronic Custody",
        description: "Digital custody scales asset servicing.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Direct-to-Consumer Funds",
        description: "No-load funds widen the client base.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2009": [
      {
        name: "Smart Order Routing",
        description: "Best-execution routing tightens spreads.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "API Banking Core",
        description: "Composable core lowers IT cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2019": [
      {
        name: "Behavioral Credit Models",
        description: "Alt-data scoring cuts default loss.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Instant Lending",
        description: "Real-time decisions win borrowers.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "2029": [
      {
        name: "Programmable Money",
        description: "Smart-contract payments cut settlement cost.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Autonomous Underwriting",
        description: "AI writes and prices risk end-to-end.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
    ],
  },
  media: {
    "1979": [
      {
        name: "Audience Research Panels",
        description: "Better ratings raise ad pricing power.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Barter Syndication",
        description: "Ad-for-content deals widen distribution.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "1989": [
      {
        name: "Premium Sports Rights",
        description: "Marquee sports anchor subscriptions.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Home Shopping",
        description: "Transactional TV adds a revenue line.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "1999": [
      {
        name: "Banner Ad Networks",
        description: "Aggregated inventory lifts fill.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
      {
        name: "Metered Paywalls",
        description: "Soft paywalls convert loyal readers.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "Adaptive Bitrate Streaming",
        description: "Smooth playback lowers churn.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Franchise Universes",
        description: "Shared IP universes compound demand.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
    ],
    "2019": [
      {
        name: "First-Party Data Graphs",
        description: "Owned data sharpens targeting.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Shoppable Video",
        description: "In-stream commerce lifts revenue.",
        effects: [{ kind: "marketingStrength", flat: 70 }],
      },
    ],
    "2029": [
      {
        name: "Real-Time Personalization AI",
        description: "Per-viewer curation maximizes time spent.",
        effects: [{ kind: "marketingStrength", flat: 90 }],
      },
      {
        name: "Synthetic Production",
        description: "AI sets and actors slash production cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
    ],
  },
  chemical_industries: {
    "1979": [
      {
        name: "Reactor Scale-Up",
        description: "Bigger reactors lower unit cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "By-Product Recovery",
        description: "Captured by-products add revenue.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "Polymer Compounding",
        description: "Custom compounds command premiums.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Closed-Loop Cooling",
        description: "Recirculated water cuts utility cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "Combinatorial Chemistry",
        description: "Massively parallel R&D finds winners.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Specialty Surfactants",
        description: "High-value surfactants lift margin.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "Membrane Reactors",
        description: "Integrated separation raises yield.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Bio-Refining",
        description: "Biomass routes diversify feedstock.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "Digital Twin Plants",
        description: "Virtual plants de-risk operation.",
        effects: [{ kind: "growthCostReduction", pct: 0.07 }],
      },
      {
        name: "Carbon Capture Integration",
        description: "On-site CCS protects against carbon cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Molecular Manufacturing",
        description: "Atom-precise synthesis opens new products.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "CO2 Feedstock Loops",
        description: "Captured CO2 replaces bought chemicals.",
        effects: [{ kind: "inputCost", commodity: "chemicals", pct: 0.2 }],
      },
    ],
  },
  healthcare: {
    "1979": [
      {
        name: "Pharmacy Robotics",
        description: "Automated dispensing cuts errors and cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Diagnostic Reagents",
        description: "Owned reagents add recurring revenue.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "Laparoscopic Suites",
        description: "Keyhole surgery raises throughput.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Implant Telemetry",
        description: "Connected implants enable follow-on care.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "e-Prescribing",
        description: "Electronic scripts cut admin and error.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Disease Registries",
        description: "Outcome data drives premium programs.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "Wearable Sensors",
        description: "Continuous monitoring opens new revenue.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Robotic Pharmacy",
        description: "Automated central fill lowers cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2019": [
      {
        name: "AI Imaging Triage",
        description: "AI prioritization speeds diagnosis.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Care Navigation Apps",
        description: "Guided care grows a consumer channel.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2029": [
      {
        name: "Organ Bioprinting",
        description: "Printed tissue opens a frontier market.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Closed-Loop Therapeutics",
        description: "Sense-and-treat devices automate care.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
    ],
  },
  retail: {
    "1979": [
      {
        name: "Shrinkage Control",
        description: "Loss prevention protects thin margins.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Vendor Compliance",
        description: "Standards cut receiving cost.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1989": [
      {
        name: "Category Killers",
        description: "Category dominance withstands antitrust and political pushback.",
        effects: [
          { kind: "marginBonus", pp: 1.5 },
          { kind: "dominanceShield", pct: 0.25 },
        ],
      },
      {
        name: "Quick Response",
        description: "Rapid replenishment cuts markdowns.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "1999": [
      {
        name: "A/B Merchandising",
        description: "Tested layouts lift conversion.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Marketplace Fulfillment",
        description: "Fulfilled-by-us services add fee income.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2009": [
      {
        name: "Geo-Targeted Offers",
        description: "Location offers drive store traffic.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
      {
        name: "Endless Aisle",
        description: "In-store ordering captures lost sales.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "Headless Commerce",
        description: "Decoupled front-ends speed iteration.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Social Shopping",
        description: "Shoppable social lifts impulse sales.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
    ],
    "2029": [
      {
        name: "Anticipatory Shipping",
        description: "Pre-positioned stock cuts delivery time.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
      {
        name: "Personal Shopper AI",
        description: "AI concierge maximizes basket value.",
        effects: [{ kind: "marketingStrength", flat: 90 }],
      },
    ],
  },
  automobiles: {
    "1979": [
      {
        name: "Galvanized Bodies",
        description: "Rust-proofing lifts quality reputation.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Synchronized Supply",
        description: "Sequenced delivery trims line inventory.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1989": [
      {
        name: "Engine Management ECUs",
        description: "Electronic control lifts efficiency.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Modular Interiors",
        description: "Shared modules cut assembly cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "Brake-by-Wire",
        description: "Electronic braking reduces hardware cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Global Sourcing",
        description: "Low-cost sourcing lowers BOM cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2009": [
      {
        name: "Stop-Start Systems",
        description: "Idle-off boosts fuel economy ratings.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Connected Telematics",
        description: "Connected cars open service revenue.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2019": [
      {
        name: "Cylindrical-Cell Lines",
        description: "High-volume cells lower pack cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Vehicle Operating System",
        description: "Owned OS adds recurring software value.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
    "2029": [
      {
        name: "Lidar Sensor Fusion",
        description: "Robust perception unlocks autonomy.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Battery Swapping",
        description: "Swap networks cut charging downtime.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
    ],
  },
  agriculture: {
    "1979": [
      {
        name: "Contour Farming",
        description: "Terracing curbs erosion and loss.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Hybrid Vigor Seed",
        description: "Heterosis lifts yield per acre.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "Integrated Nutrient Mgmt",
        description: "Balanced nutrition raises yield.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "On-Farm Storage",
        description: "Storage lets you sell into stronger prices.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1999": [
      {
        name: "Insect-Resistant Crops",
        description: "Built-in protection cuts losses.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Yield Monitoring",
        description: "Harvest data targets next year's inputs.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Auto-Steer Tractors",
        description: "GPS guidance cuts overlap and fuel.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Targeted Spraying",
        description: "Spot spraying slashes chemical input.",
        effects: [{ kind: "inputCost", commodity: "fertilizers", pct: 0.2 }],
      },
    ],
    "2019": [
      {
        name: "Predictive Disease Models",
        description: "Early warning protects yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Managed Pollination",
        description: "Pollinator services lift fruit set.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "2029": [
      {
        name: "Swarm Field Robots",
        description: "Robot fleets tend crops autonomously.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
      {
        name: "Precision Fermentation",
        description: "Brewed proteins open new product lines.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  real_estate: {
    "1979": [
      {
        name: "Tax-Increment Financing",
        description: "Public financing de-risks development.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Centralized Leasing",
        description: "Shared leasing teams cut overhead.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1989": [
      {
        name: "Mortgage Securitization",
        description: "Securitized debt lowers funding cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Facility Benchmarking",
        description: "Performance data trims operating cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "Online Mortgage Origination",
        description: "Digital lending widens the buyer pool.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
      {
        name: "Portfolio Optimization",
        description: "Data-driven mix raises blended yield.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "Submetered Utilities",
        description: "Pass-through metering recovers cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Pop-Up Retail",
        description: "Short leases monetize idle space.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2019": [
      {
        name: "Space-as-a-Service",
        description: "Flexible memberships lift revenue per foot.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
      {
        name: "Predictive Leasing",
        description: "Demand models cut vacancy.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Autonomous Building Ops",
        description: "Self-running operations cut cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
      {
        name: "Carbon-Negative Materials",
        description: "Green materials win regulated tenants.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
  },
  construction: {
    "1979": [
      {
        name: "Pre-Cast Panels",
        description: "Factory panels speed envelope work.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Site Logistics Planning",
        description: "Just-in-time delivery clears the site.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
    ],
    "1989": [
      {
        name: "Tilt-Up Construction",
        description: "On-site cast walls cut build time.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Equipment Pooling",
        description: "Shared fleets raise utilization.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1999": [
      {
        name: "Lean Scheduling",
        description: "Last-planner methods cut delays.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Modular MEP",
        description: "Prefab mechanical racks speed fit-out.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2009": [
      {
        name: "Prefab Bathroom Pods",
        description: "Pod assemblies compress schedules.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "GPS Machine Control",
        description: "Guided earthmoving cuts rework.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2019": [
      {
        name: "Robotic Bricklaying",
        description: "Bricklaying robots raise productivity.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Digital Permitting",
        description: "Online permits shorten pre-construction.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
    ],
    "2029": [
      {
        name: "On-Site 3D Printing",
        description: "Printed structures slash labor.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Self-Assembling Structures",
        description: "Programmable materials build themselves.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  defense: {
    "1979": [
      {
        name: "Terrain-Following Radar",
        description: "Low-altitude nav wins strike programs.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Ballistic Computers",
        description: "Fire-control electronics add value.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "1989": [
      {
        name: "Active Protection Systems",
        description: "Hard-kill defenses win vehicle programs.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Secure Satellite Comms",
        description: "Protected comms lock in customers.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "UAV Sensor Payloads",
        description: "ISR payloads ride the drone wave.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Precision Logistics",
        description: "Smart sustainment cuts deployment cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2009": [
      {
        name: "Counter-Battery Radar",
        description: "Threat-locating sensors win urgent buys.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Soldier Systems",
        description: "Integrated kit adds recurring revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2019": [
      {
        name: "Hypersonic Defense",
        description: "Interceptors anchor new budgets.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "AI Mission Planning",
        description: "Decision aids compress planning cycles.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2029": [
      {
        name: "Swarming Munitions",
        description: "Coordinated swarms scale cheaply.",
        effects: [{ kind: "marginBonus", pp: 3 }],
      },
      {
        name: "Quantum-Secure Comms",
        description: "Unbreakable links command a premium.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  telecommunications: {
    "1979": [
      {
        name: "Digital Multiplexing",
        description: "More calls per line lowers cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Microwave Towers",
        description: "Wireless backhaul extends reach.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
    ],
    "1989": [
      {
        name: "Frame Relay",
        description: "Efficient data service adds revenue.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Voicemail Platforms",
        description: "Value-added services lift ARPU.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "1999": [
      {
        name: "MPLS Backbones",
        description: "Traffic engineering improves margins.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "SMS Platforms",
        description: "Messaging becomes a high-margin product.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2009": [
      {
        name: "Femtocells",
        description: "In-home cells offload macro networks.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "IP Multimedia Subsystem",
        description: "IMS enables rich converged services.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2019": [
      {
        name: "Open RAN",
        description: "Disaggregated radio cuts vendor cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Edge CDN",
        description: "Operator edge caching adds revenue.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Reconfigurable Surfaces",
        description: "Smart surfaces extend coverage cheaply.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "AI Spectrum Sharing",
        description: "Dynamic spectrum lifts capacity.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
    ],
  },
  entertainment: {
    "1979": [
      {
        name: "Surround Sound",
        description: "Premium audio lifts ticket value.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Merchandise Licensing",
        description: "Character licensing compounds revenue.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "1989": [
      {
        name: "Direct-to-Video",
        description: "Sell-through video adds a window.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Theme Park Attractions",
        description: "Marquee rides drive gate revenue.",
        effects: [{ kind: "marketingStrength", flat: 50 }],
      },
    ],
    "1999": [
      {
        name: "Real-Time 3D Engines",
        description: "Reusable engines cut game cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Digital Rights Management",
        description: "DRM protects distribution revenue.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
    ],
    "2009": [
      {
        name: "Cloud Save Sync",
        description: "Cross-device saves boost retention.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Microtransactions",
        description: "In-game purchases lift lifetime value.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
    "2019": [
      {
        name: "Cross-Play Networks",
        description: "Unified play grows the audience.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
      {
        name: "Live Events Streaming",
        description: "Streamed events open new revenue.",
        effects: [{ kind: "marketingStrength", flat: 60 }],
      },
    ],
    "2029": [
      {
        name: "Procedural Worlds",
        description: "Generated content slashes build cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.08 }],
      },
      {
        name: "Haptic Immersion",
        description: "Full-body feedback commands premiums.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
    ],
  },
  logistics: {
    "1979": [
      {
        name: "Roll-On/Roll-Off",
        description: "Drive-on ships speed vehicle freight.",
        effects: [{ kind: "logisticsStrength", flat: 20 }],
      },
      {
        name: "Zone Skipping",
        description: "Bypassing hubs cuts transit cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "1989": [
      {
        name: "Bar-Coded Tracking",
        description: "Scan visibility cuts loss.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
      {
        name: "Dedicated Fleets",
        description: "Owned capacity wins premium contracts.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "Transportation Mgmt Systems",
        description: "TMS optimization lowers freight spend.",
        effects: [{ kind: "growthCostReduction", pct: 0.06 }],
      },
      {
        name: "Pool Distribution",
        description: "Consolidated pools cut LTL cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "2009": [
      {
        name: "Dynamic Slotting",
        description: "Smart slotting raises pick rates.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
      {
        name: "Carrier Marketplaces",
        description: "Spot matching fills empty miles.",
        effects: [{ kind: "marketingStrength", flat: 40 }],
      },
    ],
    "2019": [
      {
        name: "Autonomous Forklifts",
        description: "Self-driving trucks run warehouses.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
      {
        name: "Predictive ETA AI",
        description: "Accurate ETAs cut expediting cost.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "2029": [
      {
        name: "Truck Platooning",
        description: "Convoys cut fuel and driver cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.1 }],
      },
      {
        name: "Drone Hubs",
        description: "Aerial micro-hubs speed last mile.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
    ],
  },
  extraction: {
    "1979": [
      {
        name: "Mud Logging",
        description: "Real-time geology cuts drilling risk.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
      {
        name: "Conveyor Haulage",
        description: "Conveyors lower bulk haul cost.",
        effects: [{ kind: "logisticsStrength", flat: 25 }],
      },
    ],
    "1989": [
      {
        name: "4D Seismic Monitoring",
        description: "Time-lapse imaging lifts recovery.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Solvent Extraction",
        description: "SX-EW unlocks low-grade metal.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
    ],
    "1999": [
      {
        name: "Extended-Reach Wells",
        description: "Long laterals drain more reservoir.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Remote Operations Centers",
        description: "Central control cuts site staffing.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2009": [
      {
        name: "Proppant Optimization",
        description: "Tuned fracs raise well productivity.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Autonomous Drills",
        description: "Robotic drills run continuously.",
        effects: [{ kind: "logisticsStrength", flat: 30 }],
      },
    ],
    "2019": [
      {
        name: "Geometallurgy",
        description: "Ore-body modeling optimizes processing.",
        effects: [{ kind: "marginBonus", pp: 2 }],
      },
      {
        name: "Renewable-Powered Sites",
        description: "On-site renewables cut fuel cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.05 }],
      },
    ],
    "2029": [
      {
        name: "Bioleaching at Scale",
        description: "Microbial extraction unlocks tough ore.",
        effects: [{ kind: "marginBonus", pp: 2.5 }],
      },
      {
        name: "Subsea Robotic Mining",
        description: "Seafloor robots open new reserves.",
        effects: [{ kind: "logisticsStrength", flat: 35 }],
      },
    ],
  },
};

function specToNode(
  spec: NodeSpec,
  id: string,
  decadeId: string,
  lane: TechLane,
  slot: number,
  cost: number
): TechTreeNode {
  return {
    id,
    decadeId,
    lane,
    slot,
    name: spec.name,
    description: spec.description,
    cost,
    cashRevenueFraction: spec.cashRevenueFraction,
    effects: spec.effects,
  };
}

function buildTreeForSector(sectorType: CorporationType): TechTreeNode[] {
  const nodes: TechTreeNode[] = [];
  for (const decade of TECH_DECADES) {
    const cost = DECADE_COST[decade.id] ?? 12;
    // Base 5 (slots 1–5) + extend each branch: slots 6,7 then slots 8,9 so each
    // sub-path is a chain of four (2→4→6→8 and 3→5→7→9).
    const corpSpecs = [
      ...(CORPORATE[decade.id] ?? []),
      ...(CORPORATE_EXTRA[decade.id] ?? []),
      ...(CORPORATE_EXTRA2[decade.id] ?? []),
    ];
    corpSpecs.forEach((spec, i) => {
      nodes.push(specToNode(spec, corpNodeId(decade.id, i + 1), decade.id, "generic", i + 1, cost));
    });
    const sectorSpecs = [
      ...(SECTOR[sectorType]?.[decade.id] ?? []),
      // Early decades historically only authored slots 1–2; append slots 3–9 so
      // the Sector lane matches Corporate's two-sided 9-slot fork (ticket-1016).
      ...(SECTOR_EARLY_FILL[sectorType]?.[decade.id] ?? []),
      ...(SECTOR_EXTRA[sectorType]?.[decade.id] ?? []),
      ...(SECTOR_EXTRA2[sectorType]?.[decade.id] ?? []),
    ];
    sectorSpecs.forEach((spec, i) => {
      nodes.push(
        specToNode(
          spec,
          sectorNodeId(sectorType, decade.id, i + 1),
          decade.id,
          "sector",
          i + 1,
          cost
        )
      );
    });
  }
  return nodes;
}

/** Full tech tree, keyed by sector type. */
export const TECH_TREE: Record<CorporationType, TechTreeNode[]> = Object.fromEntries(
  CORPORATION_TYPES.map((t) => [t, buildTreeForSector(t)])
) as Record<CorporationType, TechTreeNode[]>;

/** Sector types with an authored sector lane (vs corporate-only for now). */
export const SECTORS_WITH_AUTHORED_LANE: CorporationType[] = (
  Object.keys(SECTOR) as CorporationType[]
).filter((t) => SECTOR[t] !== undefined);
