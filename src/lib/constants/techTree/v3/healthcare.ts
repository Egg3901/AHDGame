import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for healthcare. */
export const HEALTHCARE_V3: V3LaneContent = {
  "1940": [
    {
      name: "Ward Supply Rationing",
      description:
        "Strict rationing of drugs and dressings stretches scarce wartime stocks further.",
      effects: [{ kind: "inputCost", commodity: "pharmaceuticals", pct: 0.06 }],
    },
    {
      name: "Private Room Services",
      description:
        "Private rooms and attending physicians earn premium rates from paying patients.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Civil Defense Designation",
      description: "Designation as a civil defense hospital brings protection and public standing.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Mass Casualty Drill Systems",
      description: "Drilled triage systems let the same wards and staff treat far more patients.",
      effects: [
        { kind: "outputRate", commodity: "healthcare_services", pct: 0.07 },
        { kind: "laborCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Officer Convalescent Wings",
      description:
        "Dedicated convalescent wings for officers and executives bill at the top of the rate card.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Veterans Care Contracts",
      description:
        "Long-term government care contracts guarantee beds stay funded through any politics.",
      effects: [
        { kind: "dominanceShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1950": [
    {
      name: "Central Sterile Processing",
      description:
        "One central sterilization plant serves every ward, cutting supply waste and staff time.",
      effects: [
        { kind: "inputCost", commodity: "plastics", pct: 0.05 },
        { kind: "laborCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Specialist Referral Prestige",
      description: "Named specialists draw referrals that pay well above general ward rates.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Hill-Burton Grant Office",
      description: "A grants office captures federal construction money for every new wing.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Standardized Nursing Ratios",
      description:
        "Engineered staffing ratios deliver more patient days per nurse without cutting care.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "outputRate", commodity: "healthcare_services", pct: 0.06 },
      ],
    },
    {
      name: "Flagship Medical Center Brand",
      description:
        "A flagship center with a national reputation lifts rates across the whole network.",
      effects: [
        { kind: "priceRealization", pct: 0.023 },
        { kind: "marketingStrength", flat: 27 },
      ],
    },
    {
      name: "County Health Partnerships",
      description:
        "Running county programs under contract locks in political cover and cheap sites.",
      effects: [
        { kind: "dominanceShield", pct: 0.15 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1960": [
    {
      name: "Disposables Conversion",
      description:
        "Switching to disposable syringes and trays cuts resterilization labor and losses.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "energy", pct: 0.05 },
      ],
    },
    {
      name: "Cardiac Program Reputation",
      description: "A famous cardiac program justifies premium billing across the hospital.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Medicare Certification Drive",
      description:
        "Early Medicare certification secures a durable stream of federally backed patients.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Regional Shared Services",
      description:
        "Shared labs, laundry, and purchasing across hospitals cut every member's cost base.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "inputCost", commodity: "pharmaceuticals", pct: 0.1 },
      ],
    },
    {
      name: "Teaching Hospital Affiliation",
      description:
        "University affiliation brings residents, research money, and top-of-market rates.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "outputRate", commodity: "healthcare_services", pct: 0.06 },
      ],
    },
    {
      name: "Statewide Bed Franchises",
      description:
        "Certificates of need in hand across the state make expansion cheap and rivals rare.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1970": [
    {
      name: "Group Purchasing Organization",
      description: "Pooled purchasing contracts beat down drug and supply prices for every member.",
      effects: [{ kind: "inputCost", commodity: "pharmaceuticals", pct: 0.08 }],
    },
    {
      name: "Executive Physical Programs",
      description: "Corporate physical packages sell preventive care at concierge prices.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Certificate of Need Advocacy",
      description: "Skilled advocacy at planning boards blocks rival beds while approving yours.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Unit Dose Pharmacy Systems",
      description: "Unit-dose dispensing ends ward stock waste and drug errors at once.",
      effects: [
        { kind: "inputCost", commodity: "pharmaceuticals", pct: 0.13 },
        { kind: "laborCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Tertiary Care Destination",
      description:
        "Transplant and trauma programs make the system the referral of last resort at premium rates.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Multi-State Hospital Chain",
      description: "A for-profit chain replicates its playbook state after state at falling cost.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1979": [
    {
      name: "DRG Cost Accounting",
      description: "Costing every diagnosis group exposes losing services before payers do.",
      effects: [
        { kind: "growthCostReduction", pct: 0.03 },
        { kind: "laborCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Birthing Suite Marketing",
      description: "Hotel-style birthing suites win choosy families who pay full private rates.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "marketingStrength", flat: 13 },
      ],
    },
    {
      name: "Physician Joint Ventures",
      description: "Equity ventures with admitting physicians tie referral flows to the system.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Same-Day Surgery Conversion",
      description: "Moving procedures to same-day units multiplies throughput per bed and nurse.",
      effects: [
        { kind: "outputRate", commodity: "healthcare_services", pct: 0.08 },
        { kind: "laborCostReduction", pct: 0.07 },
      ],
    },
    {
      name: "Centers of Excellence Billing",
      description: "Named centers of excellence negotiate carve-out rates payers accept.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marginBonus", pp: 0.8 },
      ],
    },
    {
      name: "Suburban Campus Rollout",
      description: "Satellite campuses follow patients to the suburbs ahead of any competitor.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1989": [
    {
      name: "Clinical Pathway Protocols",
      description: "Standard care pathways cut length of stay without touching outcomes.",
      effects: [
        { kind: "laborCostReduction", pct: 0.05 },
        { kind: "inputCost", commodity: "pharmaceuticals", pct: 0.05 },
      ],
    },
    {
      name: "Preferred Network Contracts",
      description: "Exclusive insurer contracts trade volume for rates that still beat the market.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Community Benefit Reporting",
      description: "Documented charity care defends tax exemption and quiets hostile councils.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Integrated Delivery Network",
      description:
        "Owning clinics, hospitals, and home care in one system wrings out duplicated cost.",
      effects: [
        { kind: "growthCostReduction", pct: 0.07 },
        { kind: "laborCostReduction", pct: 0.07 },
      ],
    },
    {
      name: "Destination Specialty Institutes",
      description: "Patients fly in for named institutes, and payers meet the price to send them.",
      effects: [
        { kind: "priceRealization", pct: 0.027 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Regional Merger Wave",
      description: "Rolling up regional hospitals builds bargaining weight no payer can ignore.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1999": [
    {
      name: "Formulary Management Systems",
      description: "Tiered formularies steer prescribing toward equivalent drugs at lower cost.",
      effects: [{ kind: "inputCost", commodity: "pharmaceuticals", pct: 0.08 }],
    },
    {
      name: "Quality Scorecard Publicity",
      description: "Published outcome scorecards win contracts at rates quality justifies.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 14 },
      ],
    },
    {
      name: "Patient Privacy Compliance Lead",
      description: "Getting ahead of privacy law turns compliance into a trust advantage.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Hospitalist Staffing Model",
      description:
        "Dedicated hospitalists run inpatient care with fewer handoffs and shorter stays.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "outputRate", commodity: "healthcare_services", pct: 0.06 },
      ],
    },
    {
      name: "Concierge Medicine Lines",
      description:
        "Retainer-based practices bill affluent patients directly at rates insurers never pay.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "marginBonus", pp: 0.9 },
      ],
    },
    {
      name: "Academic Alliance Network",
      description: "Alliances with medical schools spread the brand into new markets at low cost.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "2009": [
    {
      name: "EHR Meaningful Use Capture",
      description: "Records systems tuned to incentive rules recoup their own cost in subsidies.",
      effects: [
        { kind: "growthCostReduction", pct: 0.03 },
        { kind: "inputCost", commodity: "software", pct: 0.05 },
      ],
    },
    {
      name: "Patient Experience Ratings",
      description: "Top satisfaction scores feed pay-for-performance bonuses and pricing leverage.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Accountable Care Contracts",
      description:
        "Shared-savings contracts align the system with regulators writing the new rules.",
      effects: [{ kind: "dominanceShield", pct: 0.11 }],
    },
    {
      name: "Centralized Telemetry Hubs",
      description: "Remote monitoring hubs let one team watch beds across the whole network.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "inputCost", commodity: "electronics", pct: 0.1 },
      ],
    },
    {
      name: "Proton and Robotic Suites",
      description:
        "Flagship equipment suites attract self-pay and premium-plan patients nationwide.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Urgent Care Footprint",
      description: "Storefront urgent care clinics plant the flag in every zip code cheaply.",
      effects: [
        { kind: "expansionDiscount", pct: 0.17 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "2019": [
    {
      name: "Virtual Visit Triage",
      description:
        "Video triage resolves routine cases without consuming exam rooms or drive time.",
      effects: [
        { kind: "outputRate", commodity: "healthcare_services", pct: 0.04 },
        { kind: "inputCost", commodity: "energy", pct: 0.05 },
      ],
    },
    {
      name: "Genomic Screening Packages",
      description: "Cash-pay genomic screening sells prevention to patients at software margins.",
      effects: [
        { kind: "priceRealization", pct: 0.014 },
        { kind: "marginBonus", pp: 0.5 },
      ],
    },
    {
      name: "Price Transparency Compliance",
      description: "Clean published pricing keeps enforcement away while rivals draw fines.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Hospital-at-Home Programs",
      description: "Monitored home care replaces costly bed days with kits and visiting teams.",
      effects: [
        { kind: "outputRate", commodity: "healthcare_services", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Precision Oncology Service Line",
      description:
        "Matched-therapy cancer programs command the highest negotiated rates in medicine.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "inputCost", commodity: "pharmaceuticals", pct: 0.1 },
      ],
    },
    {
      name: "Payer-Provider Combination",
      description:
        "Owning the insurance plan closes the loop, and lawmakers deal with you as a bloc.",
      effects: [
        { kind: "dominanceShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "2029": [
    {
      name: "Ambient Clinical Documentation",
      description:
        "Speech systems write the chart during the visit, freeing clinicians from keyboards.",
      effects: [{ kind: "laborCostReduction", pct: 0.05 }],
    },
    {
      name: "Longevity Clinic Memberships",
      description: "Subscription longevity programs bill healthy patients year after year.",
      effects: [
        { kind: "priceRealization", pct: 0.015 },
        { kind: "marketingStrength", flat: 15 },
      ],
    },
    {
      name: "Algorithmic Care Audit Trail",
      description: "Auditable AI decision logs satisfy regulators before questions get asked.",
      effects: [{ kind: "dominanceShield", pct: 0.12 }],
    },
    {
      name: "Autonomous Logistics Wards",
      description:
        "Robotic supply, transport, and cleaning crews run the building around the clinicians.",
      effects: [
        { kind: "laborCostReduction", pct: 0.1 },
        { kind: "inputCost", commodity: "plastics", pct: 0.1 },
      ],
    },
    {
      name: "Curative Therapy Center",
      description: "One-time curative treatments price against a lifetime of avoided care.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "outputRate", commodity: "healthcare_services", pct: 0.06 },
      ],
    },
    {
      name: "National Health Compact",
      description:
        "Standing capacity agreements with governments guarantee funding in any reform wave.",
      effects: [
        { kind: "dominanceShield", pct: 0.23 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
};
