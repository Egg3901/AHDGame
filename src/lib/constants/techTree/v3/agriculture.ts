import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for agriculture. */
export const AGRICULTURE_V3: V3LaneContent = {
  "1940": [
    {
      name: "Victory Acreage Drives",
      description:
        "Wartime planting campaigns push every workable acre into production at lower cost per bushel.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Certified Seed Premiums",
      description:
        "Certified seed lots and graded deliveries earn better prices from wartime buyers.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Farm Bureau Advocacy",
      description:
        "Organized county bureaus defend parity pricing and shield growers from procurement squeezes.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Land Bank Consolidation",
      description:
        "Cheap federal credit rolls small parcels into efficient operating units with shared machinery.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "laborCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "War Board Contracts",
      description:
        "Direct supply contracts with war food boards lock in premium prices for graded output.",
      effects: [
        { kind: "priceRealization", pct: 0.02 },
        { kind: "outputRate", commodity: "food", pct: 0.06 },
      ],
    },
    {
      name: "Parity Price Coalitions",
      description:
        "National grower coalitions win price floors and cheap expansion into new counties.",
      effects: [
        { kind: "dominanceShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.12 },
      ],
    },
  ],
  "1950": [
    {
      name: "Diesel Tractor Conversion",
      description:
        "Swapping gasoline fleets for diesel cuts fuel bills across every field operation.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.06 }],
    },
    {
      name: "Brand-Name Produce Packs",
      description:
        "Branded, graded packs move farm output from commodity bins to premium grocery shelves.",
      effects: [
        { kind: "priceRealization", pct: 0.01 },
        { kind: "marketingStrength", flat: 10 },
      ],
    },
    {
      name: "Rural Electrification Ties",
      description:
        "Co-op power lines open cheap new ground for dairies, dryers, and irrigation wells.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Bulk Fertilizer Buying",
      description:
        "Season-ahead bulk contracts with ammonia plants slash the biggest input line on the farm.",
      effects: [
        { kind: "inputCost", commodity: "fertilizers", pct: 0.12 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "Supermarket Supply Deals",
      description:
        "Year-round supply agreements with supermarket chains pay steady premiums for consistent grade.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "marketingStrength", flat: 25 },
      ],
    },
    {
      name: "Interstate Growing Regions",
      description:
        "Multi-state growing operations spread weather and political risk across regions.",
      effects: [
        { kind: "expansionDiscount", pct: 0.14 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Custom Harvest Crews",
      description:
        "Contracted combine crews follow the ripening front, cutting owned-equipment and labor cost.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Grade-A Dairy Standards",
      description:
        "Meeting the strictest sanitary grades moves milk and produce into the highest-paying market class.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Export License Desks",
      description:
        "Dedicated export staff navigate quotas and licenses to keep foreign sales channels open.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Feedlot Integration",
      description:
        "Integrated feedlots turn cheap grain into finished livestock with far less hired labor per head.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "outputRate", commodity: "food", pct: 0.06 },
      ],
    },
    {
      name: "Origin Label Programs",
      description: "Regional origin labels build shopper loyalty that commands lasting premiums.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "Food Aid Channels",
      description:
        "Standing food-aid and treaty channels absorb surpluses and blunt foreign tariff walls.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1970": [
    {
      name: "Fencerow Planting Economics",
      description: "Wall-to-wall planting spreads fixed machinery cost over every available acre.",
      effects: [{ kind: "growthCostReduction", pct: 0.035 }],
    },
    {
      name: "Identity-Preserved Grain",
      description:
        "Segregated handling of high-protein lots earns premiums over blended elevator grain.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Grain Embargo Hedging",
      description:
        "Diversified export buyers and forward books soften the shock of sudden trade embargoes.",
      effects: [{ kind: "tariffShield", pct: 0.11 }],
    },
    {
      name: "Million-Bushel Storage",
      description:
        "On-site storage complexes let the operation buy inputs and sell grain on its own schedule.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "inputCost", commodity: "fertilizers", pct: 0.1 },
      ],
    },
    {
      name: "Export Grade Contracts",
      description:
        "Guaranteed-grade export contracts pay top of market for consistent protein and moisture specs.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "outputRate", commodity: "food", pct: 0.07 },
      ],
    },
    {
      name: "Multi-Market Export Books",
      description:
        "Sales books spread across a dozen countries make any single tariff or embargo survivable.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1979": [
    {
      name: "Minimum Tillage Systems",
      description:
        "Fewer passes over the field cut fuel and machinery hours without hurting yield.",
      effects: [{ kind: "inputCost", commodity: "energy", pct: 0.07 }],
    },
    {
      name: "Specialty Crop Rotation",
      description:
        "Rotating high-value specialty crops into the mix lifts revenue per acre above commodity rates.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "Farm Credit Restructuring",
      description:
        "Restructured debt and cautious leverage keep land purchases cheap while rivals fold.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Fuel-Efficient Fleet Turnover",
      description:
        "Replacing the fleet with efficient engines and wide implements cuts fuel and hired hours together.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.12 },
        { kind: "laborCostReduction", pct: 0.07 },
      ],
    },
    {
      name: "Direct-to-Processor Sales",
      description:
        "Long-term processor agreements bypass the elevator and capture the middleman margin.",
      effects: [
        { kind: "priceRealization", pct: 0.023 },
        { kind: "marketingStrength", flat: 26 },
      ],
    },
    {
      name: "Distressed Land Acquisition",
      description:
        "Buying good ground from failing neighbors builds acreage at a fraction of boom prices.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1989": [
    {
      name: "Split Nitrogen Application",
      description:
        "Timing fertilizer to crop uptake cuts total nitrogen use without giving up yield.",
      effects: [{ kind: "inputCost", commodity: "fertilizers", pct: 0.07 }],
    },
    {
      name: "Organic Certification Lines",
      description: "Certified organic acreage sells into a fast-growing channel at steep premiums.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 12 },
      ],
    },
    {
      name: "Conservation Program Enrollment",
      description:
        "Enrolling marginal acres in conservation programs earns steady payments and regulator goodwill.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Whole-Farm Input Audits",
      description:
        "Field-by-field audits strip waste from fertilizer, chemical, and fuel budgets at once.",
      effects: [
        { kind: "inputCost", commodity: "fertilizers", pct: 0.12 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "National Organic Brands",
      description:
        "A recognized organic label across produce and grain lines commands shelf-price leadership.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Farm Bill Lobby Desks",
      description:
        "Permanent policy staff shape farm bill titles so subsidies and rules favor the operation.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "1999": [
    {
      name: "Yield Map Benchmarking",
      description:
        "Combine yield maps expose underperforming fields so inputs go only where they pay.",
      effects: [{ kind: "growthCostReduction", pct: 0.03 }],
    },
    {
      name: "Traceability Barcoding",
      description:
        "Lot-level traceability wins contracts with food companies that pay for documented supply.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "WTO Compliance Teams",
      description:
        "Trade-rule specialists keep exports flowing through the new global tariff regime.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Enterprise Farm Software",
      description:
        "One software backbone for agronomy, machinery, and payroll squeezes cost from every acre.",
      effects: [
        { kind: "growthCostReduction", pct: 0.06 },
        { kind: "laborCostReduction", pct: 0.07 },
      ],
    },
    {
      name: "Food Company Alliances",
      description:
        "Multi-year alliances with branded food companies pay sustained premiums for preferred supply.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "outputRate", commodity: "food", pct: 0.07 },
      ],
    },
    {
      name: "Hemispheric Sourcing",
      description:
        "Operations in both hemispheres deliver year-round supply and dodge any one country's trade fights.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "tariffShield", pct: 0.17 },
      ],
    },
  ],
  "2009": [
    {
      name: "Telematics Fleet Dispatch",
      description:
        "Live machine telematics route equipment and crews to cut idle hours and fuel burn.",
      effects: [
        { kind: "inputCost", commodity: "energy", pct: 0.06 },
        { kind: "laborCostReduction", pct: 0.03 },
      ],
    },
    {
      name: "Farm-to-Table Contracts",
      description:
        "Direct contracts with restaurants and grocers sell provenance at a premium over commodity prices.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Water Rights Portfolios",
      description:
        "Secured water rights across basins keep expansion cheap as irrigation politics tighten.",
      effects: [{ kind: "expansionDiscount", pct: 0.09 }],
    },
    {
      name: "Prescription Input Platforms",
      description:
        "Algorithmic input prescriptions cut fertilizer and seed spend per bushel across the whole base.",
      effects: [
        { kind: "inputCost", commodity: "fertilizers", pct: 0.13 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "Sustainability Scorecards",
      description:
        "Audited sustainability scores unlock the premium programs of every major food buyer.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "marketingStrength", flat: 27 },
      ],
    },
    {
      name: "Sovereign Supply Agreements",
      description:
        "Long-term supply pacts with importing governments carve protected channels through trade barriers.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "2019": [
    {
      name: "Autonomous Tillage Shifts",
      description:
        "Driverless tractors run night shifts, spreading machinery cost over double the hours.",
      effects: [{ kind: "laborCostReduction", pct: 0.05 }],
    },
    {
      name: "Regenerative Label Premiums",
      description:
        "Verified regenerative practices earn carbon-conscious buyers' premium programs.",
      effects: [
        { kind: "priceRealization", pct: 0.013 },
        { kind: "marketingStrength", flat: 11 },
      ],
    },
    {
      name: "Carbon Credit Enrollment",
      description:
        "Enrolled carbon programs add a payment stream and goodwill with climate regulators.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Full-Autonomy Field Ops",
      description:
        "Fleets of autonomous machines plant, spray, and harvest with a skeleton supervisory crew.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "outputRate", commodity: "food", pct: 0.07 },
      ],
    },
    {
      name: "Verified Provenance Platforms",
      description:
        "Blockchain-verified provenance lets premium buyers pay top price with full confidence.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 29 },
      ],
    },
    {
      name: "Climate Corridor Expansion",
      description:
        "Acquiring ground in newly favorable climate zones locks in cheap acreage ahead of the shift.",
      effects: [
        { kind: "expansionDiscount", pct: 0.17 },
        { kind: "tariffShield", pct: 0.16 },
      ],
    },
  ],
  "2029": [
    {
      name: "Closed-Loop Nutrient Cycling",
      description:
        "On-farm nutrient recovery loops cut purchased fertilizer to a fraction of field demand.",
      effects: [{ kind: "inputCost", commodity: "fertilizers", pct: 0.08 }],
    },
    {
      name: "Designer Crop Contracts",
      description:
        "Crops tuned to a buyer's exact nutrition and processing specs sell far above commodity grade.",
      effects: [{ kind: "priceRealization", pct: 0.015 }],
    },
    {
      name: "Food Security Compacts",
      description:
        "National food-security compacts guarantee market access whatever the trade climate.",
      effects: [{ kind: "tariffShield", pct: 0.12 }],
    },
    {
      name: "Lights-Out Growing Systems",
      description:
        "Fully automated growing systems run continuously with minimal labor and lean energy draw.",
      effects: [
        { kind: "laborCostReduction", pct: 0.1 },
        { kind: "inputCost", commodity: "energy", pct: 0.1 },
      ],
    },
    {
      name: "Personalized Nutrition Lines",
      description:
        "Crops bred for personalized nutrition programs command the highest prices in food.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "food", pct: 0.08 },
      ],
    },
    {
      name: "Strategic Reserve Partnerships",
      description:
        "Operating national strategic reserves makes the company politically untouchable at any scale.",
      effects: [
        { kind: "dominanceShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.15 },
      ],
    },
  ],
};
