/**
 * Early-era sector-lane fill (slots 3–9) for decades 1940–1970.
 *
 * Base SECTOR content historically only authored slots 1–2 for these decades,
 * so the Tech tab drew a binary fork with an empty right branch ("Sector is not
 * fully shown"). These fills restore parity with the Corporate lane's 9-slot
 * topology without rewriting the already-shipped slot 1–2 names.
 *
 * Wired in by buildTreeForSector via SECTOR_EARLY_FILL.
 */
import type { CorporationType } from "../corporations";
import type { TechEffect } from "./effects";

interface NodeSpec {
  name: string;
  description: string;
  effects: TechEffect[];
  cashRevenueFraction?: number;
}

export const SECTOR_EARLY_FILL: Partial<Record<CorporationType, Record<string, NodeSpec[]>>> = {
  manufacturing: {
    "1940": [
      {
        name: "Tooling Standardization",
        description: "Interchangeable tooling speeds wartime changeovers.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Shift Scheduling Discipline",
        description: "Round-the-clock shift plans raise plant utilization.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Munitions Quality Inspection",
        description: "Incoming inspection cuts scrap on defense lots.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Plant Layout Optimization",
        description: "Flow-line layouts shorten material travel.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Vendor Rating Boards",
        description: "Preferred-supplier boards stabilize component quality.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Spare Parts Catalogs",
        description: "Standardized spares keep lines running through shortages.",
        effects: [{ kind: "logisticsStrength", flat: 8 }],
      },
      {
        name: "Foreman Training Schools",
        description: "Trained floor leadership reduces downtime.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1950": [
      {
        name: "Transfer Line Expansion",
        description: "Linked machines cut handling between stations.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Preventive Maintenance Programs",
        description: "Scheduled upkeep raises uptime on automation.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Work Measurement Standards",
        description: "Time standards tighten labor cost control.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Materials Requirements Planning",
        description: "Early MRP logic cuts stockouts and excess.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Industrial Engineering Cells",
        description: "Method studies squeeze waste from each cell.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Supplier Development",
        description: "Coached vendors raise incoming yield.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Plant Safety Systems",
        description: "Safer floors reduce disruption and claims cost.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
    ],
    "1960": [
      {
        name: "Hardened Tool Steels",
        description: "Longer tool life cuts changeover cost.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "In-Process Gaging",
        description: "On-machine checks catch drift early.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Conveyorized Assembly",
        description: "Powered conveyors raise line rate.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Value Engineering",
        description: "Design-to-cost reviews trim unit cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Process Capability Studies",
        description: "Capability charts lock in repeatable quality.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Tool Crib Automation",
        description: "Tracked tooling cuts idle search time.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Multi-Plant Coordination",
        description: "Shared schedules balance load across sites.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1970": [
      {
        name: "Programmable Controllers",
        description: "Early PLCs stabilize automated sequences.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Group Technology Coding",
        description: "Part families shrink setup variety.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Automated Storage Retrieval",
        description: "AS/RS speeds kit delivery to the line.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Energy-Aware Scheduling",
        description: "Load-shifting trims peak plant energy cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Vendor Kanban Pilots",
        description: "Pull signals cut WIP between plants.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Welding Automation Cells",
        description: "Dedicated weld cells raise throughput.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Quality Audit Trails",
        description: "Lot traceability lowers recall exposure.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
  },
  energy: {
    "1940": [
      {
        name: "Coal Plant Standardization",
        description: "Standard boiler designs cut build cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Transmission Right-of-Way",
        description: "Secured corridors speed grid expansion.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Refinery Throughput Discipline",
        description: "Tight unit scheduling raises utilization.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Fuel Oil Hedging Practices",
        description: "Contract hedges blunt feedstock swings.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Metering Modernization",
        description: "Better meters cut unaccounted losses.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Reserve Margin Planning",
        description: "Planned reserves stabilize peak delivery.",
        effects: [{ kind: "outputRate", commodity: "energy", pct: 0.04 }],
      },
      {
        name: "Pipeline Pump Stations",
        description: "Booster stations extend reliable reach.",
        effects: [{ kind: "logisticsStrength", flat: 8 }],
      },
    ],
    "1950": [
      {
        name: "Unit Commitment Planning",
        description: "Dispatch planning raises fleet efficiency.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "High-Voltage Expansion",
        description: "HV lines cut transmission losses.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Oilfield Waterflood Pilots",
        description: "Secondary recovery lifts mature fields.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Tank Farm Automation",
        description: "Automated tanks cut handling loss.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Load Forecasting Offices",
        description: "Better forecasts shrink spinning reserve waste.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Coal Handling Mechanization",
        description: "Mechanized yards raise boiler feed rate.",
        effects: [{ kind: "outputRate", commodity: "energy", pct: 0.05 }],
      },
      {
        name: "Gas Distribution Safety",
        description: "Leak detection cuts outage and liability cost.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1960": [
      {
        name: "Pumped Storage Pilots",
        description: "Storage smooths peak and off-peak margins.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Catalytic Reforming Upgrades",
        description: "Refinery upgrades lift light-product yield.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "SCADA Dispatch",
        description: "Centralized control improves grid response.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Drilling Mud Programs",
        description: "Better muds raise successful well rates.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Environmental Stack Controls",
        description: "Early scrubbers cut compliance shutdowns.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Shared Spare Turbines",
        description: "Pooled spares shorten outage duration.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Wholesale Wheeling Contracts",
        description: "Wheeling opens surplus sales paths.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1970": [
      {
        name: "Enhanced Recovery Chemicals",
        description: "Injectants lift remaining oil in place.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Combined Heat Pilots",
        description: "CHP raises useful energy per fuel unit.",
        effects: [{ kind: "outputRate", commodity: "energy", pct: 0.06 }],
      },
      {
        name: "Strategic Petroleum Buffering",
        description: "Buffers blunt feedstock price shocks.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Nuclear Fuel Cycle Planning",
        description: "Fuel planning stabilizes reactor uptime.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Demand-Side Load Control",
        description: "Interruptible tariffs flatten peaks.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Deepwater Survey Teams",
        description: "Surveys de-risk offshore prospects.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Emissions Monitoring Labs",
        description: "In-house labs speed permit compliance.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
  },
  technology: {
    "1940": [
      {
        name: "Radar Component Lines",
        description: "Defense radar builds electronics capacity.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Clean-Room Discipline",
        description: "Controlled assembly raises tube yields.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Military Spec Testing",
        description: "Mil-spec screens cut field failure cost.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Component Standardization",
        description: "Shared parts shrink inventory variety.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Field Service Depots",
        description: "Depot repair keeps systems online.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Oscilloscope Instrumentation",
        description: "Better instruments speed debug cycles.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Patent Pool Participation",
        description: "Cross-licenses widen product options.",
        effects: [{ kind: "marketingStrength", flat: 12 }],
      },
    ],
    "1950": [
      {
        name: "Printed Circuit Boards",
        description: "PCBs cut wiring labor and defects.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Semiconductor Pilot Lines",
        description: "Pilot fabs raise device yields.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Business Computing Sales",
        description: "Mainframe sales open enterprise accounts.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
      {
        name: "Magnetic Core Memory",
        description: "Core memory lifts reliable system capacity.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Systems Engineering Offices",
        description: "Integration offices cut project overruns.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Component Incoming Test",
        description: "Screening raises board-level yields.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Field Engineer Corps",
        description: "On-site engineers shorten downtime.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
    ],
    "1960": [
      {
        name: "Mask-Making Precision",
        description: "Better masks raise IC yields.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Software Libraries",
        description: "Reusable libraries cut application build cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Minicomputer Platforms",
        description: "Minis open mid-market computing.",
        effects: [{ kind: "marketingStrength", flat: 25 }],
      },
      {
        name: "Burn-In Screening",
        description: "Burn-in weeds early failures.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Cleanroom Expansion",
        description: "Class-controlled space lifts fab throughput.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "OEM Channel Programs",
        description: "OEM deals widen distribution.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Remote Diagnostics",
        description: "Phone diagnostics cut truck rolls.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
    ],
    "1970": [
      {
        name: "LSI Design Rules",
        description: "Denser rules raise chip value per wafer.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Personal Computing Pilots",
        description: "Early PCs open consumer channels.",
        effects: [{ kind: "marketingStrength", flat: 30 }],
      },
      {
        name: "Automated Test Equipment",
        description: "ATE shortens board test cycles.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Firmware Update Programs",
        description: "Field firmware cuts recall hardware swaps.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Disk Drive Miniaturization",
        description: "Smaller drives widen system design options.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Software Productization",
        description: "Packaged software lifts recurring margin.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Global Component Sourcing",
        description: "Multi-source buys blunt shortage risk.",
        effects: [{ kind: "logisticsStrength", flat: 16 }],
      },
    ],
  },
  financial: {
    "1940": [
      {
        name: "Branch Clearing Networks",
        description: "Faster clearing raises float efficiency.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Credit File Standardization",
        description: "Shared files cut underwriting cost.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Trust Department Scale",
        description: "Fiduciary scale lifts fee income.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Teller Procedure Manuals",
        description: "Standard procedures cut branch errors.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Correspondent Fee Schedules",
        description: "Clear fee cards raise agency revenue.",
        effects: [{ kind: "marketingStrength", flat: 12 }],
      },
      {
        name: "Safe Deposit Expansion",
        description: "Ancillary services deepen client stickiness.",
        effects: [{ kind: "marketingStrength", flat: 10 }],
      },
      {
        name: "Audit Trail Mechanization",
        description: "Mechanized ledgers cut reconciliation cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1950": [
      {
        name: "Installment Loan Factories",
        description: "Specialized shops raise consumer loan throughput.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Magnetic Ink Encoding",
        description: "MICR speeds check processing.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Mortgage Servicing Centers",
        description: "Central servicing cuts per-loan cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Retail Deposit Campaigns",
        description: "Campaigns grow low-cost deposit base.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Credit Scoring Pilots",
        description: "Scorecards speed and standardize approvals.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Night Drop Networks",
        description: "Merchant drops raise commercial deposits.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Bond Trading Desks",
        description: "Active desks capture secondary market spread.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1960": [
      {
        name: "Computerized Bookkeeping",
        description: "Batch computers cut ledger cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Eurodollar Desk",
        description: "Offshore dollar books open wholesale funding.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Mutual Fund Distribution",
        description: "Fund shelves raise fee-based revenue.",
        effects: [{ kind: "marketingStrength", flat: 22 }],
      },
      {
        name: "Lockbox Processing",
        description: "Corporate lockboxes accelerate collections.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Syndicate Underwriting",
        description: "Syndicates expand large-issue capacity.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Branch Site Analytics",
        description: "Site models raise new-branch productivity.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
      {
        name: "Interbank Wire Discipline",
        description: "Wire controls cut settlement risk cost.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
    ],
    "1970": [
      {
        name: "ATM Network Pilots",
        description: "Self-service raises cheap transaction capacity.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Floating Rate Instruments",
        description: "Floating books hedge rate volatility.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Cash Management Accounts",
        description: "Sweep products deepen corporate relationships.",
        effects: [{ kind: "marketingStrength", flat: 25 }],
      },
      {
        name: "Securitization Warehouses",
        description: "Warehouses recycle balance-sheet capacity.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Compliance Reporting Units",
        description: "Dedicated units cut regulatory friction.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Foreign Exchange Dealing",
        description: "FX desks capture spread on client flows.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Data Center Consolidation",
        description: "Shared centers cut IT unit cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
    ],
  },
  media: {
    "1940": [
      {
        name: "Newsreel Distribution",
        description: "Theater newsreels widen audience reach.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
      {
        name: "Affiliate Clearance Desks",
        description: "Clearance desks raise network fill rates.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Paper Rationing Discipline",
        description: "Tight paper use protects print margins.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Wire Service Contracts",
        description: "Shared wires cut reporting cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Sponsor Integration Units",
        description: "Integrated spots raise advertiser spend.",
        effects: [{ kind: "marketingStrength", flat: 12 }],
      },
      {
        name: "Shortwave Relay",
        description: "Relay extends international reach.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Archive Libraries",
        description: "Reusable archives cut production cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1950": [
      {
        name: "Prime-Time Scheduling",
        description: "Block scheduling lifts ad rates.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Offset Printing Upgrades",
        description: "Offset cuts per-copy print cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Audience Measurement",
        description: "Ratings data sharpens ad pricing.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
      {
        name: "Syndication Packages",
        description: "Packages monetize library inventory.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Remote Broadcast Units",
        description: "Remotes expand live coverage cheaply.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Color Process Pilots",
        description: "Early color lifts premium ad inventory.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
      {
        name: "Classified Ad Systems",
        description: "Organized classifieds raise high-margin pages.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1960": [
      {
        name: "Demographic Ad Targeting",
        description: "Demo buys raise CPM efficiency.",
        effects: [{ kind: "marketingStrength", flat: 25 }],
      },
      {
        name: "Microwave Studio Links",
        description: "Studio links cut tape transport cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Franchise Magazine Titles",
        description: "Franchise titles lift subscription stickiness.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Tape Editing Suites",
        description: "Electronic edit rooms accelerate turnaround.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Public Affairs Bureaus",
        description: "Bureaus deepen local affiliate value.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
      {
        name: "International Co-Productions",
        description: "Co-pros share cost and widen catalogs.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Billboard Cross-Promo",
        description: "Outdoor promo lifts tune-in cheaply.",
        effects: [{ kind: "marketingStrength", flat: 12 }],
      },
    ],
    "1970": [
      {
        name: "Pay-TV Experiments",
        description: "Subscription experiments diversify revenue.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Satellite Uplink Trucks",
        description: "Uplinks expand live footprint.",
        effects: [{ kind: "logisticsStrength", flat: 18 }],
      },
      {
        name: "Demographic Research Firms",
        description: "Research raises advertiser confidence.",
        effects: [{ kind: "marketingStrength", flat: 28 }],
      },
      {
        name: "Newsroom Computerization",
        description: "Electronic newsrooms cut production cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Format Radio Specialization",
        description: "Formats raise loyal listener share.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Rights Libraries",
        description: "Owned rights lift residual income.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Affiliate Incentive Plans",
        description: "Incentives raise clearance of network shows.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
    ],
  },
  chemical_industries: {
    "1940": [
      {
        name: "Batch Reactor Controls",
        description: "Tighter controls raise batch yields.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Solvent Recovery Loops",
        description: "Recovery cuts raw solvent spend.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Explosives Safety Protocols",
        description: "Safety protocols protect continuous output.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Catalyst Reclamation",
        description: "Reclaimed catalysts cut input cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Drumming Standardization",
        description: "Standard packs speed customer fills.",
        effects: [{ kind: "logisticsStrength", flat: 8 }],
      },
      {
        name: "Process Lab Scale-Up",
        description: "Scale-up labs shorten commercialization.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Industrial Gas Capture",
        description: "Captured gases become saleable byproduct.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1950": [
      {
        name: "Continuous Polymer Lines",
        description: "Continuous lines raise resin throughput.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Pharmaceutical GMP Pilots",
        description: "GMP discipline lifts accepted lot rates.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Crackers Heat Integration",
        description: "Heat integration cuts energy per ton.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Tank Car Logistics",
        description: "Dedicated tank cars speed bulk delivery.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
      {
        name: "Quality Assay Labs",
        description: "In-house assays cut third-party delay.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Specialty Blend Shops",
        description: "Custom blends raise price realization.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
      {
        name: "Corrosion Control Programs",
        description: "Corrosion control extends unit life.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1960": [
      {
        name: "Computerized Process Control",
        description: "Analog/digital control lifts yield.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Herbicide Formulation Lines",
        description: "Agro lines open seasonal demand.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Emission Scrubber Pilots",
        description: "Scrubbers avert costly shutdowns.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Multi-Product Campaigns",
        description: "Campaign scheduling raises asset use.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Instrument Air Reliability",
        description: "Reliable air keeps loops online.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Customer Application Labs",
        description: "Labs win specifying engineers.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Hazardous Waste Protocols",
        description: "Protocols cut disposal and liability cost.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1970": [
      {
        name: "High-Purity Specialty Grades",
        description: "Specialty grades command premium prices.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Energy Cascade Projects",
        description: "Cascades cut site energy intensity.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Distributed Control Systems",
        description: "DCS stabilizes multi-unit plants.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Just-in-Time Packaging",
        description: "JIT packs cut finished inventory.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Toxicity Screening Panels",
        description: "Screens accelerate regulatory clearance.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
      {
        name: "Catalyst Lifetime Models",
        description: "Models time changeouts optimally.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Export Grade Certification",
        description: "Certifications open overseas buyers.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
    ],
  },
  healthcare: {
    "1940": [
      {
        name: "Field Hospital Logistics",
        description: "Mobile kits speed wartime care capacity.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Sterile Supply Centralization",
        description: "Central sterile cuts infection-related cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Nursing Training Pipelines",
        description: "Pipelines ease staffing bottlenecks.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Blood Bank Networks",
        description: "Networks stabilize surgical schedules.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Pharmacy Compounding Standards",
        description: "Standards cut medication waste.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Public Health Partnerships",
        description: "Partnerships expand referral volume.",
        effects: [{ kind: "marketingStrength", flat: 12 }],
      },
      {
        name: "Medical Records Indexing",
        description: "Indexed charts speed admissions.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1950": [
      {
        name: "Ward Modernization",
        description: "Modern wards raise bed turnover.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Group Practice Models",
        description: "Group practices lift physician productivity.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Diagnostic Imaging Suites",
        description: "X-ray suites raise procedure volume.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Insurance Billing Offices",
        description: "Dedicated billing raises collection rates.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Central Purchasing for Drugs",
        description: "Volume buys cut pharmacy cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Community Outreach Clinics",
        description: "Clinics widen catchment populations.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "OR Scheduling Boards",
        description: "Boards reduce idle theater time.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
    ],
    "1960": [
      {
        name: "Intensive Care Units",
        description: "ICUs raise complex-case capacity.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Lab Automation",
        description: "Automated assays cut turnaround cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Utilization Review Boards",
        description: "Review boards curb unnecessary cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Specialty Referral Networks",
        description: "Networks raise high-acuity volume.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Disposable Supply Adoption",
        description: "Disposables cut sterilization labor.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Coronary Care Protocols",
        description: "Protocols improve throughput and outcomes.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Ambulance Coordination",
        description: "Coordination raises emergency intake.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
    ],
    "1970": [
      {
        name: "Outpatient Surgery Centers",
        description: "ASC models cut inpatient overhead.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Electronic Billing Pilots",
        description: "Electronic claims speed cash collection.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Device Sterilization Plants",
        description: "In-house plants protect device margins.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Case-Mix Planning",
        description: "Case-mix models raise profitable mix.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Physician Recruiting Offices",
        description: "Recruiting fills high-demand specialties.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
      {
        name: "Infection Control Teams",
        description: "Teams cut costly outbreak disruptions.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Shared Service Laundries",
        description: "Shared services cut hotel-cost overhead.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
    ],
  },
  retail: {
    "1940": [
      {
        name: "Window Display Studios",
        description: "Displays lift walk-in conversion.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
      {
        name: "Stockroom Slotting",
        description: "Slotting cuts pick time.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Layaway Programs",
        description: "Layaway widens accessible demand.",
        effects: [{ kind: "marketingStrength", flat: 12 }],
      },
      {
        name: "Buyer Trip Consolidation",
        description: "Consolidated buying lowers travel cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Charge Account Ledgers",
        description: "House credit raises basket size.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Seasonal Markdown Discipline",
        description: "Timed markdowns protect margin.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Delivery Van Routes",
        description: "Routes extend big-ticket reach.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
    ],
    "1950": [
      {
        name: "Anchor Tenant Deals",
        description: "Anchors raise mall traffic.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Checkout Lane Design",
        description: "Faster lanes raise sales per labor hour.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Private Label Pilots",
        description: "Private label lifts margin mix.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Regional Distribution Hubs",
        description: "Hubs cut store replenishment cost.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
      {
        name: "Loss Prevention Patrols",
        description: "Patrols cut shrink.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Circular Advertising",
        description: "Circulars drive weekend traffic.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Fixture Standardization",
        description: "Shared fixtures cut remodel cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1960": [
      {
        name: "Planogram Discipline",
        description: "Planograms raise shelf productivity.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Discount Pricing Engines",
        description: "Everyday-low models grow volume.",
        effects: [{ kind: "marketingStrength", flat: 22 }],
      },
      {
        name: "Backroom Conveyors",
        description: "Conveyors speed store receiving.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Category Buyer Specialists",
        description: "Specialists improve vendor terms.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Customer Service Desks",
        description: "Service desks lift loyalty and attach rate.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
      {
        name: "Inventory Cycle Counts",
        description: "Cycle counts cut stockout loss.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Parking Lot Design",
        description: "Better access raises trip frequency.",
        effects: [{ kind: "marketingStrength", flat: 10 }],
      },
    ],
    "1970": [
      {
        name: "Point-of-Sale Scanning",
        description: "Scanning cuts checkout labor and error.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Franchise Playbooks",
        description: "Playbooks speed multi-unit rollout.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "SKU Rationalization",
        description: "Fewer SKUs raise turns and margin.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Warehouse Cross-Docking",
        description: "Cross-dock cuts handling cost.",
        effects: [{ kind: "logisticsStrength", flat: 18 }],
      },
      {
        name: "Credit Authorization Terminals",
        description: "Instant auth raises card conversion.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
      {
        name: "Energy-Efficient Stores",
        description: "Efficient stores cut occupancy cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Vendor Chargeback Systems",
        description: "Chargebacks recover noncompliance cost.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
  },
  automobiles: {
    "1940": [
      {
        name: "Military Jeep Tooling",
        description: "Shared tooling accelerates model changeovers.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Body Stamping Standardization",
        description: "Shared dies cut body cost.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Dealer Parts Pipelines",
        description: "Parts pipelines keep fleets running.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Paint Shop Throughput",
        description: "Faster paint booths raise line rate.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Engine Dyno Testing",
        description: "Dyno screens cut warranty exposure.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Rail Car Loading Docks",
        description: "Docks speed finished vehicle shipping.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Subcontractor Scorecards",
        description: "Scorecards raise supplier reliability.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1950": [
      {
        name: "Annual Model Facelifts",
        description: "Facelifts refresh demand cheaply.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
      {
        name: "Automatic Transmission Lines",
        description: "Dedicated lines raise option attach.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Dealer Network Expansion",
        description: "More dealers widen geographic reach.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Body-in-White Fixtures",
        description: "Fixtures cut assembly variation.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Warranty Claim Analytics",
        description: "Analytics target quality fixes.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Steel Coil Contracts",
        description: "Long contracts blunt input spikes.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Showroom Finance Desks",
        description: "In-house finance lifts close rates.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
    ],
    "1960": [
      {
        name: "Crash Test Regimens",
        description: "Regimens accelerate safety compliance.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Performance Trim Packages",
        description: "Packages lift ASP on volume platforms.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Unitized Body Construction",
        description: "Unitized bodies cut weight and cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Regional Assembly Plants",
        description: "Regional plants cut distribution cost.",
        effects: [{ kind: "logisticsStrength", flat: 16 }],
      },
      {
        name: "Options Configurators",
        description: "Configurators reduce misbuilt orders.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Fleet Sales Organizations",
        description: "Fleet orgs capture volume buyers.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Emissions Lab Capacity",
        description: "Labs speed certification cycles.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1970": [
      {
        name: "Front-Wheel Drive Platforms",
        description: "FWD platforms cut drivetrain cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Electronic Ignition",
        description: "Electronic systems cut warranty cost.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Supplier Park Logistics",
        description: "Nearby suppliers shrink inventory.",
        effects: [{ kind: "logisticsStrength", flat: 18 }],
      },
      {
        name: "Fuel Economy Calibration",
        description: "Calibration meets CAFE with less rework.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Robot Weld Pilots",
        description: "Weld robots raise body consistency.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Export Homologation Teams",
        description: "Teams open overseas market entries.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
      {
        name: "Recall Readiness Centers",
        description: "Centers cut recall execution cost.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
    ],
  },
  agriculture: {
    "1940": [
      {
        name: "Tractor Pool Sharing",
        description: "Shared fleets raise acre coverage.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Grain Elevator Networks",
        description: "Elevators cut post-harvest loss.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Seed Cleaning Plants",
        description: "Clean seed raises emergence rates.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Extension Service Ties",
        description: "Extension advice lifts yields.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Cold Storage Expansion",
        description: "Cold stores extend market windows.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Livestock Feed Mills",
        description: "On-site mills cut feed cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Crop Insurance Literacy",
        description: "Insurance stabilizes farm cash flow.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1950": [
      {
        name: "Anhydrous Ammonia Handling",
        description: "Safe NH3 handling raises fertilizer uptake.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Combine Harvester Fleets",
        description: "Combines raise harvest speed.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Co-op Bargaining Power",
        description: "Collective buying improves input terms.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Soil Testing Labs",
        description: "Tests target fertilizer spend.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Refrigerated Rail Cars",
        description: "Reefers open distant produce markets.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
      {
        name: "Hybrid Seed Marketing",
        description: "Hybrid campaigns raise adoption.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Irrigation Pump Maintenance",
        description: "Maintenance protects yield in dry spells.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1960": [
      {
        name: "Dwarf Variety Adoption",
        description: "High-yield dwarfs raise output per acre.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Aerial Crop Dusting",
        description: "Aerial application covers acres fast.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Pesticide Timing Windows",
        description: "Timing cuts chemical waste.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Commodity Grading Systems",
        description: "Grading captures quality premiums.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Farm Management Accounting",
        description: "Cost accounts raise operating discipline.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Export Elevator Access",
        description: "Port access opens foreign demand.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Contour Farming Practices",
        description: "Contouring protects long-run soil yield.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1970": [
      {
        name: "Center-Pivot Irrigation",
        description: "Pivots raise irrigated acre productivity.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Futures Basis Trading",
        description: "Basis trading locks better prices.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Large Tractor Economics",
        description: "Bigger power cuts labor per acre.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "On-Farm Grain Drying",
        description: "Drying protects grade and timing.",
        effects: [{ kind: "logisticsStrength", flat: 16 }],
      },
      {
        name: "Integrated Pest Management",
        description: "IPM cuts chemical spend.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Contract Growing Programs",
        description: "Contracts stabilize offtake prices.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Soil Compaction Control",
        description: "Controlled traffic protects yields.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
  },
  real_estate: {
    "1940": [
      {
        name: "Title Plant Modernization",
        description: "Faster title work speeds closings.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Property Management Offices",
        description: "Professional PM raises occupancy.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Construction Lending Desks",
        description: "Construction loans unlock pipeline.",
        effects: [{ kind: "marketingStrength", flat: 12 }],
      },
      {
        name: "Zoning Counsel Retainers",
        description: "Counsel shortens entitlement timelines.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Rent Collection Systems",
        description: "Systems cut delinquency leakage.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Maintenance Crews",
        description: "In-house crews cut contractor markup.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Site Assembly Teams",
        description: "Assemblies unlock larger projects.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
    ],
    "1950": [
      {
        name: "Tract Housing Models",
        description: "Repeated plans cut build cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Strip Center Anchors",
        description: "Anchors stabilize retail rents.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Broker Co-Broke Networks",
        description: "Networks raise absorption speed.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Subdivision Infrastructure",
        description: "Master utilities cut lot delivery cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Appraisal Standardization",
        description: "Standards speed financing.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Lawn and Amenity Packages",
        description: "Amenities lift lease rates.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
      {
        name: "Escrow Coordination",
        description: "Coordination reduces failed closings.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1960": [
      {
        name: "Mixed-Use Entitlements",
        description: "Mixed-use raises land residual value.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Elevator High-Rise Ops",
        description: "Ops playbooks cut tower vacancy.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "REIT Structuring Counsel",
        description: "Structures open institutional capital.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Parking Structure Design",
        description: "Parking raises net rentable appeal.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Lease Abstraction Systems",
        description: "Abstractions speed renewals and audits.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Urban Renewal Bids",
        description: "Public bids unlock large parcels.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
      {
        name: "Tenant Improvement Standards",
        description: "Standard TI cuts fit-out cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1970": [
      {
        name: "Class-A Office Spec",
        description: "Spec buildings capture expanding HQ demand.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Condo Conversion Playbooks",
        description: "Conversions unlock locked value.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Energy Retrofit Programs",
        description: "Retrofits cut operating expense.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Institutional Leasing Teams",
        description: "Teams land credit tenants.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
      {
        name: "Construction Cost Controls",
        description: "Controls protect development margin.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Property Tax Appeals",
        description: "Appeals reduce carrying cost.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Portfolio Asset Management",
        description: "Portfolio AM reallocates capital faster.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
    ],
  },
  construction: {
    "1940": [
      {
        name: "Critical Path Scheduling",
        description: "Early CPM thinking cuts idle crews.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Union Hiring Halls Coordination",
        description: "Coordination stabilizes crew supply.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Formwork Reuse Systems",
        description: "Reusable forms cut material cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Jobsite Safety Officers",
        description: "Safety reduces stoppages and claims.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Equipment Yard Logistics",
        description: "Yards raise heavy-equipment utilization.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Blueprint Reproduction",
        description: "Fast prints keep trades coordinated.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Bonding Capacity Expansion",
        description: "Larger bonds unlock bigger bids.",
        effects: [{ kind: "marketingStrength", flat: 12 }],
      },
    ],
    "1950": [
      {
        name: "Earthmoving Fleet Scale",
        description: "Scaled fleets win highway packages.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Prefab Component Yards",
        description: "Prefab shortens site schedules.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Survey Crew Mechanization",
        description: "Faster surveys unlock earlier starts.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Concrete Batch Plants",
        description: "On-corridor plants cut pour cost.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
      {
        name: "Change-Order Discipline",
        description: "Discipline protects contract margin.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Public Bid Estimating",
        description: "Estimating shops raise win rate.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
      {
        name: "Jobsite Radio Nets",
        description: "Radios cut coordination delay.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
    ],
    "1960": [
      {
        name: "Tower Crane Programs",
        description: "Cranes unlock dense urban schedules.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Slipform Techniques",
        description: "Slipform raises vertical productivity.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Structural Steel Detailing",
        description: "Detailing cuts field rework.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "MEP Coordination Drawings",
        description: "Coordination prevents clash delays.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Regional Material Brokers",
        description: "Brokers blunt shortage premiums.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
      {
        name: "Design-Assist Partnerships",
        description: "Early trade input cuts cost growth.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Owner Reporting Packs",
        description: "Transparent reporting wins repeats.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
    ],
    "1970": [
      {
        name: "Environmental Mitigation Plans",
        description: "Plans clear permits faster.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "CM-at-Risk Playbooks",
        description: "CMAR captures larger program fees.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Heavy-Lift Logistics",
        description: "Lift plans cut outage windows.",
        effects: [{ kind: "logisticsStrength", flat: 16 }],
      },
      {
        name: "Value Engineering Workshops",
        description: "Workshops reclaim budget contingency.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Safety Incentive Programs",
        description: "Incentives cut lost-time cost.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Computer Estimating",
        description: "Computer takeoffs raise bid accuracy.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "National Account Pursuit",
        description: "National accounts stabilize backlog.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
    ],
  },
  defense: {
    "1940": [
      {
        name: "Arsenal Management",
        description: "Arsenal practices raise surge capacity.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Acceptance Test Rigs",
        description: "Rigs cut rejected delivery lots.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Classified Document Control",
        description: "Controls protect program continuity.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Subcontract Flow-Down",
        description: "Flow-down keeps suppliers on spec.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Spare Kit Provisioning",
        description: "Kits raise field readiness revenue.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Prototype Shops",
        description: "Shops accelerate design iteration.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Congressional Liaison",
        description: "Liaison protects program funding.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
    ],
    "1950": [
      {
        name: "Systems Integration Labs",
        description: "Labs de-risk complex platforms.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Cost-Plus Discipline",
        description: "Discipline protects fee on CPFF work.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Nuclear Hardening Practices",
        description: "Hardening wins strategic contracts.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Depot Maintenance Lines",
        description: "Depots create sustainment revenue.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Configuration Management",
        description: "Config control cuts retrofit waste.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Range Test Scheduling",
        description: "Scheduling raises test asset use.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Security Clearance Pipelines",
        description: "Pipelines speed cleared labor supply.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1960": [
      {
        name: "Avionics Integration",
        description: "Avionics packages raise platform value.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Program Management Offices",
        description: "PMOs cut schedule slip cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Aerospace Materials",
        description: "Advanced materials win airframe work.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Field Service Detachments",
        description: "Detachments lock sustainment contracts.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Reliability Growth Testing",
        description: "RGT cuts early field failures.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "International Co-Production",
        description: "Co-pros open allied market access.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Lean Blueprint Release",
        description: "Faster releases cut engineering float.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1970": [
      {
        name: "Guidance Package Lines",
        description: "PGM lines raise high-margin content.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Logistics Command Interfaces",
        description: "Interfaces win long sustainment tails.",
        effects: [{ kind: "logisticsStrength", flat: 18 }],
      },
      {
        name: "Digital Design Drafting",
        description: "Digital drafting cuts revision cycles.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Competitive Proposal Centers",
        description: "Centers raise win probability.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
      {
        name: "Environmental Test Chambers",
        description: "Chambers accelerate qualification.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Obsolescence Management",
        description: "Obsolescence plans protect margins.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Multi-Year Procurement Bids",
        description: "MYPs stabilize production rates.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
    ],
  },
  telecommunications: {
    "1940": [
      {
        name: "Switchboard Automation",
        description: "Automation cuts operator labor cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Cable Plant Mapping",
        description: "Maps speed fault isolation.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Trunk Multiplexing",
        description: "Multiplexing raises circuit capacity.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Right-of-Way Crews",
        description: "Crews accelerate outside plant builds.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Directory Publishing",
        description: "Directories create ancillary revenue.",
        effects: [{ kind: "marketingStrength", flat: 12 }],
      },
      {
        name: "Emergency Restoral Plans",
        description: "Plans cut outage duration.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Toll Settlement Systems",
        description: "Settlements protect interconnect revenue.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1950": [
      {
        name: "Microwave Path Engineering",
        description: "Path engineering raises reliable hops.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Coax Amplifier Spacing",
        description: "Optimized spacing cuts plant cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Business Line Bundles",
        description: "Bundles raise commercial ARPU.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Central Office Power",
        description: "Reliable power cuts switch downtime.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Subscriber Loop Testing",
        description: "Loop tests cut truck rolls.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Leased Line Sales",
        description: "Private lines open enterprise revenue.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
      {
        name: "Cable Plowing Methods",
        description: "Plowing accelerates buried plant.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1960": [
      {
        name: "Earth Station Operations",
        description: "Earth stations open long-haul capacity.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Telex Switching Centers",
        description: "Centers monetize data messaging.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Electronic Switching Pilots",
        description: "ESS cuts space and maintenance.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Frequency Coordination",
        description: "Coordination raises usable spectrum.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Network Operations Centers",
        description: "NOCs shrink mean time to repair.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Tariff Engineering",
        description: "Engineered tariffs raise approved rates.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
      {
        name: "Underground Conduit Banks",
        description: "Conduits cut future pull cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1970": [
      {
        name: "Fiber Pilot Spans",
        description: "Fiber pilots prepare bandwidth growth.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Packet Network Trials",
        description: "Packet trials open data services.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
      {
        name: "Digital Multiplex Hierarchy",
        description: "Digital mux raises trunk efficiency.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Customer Premise Gear",
        description: "CPE attach raises installation margin.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Outside Plant Databases",
        description: "Databases speed repair dispatch.",
        effects: [{ kind: "logisticsStrength", flat: 16 }],
      },
      {
        name: "Interconnect Negotiations",
        description: "Interconnect expands addressable traffic.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Energy-Efficient Switches",
        description: "Efficient switches cut CO power cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
    ],
  },
  entertainment: {
    "1940": [
      {
        name: "Studio Lot Utilization",
        description: "Lot sharing raises stage occupancy.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Star Contract Systems",
        description: "Contracts stabilize slate marketing.",
        effects: [{ kind: "marketingStrength", flat: 15 }],
      },
      {
        name: "Soundtrack Libraries",
        description: "Libraries cut music clearance cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Theater Circuit Deals",
        description: "Circuits guarantee playdates.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
      {
        name: "Propaganda Unit Experience",
        description: "Unit experience speeds sponsored content.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Costume and Prop Reuse",
        description: "Reuse lowers episode cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Newsreel Adjacency",
        description: "Adjacency lifts theater ad inventory.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1950": [
      {
        name: "Multi-Camera Stages",
        description: "Multi-cam raises weekly output.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Hit Singles Promotion",
        description: "Radio promo lifts record sell-through.",
        effects: [{ kind: "marketingStrength", flat: 20 }],
      },
      {
        name: "Residuals Administration",
        description: "Clean residuals prevent costly disputes.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Location Scouting Offices",
        description: "Offices cut shoot delay.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Syndication Clearance",
        description: "Clearance monetizes library deeper.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Fan Club Marketing",
        description: "Fan clubs cheaply sustain demand.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
      {
        name: "Film Lab Partnerships",
        description: "Labs accelerate release prints.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
    ],
    "1960": [
      {
        name: "Festival Circuit Strategy",
        description: "Festivals raise prestige and sales.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Tour Production Logistics",
        description: "Tour logistics raise show margin.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Theme Park Licensing",
        description: "Licensing extends IP into attractions.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Color Telecine Transfer",
        description: "Transfers unlock TV aftermarkets.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Merchandising Tie-Ins",
        description: "Tie-ins raise ancillary revenue.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Soundstage Soundproofing",
        description: "Better stages cut reshoot cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "International Dubbing",
        description: "Dubbing opens overseas windows.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
    ],
    "1970": [
      {
        name: "Home Video Rights",
        description: "Video rights create new windows.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Blockbuster Event Marketing",
        description: "Event marketing lifts opening weekends.",
        effects: [{ kind: "marketingStrength", flat: 28 }],
      },
      {
        name: "Nationwide Print Runs",
        description: "Saturated prints raise first-week take.",
        effects: [{ kind: "logisticsStrength", flat: 16 }],
      },
      {
        name: "Talent Packaging Agencies",
        description: "Packages accelerate greenlights.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Soundtrack Cross-Promo",
        description: "Cross-promo lifts both film and album.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Union Rate Planning",
        description: "Rate planning protects shoot budgets.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Preview Screening Analytics",
        description: "Previews tune cuts before wide release.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
    ],
  },
  logistics: {
    "1940": [
      {
        name: "Priority Freight Boards",
        description: "Boards allocate scarce capacity.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Depot Inventory Control",
        description: "Controls cut lost shipments.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Convoy Routing Discipline",
        description: "Routing raises on-time military lifts.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Tariff Filing Expertise",
        description: "Filings protect legal rate structures.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Warehouse Labor Standards",
        description: "Standards raise picks per hour.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Lighterage Operations",
        description: "Lighterage unlocks constrained ports.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Claims Prevention Units",
        description: "Units cut damage payouts.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1950": [
      {
        name: "LTL Hub Networks",
        description: "Hubs raise less-than-truckload density.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Owner-Operator Contracts",
        description: "Contracts flex capacity with demand.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Freight Bill Auditing",
        description: "Audits recover overcharges.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Terminal Door Scheduling",
        description: "Door schedules cut dwell time.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
      {
        name: "Shipper Sales Forces",
        description: "Sales forces grow contract freight.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Reefer Fleet Maintenance",
        description: "Maintenance protects cold-chain premiums.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Interstate Authority Expansion",
        description: "Authorities widen lane coverage.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
    ],
    "1960": [
      {
        name: "Container Chassis Pools",
        description: "Pools raise box velocity.",
        effects: [{ kind: "logisticsStrength", flat: 16 }],
      },
      {
        name: "Air Freight Forwarding",
        description: "Air products capture time-sensitive premium.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Ship Stowage Planning",
        description: "Planning raises vessel utilization.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Customs Brokerage Desks",
        description: "Brokerage speeds border clearance.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
      {
        name: "Pallet Pool Participation",
        description: "Pallets cut handling damage.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Customer Track-and-Trace",
        description: "Visibility raises shipper retention.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Breakbulk Mechanization",
        description: "Mechanization cuts port labor cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
    ],
    "1970": [
      {
        name: "TOFC/COFC Ramps",
        description: "Intermodal ramps cut long-haul cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Automated Sortation",
        description: "Sortation raises hub throughput.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Computerized Dispatch",
        description: "Dispatch raises loaded-mile ratios.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Bonded Warehouse Capacity",
        description: "Bonded space wins import customers.",
        effects: [{ kind: "marketingStrength", flat: 18 }],
      },
      {
        name: "Fuel Surcharge Programs",
        description: "Surcharges protect operating margin.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Cross-Dock Facilities",
        description: "Cross-docks shrink inventory dwell.",
        effects: [{ kind: "logisticsStrength", flat: 18 }],
      },
      {
        name: "Dedicated Fleet Contracts",
        description: "Dedicated fleets lock multi-year revenue.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
    ],
  },
  extraction: {
    "1940": [
      {
        name: "Blasting Pattern Design",
        description: "Patterns raise fragmentation efficiency.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Ore Sorting on Belts",
        description: "Early sorting raises mill feed grade.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Rail Spur Construction",
        description: "Spurs cut haul distance to market.",
        effects: [{ kind: "logisticsStrength", flat: 12 }],
      },
      {
        name: "Mine Safety Boards",
        description: "Safety boards reduce stoppages.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Survey Control Networks",
        description: "Survey control cuts dilution.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Camp Logistics",
        description: "Camps support remote production continuity.",
        effects: [{ kind: "logisticsStrength", flat: 10 }],
      },
      {
        name: "Royalty Negotiation Teams",
        description: "Teams improve lease economics.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1950": [
      {
        name: "Overburden Stripping Plans",
        description: "Plans unlock ore sooner.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Heavy Truck Haulage",
        description: "Bigger trucks cut cost per ton-mile.",
        effects: [{ kind: "logisticsStrength", flat: 14 }],
      },
      {
        name: "Mill Circuit Balancing",
        description: "Balancing raises recovery.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Exploration Drill Campaigns",
        description: "Campaigns grow reserve inventory.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Power Line to Pit",
        description: "On-site power cuts diesel haul cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Concentrate Marketing",
        description: "Offtake contracts stabilize prices.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
      {
        name: "Tailings Management",
        description: "Tailings plans avert costly shutdowns.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
    ],
    "1960": [
      {
        name: "Geostatistical Block Models",
        description: "Models improve mine plans.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "In-Situ Leach Pilots",
        description: "ISL opens low-capex ore bodies.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Autogenous Milling",
        description: "AG mills cut grinding media cost.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Remote Camp Airlifts",
        description: "Airlifts keep remote sites staffed.",
        effects: [{ kind: "logisticsStrength", flat: 15 }],
      },
      {
        name: "Grade Control Sampling",
        description: "Sampling reduces ore dilution.",
        effects: [{ kind: "marginBonus", pp: 0.5 }],
      },
      {
        name: "Equipment Availability KPIs",
        description: "KPIs raise shovel and truck uptime.",
        effects: [{ kind: "growthCostReduction", pct: 0.02 }],
      },
      {
        name: "Smelter Toll Agreements",
        description: "Tolling unlocks processing capacity.",
        effects: [{ kind: "marketingStrength", flat: 14 }],
      },
    ],
    "1970": [
      {
        name: "Subsea Well Completions",
        description: "Completions unlock offshore barrels.",
        effects: [{ kind: "marginBonus", pp: 1.5 }],
      },
      {
        name: "Environmental Baseline Studies",
        description: "Baselines speed permit approval.",
        effects: [{ kind: "growthCostReduction", pct: 0.04 }],
      },
      {
        name: "Computerized Fleet Dispatch",
        description: "Dispatch raises haul productivity.",
        effects: [{ kind: "logisticsStrength", flat: 18 }],
      },
      {
        name: "High-Pressure Grinding Rolls",
        description: "HPGR cuts comminution energy.",
        effects: [{ kind: "growthCostReduction", pct: 0.03 }],
      },
      {
        name: "Community Impact Offices",
        description: "Offices reduce project opposition delay.",
        effects: [{ kind: "marketingStrength", flat: 16 }],
      },
      {
        name: "Reserve Audit Discipline",
        description: "Audits improve capital allocation.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
      {
        name: "Longwall Mining Methods",
        description: "Longwall raises underground coal rates.",
        effects: [{ kind: "marginBonus", pp: 1 }],
      },
    ],
  },
};
