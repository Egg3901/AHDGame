/**
 * Sector Operating Strategies.
 *
 * Each sector type has 2–3 strategies that change its commodity input/output
 * rates. Margin impacts come naturally from commodity market dynamics — there
 * is NO direct margin modifier per strategy. During a transition, a flat −5%
 * margin penalty applies to represent retooling disruption.
 *
 * Switching strategy costs 25% of daily revenue, transitions linearly over
 * 12 turns, and has a 24-turn cooldown from initiation (runs concurrently
 * with the transition).
 */

import type { CorporationType } from "./corporations";
import type { CommodityType } from "./commodities";
import { COMMODITY_BASE_PRICES } from "./commodities";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Number of turns for the linear transition between strategies */
export const STRATEGY_TRANSITION_TURNS = 12;

/** Cooldown turns from initiation before another strategy change is allowed */
export const STRATEGY_COOLDOWN_TURNS = 24;

/** Fraction of daily revenue charged when initiating a strategy change */
export const STRATEGY_RETOOL_COST_FRACTION = 0.25;

/** Margin penalty (percentage points) applied while a transition is in progress */
export const STRATEGY_TRANSITION_MARGIN_PENALTY = -5;

/** Fraction of daily revenue charged when cancelling a transition mid-flight (scales with progress) */
export const CANCEL_COST_FRACTION = 0.1;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SectorStrategy {
  id: string;
  name: string;
  description: string;
  supply: Partial<Record<CommodityType, number>>;
  demand: Partial<Record<CommodityType, number>>;
  /**
   * Sector tech-tree gating (v2). When the tech-trees feature is on:
   *  - `minDecade`: the world must have reached this decade (id, e.g. "2009").
   *  - `requiresTechUnlock`: the corp must have unlocked this strategy via a
   *    tech node carrying `unlockStrategy: <this id>`.
   * Both may apply. Absent ⇒ always available (legacy / baseline methods).
   * See lib/constants/techTree/strategyAvailability.
   */
  minDecade?: string;
  requiresTechUnlock?: boolean;
}

export interface EffectiveStrategyRates {
  supply: Partial<Record<CommodityType, number>>;
  demand: Partial<Record<CommodityType, number>>;
  /** True when a transition is actively in progress (−5% margin penalty applies) */
  isTransitioning: boolean;
}

// ─── Strategy definitions ───────────────────────────────────────────────────

export const SECTOR_STRATEGIES: Record<CorporationType, SectorStrategy[]> = {
  // ── Energy ──────────────────────────────────────────────────────────────
  energy: [
    {
      id: "fracking",
      requiresTechUnlock: true,
      minDecade: "2009",
      name: "Hydraulic Fracturing",
      description:
        "Maximal hydrocarbon output: energy, oil and gas all flow, at the cost of heavy steel, chemical, water-handling and sand inputs.",
      supply: { energy: 0.6, oil: 0.14, natural_gas: 0.14 },
      demand: {
        steel: 0.2,
        chemicals: 0.18,
        iron: 0.08,
        freight: 0.1,
        construction_services: 0.1,
      },
    },
    {
      id: "standard",
      name: "Conventional",
      description: "Traditional fossil-fuel energy generation with established infrastructure.",
      // Matches SECTOR_SUPPLY/SECTOR_DEMAND in commodities.ts (energy output 0.65, oil 0.07, copper 0.04).
      supply: { energy: 0.65 },
      demand: {
        steel: 0.15,
        coal: 0.15,
        oil: 0.07,
        vehicles: 0.1,
        construction_services: 0.05,
        rare_earth: 0.04,
        natural_gas: 0.12,
      },
    },
    {
      id: "renewables",
      requiresTechUnlock: true,
      minDecade: "1999",
      name: "Renewables Focus",
      description:
        "Solar, wind, and battery storage. Lower output but demands electronics for panels and inverters.",
      // Buffed energy output 0.50→0.55; reduced electronics 0.25→0.17 and rare_earth 0.10→0.07
      // to make renewables more competitive. Building materials raised 0.10→0.12 for civil works.
      supply: { energy: 0.55 },
      demand: {
        electronics: 0.17,
        rare_earth: 0.07,
        building_materials: 0.12,
        steel: 0.1,
        construction_services: 0.08,
      },
    },
    {
      id: "nuclear",
      requiresTechUnlock: true,
      name: "Nuclear Expansion",
      description:
        "High energy output from nuclear reactors. Heavy steel and chemical requirements, plus strict regulation.",
      // Reduced steel 0.30→0.20 (nuclear is a dominant steel consumer at 125/202 sectors);
      // added iron 0.08 for structural fabrication as a more targeted input.
      supply: { energy: 0.7 },
      demand: {
        steel: 0.2,
        iron: 0.08,
        chemicals: 0.15,
        consulting_services: 0.1,
        construction_services: 0.1,
      },
    },
    {
      id: "smart_grid",
      requiresTechUnlock: true,
      minDecade: "2009",
      name: "Smart Grid",
      description:
        "Sensor-rich, demand-responsive generation. High electronics and software draw, strong steady output.",
      supply: { energy: 0.62 },
      demand: {
        electronics: 0.2,
        software: 0.12,
        rare_earth: 0.06,
        steel: 0.08,
        construction_services: 0.06,
      },
    },
    {
      id: "fusion",
      requiresTechUnlock: true,
      minDecade: "2029",
      name: "Fusion Generation",
      description:
        "Pilot fusion reactors deliver the highest clean output, demanding rare earths, electronics, and steel.",
      supply: { energy: 0.85 },
      demand: {
        rare_earth: 0.12,
        electronics: 0.15,
        steel: 0.15,
        chemicals: 0.1,
        consulting_services: 0.1,
      },
    },
  ],

  // ── Manufacturing ─────────────────────────────────────────────────────
  manufacturing: [
    {
      id: "additive_manufacturing",
      requiresTechUnlock: true,
      minDecade: "2009",
      name: "Additive Manufacturing",
      description:
        "3D-printed parts and electronics with minimal tooling: flexible electronics-heavy output, demanding rare earths, energy and polymers.",
      supply: { electronics: 0.22, steel: 0.22, building_materials: 0.1 },
      demand: { rare_earth: 0.12, energy: 0.2, software: 0.1, plastics: 0.12 },
    },
    {
      id: "autonomous_factory",
      requiresTechUnlock: true,
      minDecade: "2029",
      name: "Autonomous Factory",
      description:
        "Lights-out production with robotics and AI. Strong steel output at low labor, demanding electronics and software.",
      supply: { steel: 0.45, building_materials: 0.18 },
      demand: { energy: 0.18, electronics: 0.15, software: 0.1, iron: 0.1 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "Balanced steel and building materials production from iron and coal inputs.",
      supply: { steel: 0.4, building_materials: 0.2 },
      demand: {
        energy: 0.2,
        iron: 0.15,
        coal: 0.1,
        electronics: 0.1,
        freight: 0.1,
        real_estate_services: 0.03,
        plastics: 0.08,
      },
    },
    {
      id: "heavy_metals",
      name: "Heavy Metals",
      description:
        "Focused steel and metals production. Higher steel output, heavier iron and coal consumption.",
      // Reduced iron 0.25→0.20 and coal 0.20→0.16 to ease pressure on two of the worst
      // shortages (iron D/S ~3.4×, coal ~2.1×) without removing the heavy-metals flavor.
      supply: { steel: 0.55 },
      demand: { iron: 0.2, coal: 0.16, energy: 0.25, freight: 0.1, plastics: 0.03 },
    },
    {
      id: "electronics_manufacturing",
      minDecade: "1979",
      name: "Electronics Manufacturing",
      description:
        "Circuit boards, components, and consumer electronics. Produces electronics alongside steel, demands rare earth.",
      supply: { electronics: 0.3, steel: 0.2 },
      demand: { rare_earth: 0.15, iron: 0.1, energy: 0.2, chemicals: 0.1, plastics: 0.1 },
    },
  ],

  // ── Technology ────────────────────────────────────────────────────────
  technology: [
    {
      id: "quantum_computing",
      requiresTechUnlock: true,
      minDecade: "2029",
      name: "Quantum Computing",
      description:
        "Frontier quantum services: premium software output backed by exotic hardware, hungry for rare earths and energy.",
      supply: { software: 0.5, electronics: 0.18 },
      demand: { rare_earth: 0.15, energy: 0.25, consulting_services: 0.1 },
    },
    {
      id: "ai_platforms",
      requiresTechUnlock: true,
      minDecade: "2029",
      name: "AI Platforms",
      description:
        "Frontier-AI products and services. Software-dominant output with heavy computing power and energy draw.",
      supply: { software: 0.6 },
      demand: { energy: 0.22, electronics: 0.12, consulting_services: 0.1, rare_earth: 0.05 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "Balanced hardware and software development.",
      supply: { electronics: 0.35, software: 0.35 },
      demand: {
        energy: 0.15,
        rare_earth: 0.08,
        steel: 0.05,
        consulting_services: 0.08,
        real_estate_services: 0.03,
      },
    },
    {
      id: "hardware",
      name: "Hardware Focus",
      description:
        "Semiconductor fabs and chip manufacturing. High electronics output but heavy raw material needs.",
      supply: { electronics: 0.55, software: 0.15 },
      demand: { energy: 0.2, rare_earth: 0.15, steel: 0.1, chemicals: 0.1 },
    },
    {
      id: "software",
      name: "Software Focus",
      description:
        "Cloud platforms and enterprise software. Lighter on raw materials, heavier on consulting.",
      supply: { software: 0.55, electronics: 0.15 },
      demand: { consulting_services: 0.15, energy: 0.1 },
    },
  ],

  // ── Agriculture ───────────────────────────────────────────────────────
  agriculture: [
    {
      id: "vertical_farming",
      requiresTechUnlock: true,
      minDecade: "2019",
      name: "Vertical Farming",
      description:
        "Stacked indoor production: high food yield with almost no fertilizer, but a heavy appetite for energy, electronics and software.",
      supply: { food: 0.5 },
      demand: { energy: 0.28, electronics: 0.12, software: 0.1, construction_services: 0.08 },
    },
    {
      id: "precision_ag",
      requiresTechUnlock: true,
      minDecade: "2029",
      name: "Precision Agriculture",
      description:
        "Autonomous, sensor-driven farming. High food output with software and electronics inputs, lighter on fertilizer.",
      supply: { food: 0.56 },
      demand: { fertilizers: 0.08, energy: 0.12, software: 0.1, electronics: 0.08 },
    },
    {
      id: "standard",
      name: "Traditional",
      description: "Conventional farming with standard fertilizer and machinery inputs.",
      // Reduced food output 0.55→0.50: food moved to oversupply (D/S ~0.85×) after the
      // prior supply boost. Lower rate rebalances toward target D/S.
      supply: { food: 0.5 },
      demand: { fertilizers: 0.15, vehicles: 0.1, energy: 0.1, freight: 0.08, plastics: 0.05 },
    },
    {
      id: "industrial",
      minDecade: "1940",
      name: "Industrial",
      description:
        "Large-scale industrial agriculture. Higher yields through intensive fertilizer use and energy.",
      // Reduced food output 0.60→0.54 proportionally.
      supply: { food: 0.54 },
      demand: { fertilizers: 0.25, energy: 0.15, oil: 0.1, vehicles: 0.1, plastics: 0.09 },
    },
    {
      id: "sustainable",
      minDecade: "1960",
      name: "Sustainable",
      description:
        "Organic and regenerative farming. Lower output but reduced fertilizer dependency.",
      // Reduced food output 0.40→0.36 proportionally.
      supply: { food: 0.36 },
      demand: { fertilizers: 0.05, vehicles: 0.05, freight: 0.1, software: 0.08, plastics: 0.03 },
    },
  ],

  // ── Chemical Industries ───────────────────────────────────────────────
  chemical_industries: [
    {
      id: "specialty_chemicals",
      requiresTechUnlock: true,
      minDecade: "1989",
      name: "Specialty Chemicals",
      description:
        "High-value fine and specialty chemicals plus drug ingredients: richer output mix for more electronics and energy.",
      supply: { chemicals: 0.42, pharmaceuticals: 0.12 },
      demand: { chemicals: 0.12, energy: 0.12, electronics: 0.08, oil: 0.1 },
    },
    {
      id: "standard",
      name: "Industrial Chemicals",
      description: "Balanced production of industrial chemical feedstocks and process materials.",
      // Added plastics co-production 0.15 to match SECTOR_SUPPLY update (Phase 4).
      // Polymer synthesis is integral to large chemical plants.
      supply: { chemicals: 0.5, plastics: 0.15 },
      demand: {
        energy: 0.18,
        oil: 0.15,
        freight: 0.08,
        real_estate_services: 0.02,
        vehicles: 0.1,
      },
    },
    {
      id: "fertilizers",
      name: "Fertilizer Production",
      description:
        "Nitrogen, phosphate, and potash processing tuned for agricultural demand with some chemical byproducts.",
      supply: { fertilizers: 0.5, chemicals: 0.1 },
      demand: { chemicals: 0.1, energy: 0.15, oil: 0.08, freight: 0.08, vehicles: 0.1 },
    },
    {
      id: "pharmaceuticals",
      minDecade: "1950",
      name: "Pharmaceuticals",
      description:
        "High-value drug manufacturing with regulated lab processes and higher technical inputs.",
      supply: { pharmaceuticals: 0.45, chemicals: 0.1 },
      demand: {
        chemicals: 0.2,
        electronics: 0.12,
        software: 0.1,
        energy: 0.08,
        freight: 0.05,
        vehicles: 0.1,
      },
    },
    {
      id: "plastics",
      minDecade: "1940",
      name: "Plastics & Polymers",
      description:
        "Petroleum-derived resin and polymer production for automotive, packaging, and construction industries. Heavy oil feedstock consumption.",
      supply: { plastics: 0.45, chemicals: 0.1 },
      demand: {
        oil: 0.25,
        energy: 0.15,
        chemicals: 0.08,
        freight: 0.08,
        vehicles: 0.05,
      },
    },
  ],

  healthcare: [
    {
      id: "telehealth",
      requiresTechUnlock: true,
      minDecade: "2009",
      name: "Telehealth Network",
      description:
        "Remote, software-driven care: high service output at low facility cost, leaning on software and electronics.",
      supply: { healthcare_services: 0.55 },
      demand: { software: 0.18, electronics: 0.12, pharmaceuticals: 0.08, energy: 0.05 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "General patient care delivery across clinics, hospitals, and care networks.",
      // Reduced pharma 0.15→0.11 and electronics 0.15→0.11 to match SECTOR_DEMAND update.
      supply: { healthcare_services: 0.5 },
      demand: {
        pharmaceuticals: 0.11,
        electronics: 0.11,
        software: 0.12,
        energy: 0.05,
        real_estate_services: 0.04,
        food: 0.05,
        vehicles: 0.025,
        plastics: 0.06,
      },
    },
    {
      id: "biotech",
      name: "Hospital Networks",
      description:
        "Large integrated hospital systems with more capacity and heavier staffing, technology, and facility needs.",
      supply: { healthcare_services: 0.6 },
      demand: {
        pharmaceuticals: 0.18,
        electronics: 0.2,
        software: 0.15,
        energy: 0.08,
        real_estate_services: 0.06,
        food: 0.06,
        vehicles: 0.03,
        plastics: 0.08,
      },
    },
    {
      id: "pharma_mass",
      name: "Outpatient & Preventive",
      description:
        "Lower-cost outpatient, urgent care, and preventive medicine delivery with lighter facility overhead.",
      supply: { healthcare_services: 0.45 },
      demand: {
        pharmaceuticals: 0.12,
        software: 0.16,
        consulting_services: 0.08,
        electronics: 0.1,
        real_estate_services: 0.03,
        food: 0.03,
        vehicles: 0.02,
        plastics: 0.04,
      },
    },
  ],

  // ── Automobiles ───────────────────────────────────────────────────────
  automobiles: [
    {
      id: "autonomous_driving",
      requiresTechUnlock: true,
      minDecade: "2029",
      name: "Autonomous Vehicles",
      description:
        "Self-driving vehicle production with an onboard software layer. Heavy electronics and software demand.",
      supply: { vehicles: 0.5, software: 0.08 },
      demand: { electronics: 0.2, steel: 0.1, energy: 0.15, software: 0.1, advertising: 0.04 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "Traditional automotive manufacturing with internal combustion focus.",
      supply: { vehicles: 0.5 },
      demand: {
        steel: 0.25,
        iron: 0.1,
        electronics: 0.15,
        energy: 0.1,
        freight: 0.08,
        real_estate_services: 0.02,
        plastics: 0.12,
      },
    },
    {
      id: "ev",
      requiresTechUnlock: true,
      minDecade: "2009",
      name: "EV Focus",
      description:
        "Electric vehicle production. Heavy battery and electronics demand, reduced steel needs.",
      // Redistributed electronics demand 0.30→0.22 toward rare_earth 0.10→0.14 (battery
      // cathodes), software 0.10→0.16 (vehicle OS/firmware), and added steel 0.10
      // for chassis and body panels. Reflects real EV Bill of Materials more accurately
      // and reduces electronics D/S pressure from EV ramp-up.
      supply: { vehicles: 0.45 },
      demand: {
        electronics: 0.22,
        rare_earth: 0.14,
        energy: 0.15,
        software: 0.16,
        steel: 0.1,
        plastics: 0.1,
      },
    },
    {
      id: "heavy_machinery",
      name: "Heavy Machinery",
      description:
        "Industrial vehicles, trucks, and construction equipment. Steel-intensive, robust margins.",
      supply: { vehicles: 0.55 },
      demand: {
        steel: 0.35,
        iron: 0.15,
        energy: 0.15,
        freight: 0.1,
        plastics: 0.05,
        advertising: 0.05,
      },
    },
  ],

  // ── Financial ─────────────────────────────────────────────────────────
  financial: [
    {
      id: "algorithmic_trading",
      requiresTechUnlock: true,
      minDecade: "2009",
      name: "Algorithmic Trading",
      description:
        "Automated markets: peak financial-services output powered by software and computing power instead of staff.",
      supply: { financial_services: 0.6 },
      demand: { software: 0.2, electronics: 0.1, consulting_services: 0.08, energy: 0.06 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "Traditional banking and financial services.",
      supply: { financial_services: 0.5 },
      demand: {
        software: 0.2,
        electronics: 0.05,
        consulting_services: 0.1,
        real_estate_services: 0.04,
      },
    },
    {
      id: "fintech",
      requiresTechUnlock: true,
      minDecade: "1999",
      name: "Fintech",
      description:
        "Digital-first financial services. Produces software alongside financial products.",
      supply: { financial_services: 0.45, software: 0.15 },
      demand: { software: 0.25, electronics: 0.15 },
    },
    {
      id: "traditional_banking",
      name: "Traditional Banking",
      description:
        "Branch-heavy retail banking with personal advisory services. High consulting overhead.",
      supply: { financial_services: 0.55 },
      demand: { consulting_services: 0.15, real_estate_services: 0.08 },
    },
  ],

  // ── Media ─────────────────────────────────────────────────────────────
  media: [
    {
      id: "streaming_media",
      requiresTechUnlock: true,
      minDecade: "2009",
      name: "Streaming Media",
      description:
        "Direct-to-consumer streaming: strong content and ad output that runs on software, networks and energy.",
      supply: { advertising: 0.3, entertainment_services: 0.3 },
      demand: { software: 0.15, network_services: 0.12, energy: 0.08 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "Mixed traditional and digital media operations.",
      supply: { advertising: 0.5 },
      demand: {
        software: 0.15,
        electronics: 0.1,
        consulting_services: 0.06,
        real_estate_services: 0.03,
      },
    },
    {
      id: "digital_first",
      minDecade: "1999",
      name: "Digital-First",
      description:
        "Streaming and online-first media. Co-produces software platforms alongside advertising.",
      supply: { advertising: 0.4, software: 0.15 },
      demand: { software: 0.2, electronics: 0.15 },
    },
    {
      id: "legacy_broadcast",
      name: "Legacy Broadcast",
      description:
        "Television and radio infrastructure. Higher advertising output but aging infrastructure costs.",
      supply: { advertising: 0.55 },
      demand: { electronics: 0.15, energy: 0.1 },
    },
  ],

  // ── Defense ───────────────────────────────────────────────────────────
  defense: [
    {
      id: "directed_energy",
      requiresTechUnlock: true,
      minDecade: "2029",
      name: "Directed-Energy Systems",
      description:
        "Laser and microwave weapons: high ordnance output that runs on energy, electronics and rare earths rather than raw metal.",
      supply: { ordnance: 0.5 },
      demand: { energy: 0.28, electronics: 0.2, rare_earth: 0.1 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "Balanced defense manufacturing: vehicles, electronics, and weapons systems.",
      supply: { vehicles: 0.2, electronics: 0.15, ordnance: 0.1 },
      demand: {
        steel: 0.2,
        iron: 0.1,
        rare_earth: 0.05,
        electronics: 0.2,
        software: 0.1,
        construction_services: 0.05,
        vehicles: 0.03,
      },
    },
    {
      id: "cyber",
      requiresTechUnlock: true,
      minDecade: "1999",
      name: "Cyber Warfare",
      description:
        "Cybersecurity and electronic warfare systems. Software-heavy production and consumption.",
      supply: { electronics: 0.25, software: 0.2 },
      demand: { software: 0.2, electronics: 0.15, consulting_services: 0.1, vehicles: 0.02 },
    },
    {
      id: "heavy_armor",
      name: "Heavy Armor",
      description:
        "Tanks, armored vehicles, and heavy weaponry. Steel-intensive traditional defense.",
      supply: { vehicles: 0.35 },
      demand: {
        steel: 0.3,
        iron: 0.15,
        energy: 0.15,
        freight: 0.1,
        construction_services: 0.08,
        vehicles: 0.03,
      },
    },
    {
      id: "munitions",
      name: "Munitions & Arms Export",
      description:
        "High-volume ordnance, missiles, and weapons systems for domestic supply and allied export. Chemical-intensive propellant production.",
      supply: { ordnance: 0.45, chemicals: 0.05 },
      demand: {
        steel: 0.2,
        iron: 0.1,
        chemicals: 0.15,
        energy: 0.12,
        rare_earth: 0.08,
        freight: 0.08,
      },
    },
    // ── Lines added for the national arsenal (C2) ──────────────────────────
    //
    // The five entries above reach only ground and air. A per-domain arsenal needs naval,
    // marine, rocket and space suppliers too, and adding production strategies extends the
    // lever the CEO already pulls rather than bolting a second "what this plant makes"
    // field beside it.
    //
    // Rates were set against a measured commodity board, not chosen at a desk. On the live
    // testing world: energy D/S 2.25 and freight 1.612 are the tightest markets a defence
    // plant touches, so all three lean off both (≤0.10 each, against the 0.12–0.15 the
    // older entries use). steel 0.558 and chemicals 0.651 are the loosest, so naval and
    // missile respectively lean INTO them — new demand there relieves an oversupply rather
    // than tightening a shortage. rare_earth is capped at munitions' 0.08.
    {
      id: "naval_systems",
      name: "Naval Systems",
      description:
        "Hulls, propulsion and shipboard weapons. The most capital-intensive defence line: enormous steel and yard throughput for a small number of very large platforms.",
      supply: { vehicles: 0.3, steel: 0.1 },
      demand: {
        steel: 0.32,
        iron: 0.1,
        energy: 0.1,
        construction_services: 0.06,
        electronics: 0.06,
        freight: 0.05,
      },
    },
    {
      id: "missile_systems",
      name: "Missile & Rocket Systems",
      description:
        "Ballistic and guided rocketry: propellant chemistry, guidance electronics and warhead assembly for strategic and battlefield missile forces.",
      supply: { ordnance: 0.4, electronics: 0.05 },
      demand: {
        chemicals: 0.18,
        steel: 0.18,
        electronics: 0.12,
        energy: 0.1,
        rare_earth: 0.05,
        freight: 0.05,
      },
    },
    {
      id: "aerospace",
      name: "Aerospace Systems",
      description:
        "Airframes, avionics and orbital systems. Electronics-heavy on both sides of the ledger — an aerospace prime consumes components and ships finished avionics.",
      supply: { vehicles: 0.2, electronics: 0.18 },
      demand: {
        steel: 0.18,
        electronics: 0.12,
        energy: 0.1,
        rare_earth: 0.06,
        freight: 0.04,
      },
    },
  ],

  // ── Real Estate ───────────────────────────────────────────────────────
  real_estate: [
    {
      id: "proptech",
      requiresTechUnlock: true,
      minDecade: "2019",
      name: "PropTech Platforms",
      description:
        "Smart-building and digital-leasing operations: higher service output at lower overhead via software.",
      supply: { real_estate_services: 0.55 },
      demand: { software: 0.15, electronics: 0.08, energy: 0.06 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "Mixed residential and commercial property ownership, leasing, and development.",
      // Reduced financial_services 0.15→0.10 to match SECTOR_DEMAND update.
      supply: { real_estate_services: 0.45 },
      demand: {
        construction_services: 0.2,
        building_materials: 0.12,
        steel: 0.08,
        energy: 0.08,
        financial_services: 0.1,
      },
    },
    {
      id: "commercial",
      name: "Commercial Development",
      description:
        "Office towers and retail complexes. Higher leasing output with heavier construction and financing needs.",
      // Reduced financial_services 0.20→0.13 proportionally.
      supply: { real_estate_services: 0.5 },
      demand: {
        construction_services: 0.25,
        steel: 0.15,
        financial_services: 0.13,
        consulting_services: 0.1,
      },
    },
    {
      id: "green_building",
      name: "Green Building",
      description:
        "Efficient buildings and smart property operations. Lower leasing output, more technology-heavy inputs.",
      supply: { real_estate_services: 0.38 },
      demand: {
        construction_services: 0.18,
        electronics: 0.15,
        software: 0.1,
        building_materials: 0.12,
      },
    },
  ],

  construction: [
    {
      id: "modular_construction",
      requiresTechUnlock: true,
      minDecade: "2019",
      name: "Modular Construction",
      description:
        "Factory-built room modules: faster, higher output that shifts cost to freight and steel.",
      supply: { construction_services: 0.5, building_materials: 0.15 },
      demand: { steel: 0.15, freight: 0.12, energy: 0.1 },
    },
    {
      id: "standard",
      name: "General Contracting",
      description: "Balanced residential, commercial, and civil construction services.",
      // Reduced building_materials 0.20→0.15, copper 0.06→0.04, natural_gas 0.03→0.02,
      // timber 0.10→0.08 to match SECTOR_DEMAND update.
      supply: { construction_services: 0.45 },
      demand: {
        building_materials: 0.15,
        steel: 0.15,
        energy: 0.12,
        vehicles: 0.1,
        financial_services: 0.05,
        rare_earth: 0.04,
        natural_gas: 0.02,
        timber: 0.08,
        plastics: 0.07,
      },
    },
    {
      id: "infrastructure",
      name: "Infrastructure Buildout",
      description:
        "Roads, utilities, transit, and heavy civil work. Higher output with heavier materials demand.",
      // Added building_materials co-production 0.08 (prefab elements, road aggregate).
      // Reduced building_materials demand 0.30→0.22 and vehicles 0.12→0.10 to ease stacking.
      supply: { construction_services: 0.55, building_materials: 0.08 },
      demand: {
        building_materials: 0.22,
        steel: 0.2,
        energy: 0.15,
        vehicles: 0.1,
        consulting_services: 0.08,
        plastics: 0.1,
      },
    },
    {
      id: "modular",
      name: "Modular Construction",
      description:
        "Prefabricated and software-assisted construction. Lower raw-material intensity with more tech inputs.",
      supply: { construction_services: 0.4 },
      demand: {
        building_materials: 0.18,
        steel: 0.1,
        electronics: 0.12,
        software: 0.08,
        energy: 0.1,
        plastics: 0.09,
      },
    },
  ],

  // ── Telecommunications ────────────────────────────────────────────────
  telecommunications: [
    {
      id: "mobile_5g",
      requiresTechUnlock: true,
      minDecade: "2029",
      name: "5G / 6G Networks",
      description:
        "Dense next-gen wireless with computing power. Network-services output with strong electronics and software draw.",
      supply: { network_services: 0.55, software: 0.15 },
      demand: { electronics: 0.18, energy: 0.12, rare_earth: 0.05, consulting_services: 0.08 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "Traditional telecom infrastructure and services.",
      // Added network_services supply 0.40 — unique output for telecom differentiation.
      // Reduced electronics 0.25→0.18 and copper 0.12→0.09 to match SECTOR_DEMAND update.
      supply: { software: 0.2, network_services: 0.4 },
      demand: {
        electronics: 0.18,
        energy: 0.1,
        building_materials: 0.06,
        construction_services: 0.08,
        real_estate_services: 0.03,
        rare_earth: 0.09,
      },
    },
    {
      id: "infrastructure",
      name: "5G/Infrastructure",
      description:
        "Next-gen network buildout. High network service output with heavier infrastructure investment.",
      // Network-services specialist: 0.55 network_services (up from 0.35) and 0.10 software.
      // Demand reflects physical infrastructure capex (construction, steel) rather than
      // ongoing component consumption — electronics lowered to 0.12, copper to 0.06.
      supply: { software: 0.1, network_services: 0.55 },
      demand: {
        construction_services: 0.15,
        steel: 0.08,
        electronics: 0.12,
        energy: 0.12,
        building_materials: 0.05,
        rare_earth: 0.06,
      },
    },
    {
      id: "cloud",
      requiresTechUnlock: true,
      minDecade: "2009",
      name: "Cloud Services",
      description: "Data centers and cloud computing. High software output, energy-intensive.",
      // Added network_services supply 0.30. Reduced energy 0.20→0.18 (efficiency gains).
      supply: { software: 0.35, network_services: 0.3 },
      demand: { energy: 0.18, electronics: 0.15, real_estate_services: 0.04 },
    },
  ],

  // ── Entertainment ─────────────────────────────────────────────────────
  entertainment: [
    {
      id: "live_service",
      requiresTechUnlock: true,
      minDecade: "2019",
      name: "Live-Service Platforms",
      description:
        "Always-on games and experiences with ongoing revenue: high entertainment output on software and networks.",
      supply: { entertainment_services: 0.5 },
      demand: { software: 0.18, network_services: 0.1, energy: 0.06 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "Mixed entertainment: studios, venues, and digital content.",
      // Added entertainment_services supply 0.40 — unique output for entertainment differentiation.
      supply: { advertising: 0.2, entertainment_services: 0.4 },
      demand: { software: 0.15, electronics: 0.1, energy: 0.06, real_estate_services: 0.03 },
    },
    {
      id: "streaming",
      minDecade: "2009",
      name: "Streaming/Digital",
      description:
        "Digital-first entertainment platforms. Co-produces software, energy-intensive streaming.",
      // Added entertainment_services supply 0.35.
      supply: { advertising: 0.15, software: 0.1, entertainment_services: 0.35 },
      demand: { software: 0.2, energy: 0.1, real_estate_services: 0.02 },
    },
    {
      id: "live_venue",
      name: "Live/Venue",
      description:
        "Concert halls, theaters, and live events. Higher advertising output, physical infrastructure needs.",
      // Added entertainment_services supply 0.50. Reduced construction_services 0.12→0.08
      // to ease input stacking on a scarce commodity.
      supply: { advertising: 0.25, entertainment_services: 0.5 },
      demand: {
        construction_services: 0.08,
        building_materials: 0.06,
        energy: 0.1,
        freight: 0.08,
        real_estate_services: 0.05,
        food: 0.08,
      },
    },
  ],

  // ── Retail ────────────────────────────────────────────────────────────
  retail: [
    {
      id: "ecommerce_fulfillment",
      requiresTechUnlock: true,
      minDecade: "2009",
      name: "E-Commerce Fulfillment",
      description:
        "Online-first retail run from fulfillment centers: high retail output that leans hard on freight, software and electronics.",
      supply: { retail: 0.6 },
      demand: { freight: 0.2, software: 0.1, electronics: 0.05, real_estate_services: 0.03 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "Mixed online and physical retail operations.",
      supply: { retail: 0.5 },
      demand: {
        food: 0.15,
        electronics: 0.1,
        energy: 0.08,
        vehicles: 0.08,
        freight: 0.07,
        advertising: 0.12,
        software: 0.06,
        chemicals: 0.03,
        pharmaceuticals: 0.03,
        financial_services: 0.05,
        consulting_services: 0.03,
        building_materials: 0.04,
        steel: 0.03,
        oil: 0.03,
        healthcare_services: 0.04,
        real_estate_services: 0.05,
        plastics: 0.06,
      },
    },
    {
      id: "ecommerce",
      minDecade: "1999",
      name: "E-Commerce",
      description:
        "Online-first retail. Higher freight and software needs, co-produces software platforms.",
      supply: { retail: 0.35, software: 0.1 },
      demand: { software: 0.1, freight: 0.12, electronics: 0.1, advertising: 0.08, plastics: 0.09 },
    },
    {
      id: "brick_mortar",
      name: "Brick & Mortar",
      description:
        "Physical storefronts and shopping centers. Higher retail output but infrastructure costs.",
      supply: { retail: 0.55 },
      demand: {
        real_estate_services: 0.12,
        energy: 0.12,
        advertising: 0.1,
        food: 0.1,
        freight: 0.08,
        healthcare_services: 0.03,
        plastics: 0.04,
      },
    },
  ],

  // ── Logistics ─────────────────────────────────────────────────────────
  logistics: [
    {
      id: "autonomous_freight",
      requiresTechUnlock: true,
      minDecade: "2029",
      name: "Autonomous Freight",
      description:
        "Driverless trucking and drones: top freight output powered by vehicles, energy and software instead of labor.",
      supply: { freight: 0.7 },
      demand: { vehicles: 0.15, energy: 0.15, software: 0.12, electronics: 0.08 },
    },
    {
      id: "standard",
      name: "Standard",
      description: "Traditional freight and consulting logistics services.",
      supply: { freight: 0.45, consulting_services: 0.25 },
      demand: {
        vehicles: 0.2,
        energy: 0.2,
        software: 0.1,
        real_estate_services: 0.03,
        food: 0.06,
      },
    },
    {
      id: "automated",
      requiresTechUnlock: true,
      minDecade: "1989",
      name: "Automated Logistics",
      description: "Warehouse robotics and autonomous fleet management. Higher freight output.",
      supply: { freight: 0.5, consulting_services: 0.15 },
      demand: { software: 0.2, electronics: 0.15, energy: 0.15, food: 0.05 },
    },
    {
      id: "full_service",
      name: "Full-Service",
      description:
        "End-to-end supply chain management with high-touch consulting. Consulting-heavy output.",
      supply: { freight: 0.4, consulting_services: 0.35 },
      demand: {
        vehicles: 0.25,
        energy: 0.2,
        software: 0.15,
        real_estate_services: 0.03,
        food: 0.07,
      },
    },
  ],

  // ── Extraction & Mining ───────────────────────────────────────────────
  extraction: [
    {
      id: "standard",
      name: "Diversified",
      description:
        "Balanced extraction across all resource types. Lower per-resource output but broad supply.",
      // Reduced ~20% across all outputs: 200/233 sectors on standard was depressing the
      // focused-strategy incentive structure by flooding all resource markets simultaneously
      // and hitting the +30 surplus cap regardless of scarcity. Focused strategies now
      // supply 4–5× the per-resource rate. Removed ordnance demand (not a realistic
      // input for standard diversified mining; blasting explosives should be a chemicals cost).
      supply: {
        iron: 0.25,
        coal: 0.22,
        oil: 0.14,
        rare_earth: 0.14,
        natural_gas: 0.14,
        timber: 0.12,
      },
      demand: {
        energy: 0.2,
        vehicles: 0.15,
        freight: 0.1,
        chemicals: 0.08,
        construction_services: 0.03,
      },
    },
    {
      id: "iron_mining",
      name: "Iron & Metals Mining",
      description:
        "Focused iron ore extraction and processing. Sole output: iron ore at maximum volume.",
      // Buffed 0.65→0.78 to significantly address iron shortage (D/S ~3.38×).
      supply: { iron: 0.78 },
      demand: { energy: 0.25, vehicles: 0.15, freight: 0.12, steel: 0.05, ordnance: 0.08 },
    },
    {
      id: "oil_gas",
      name: "Oil & Gas",
      description:
        "Petroleum drilling and natural gas extraction. Dual output: crude oil and natural gas.",
      // Buffed oil 0.47→0.58, nat_gas 0.24→0.32 to address oil (D/S ~2.70×) and nat_gas (D/S ~3.68×).
      supply: { oil: 0.58, natural_gas: 0.32 },
      demand: { energy: 0.2, steel: 0.1, vehicles: 0.1, chemicals: 0.15, ordnance: 0.02 },
    },
    {
      id: "rare_earth_mining",
      name: "Rare Earth Minerals Mining",
      description:
        "Extraction of the merged Rare Earth Minerals commodity (copper + rare earths). Sole output at high volume. Energy and chemical-intensive processing.",
      // Unified mining strategy for the merged commodity. Adopts the shortage
      // -adjusted 0.72 output (from the former copper_mining) so the short merged
      // market is worth mining; copper_mining is deleted and its sectors remap here.
      supply: { rare_earth: 0.72 },
      demand: { energy: 0.25, chemicals: 0.2, vehicles: 0.1, freight: 0.1, ordnance: 0.07 },
    },
    {
      id: "coal_mining",
      name: "Coal Mining",
      description:
        "Large-scale coal extraction for energy and industrial use. Sole output: coal at maximum volume.",
      // Buffed 0.65→0.72.
      supply: { coal: 0.72 },
      demand: { energy: 0.2, vehicles: 0.15, freight: 0.15, ordnance: 0.09 },
    },
    {
      id: "timber_logging",
      name: "Timber & Forestry",
      description:
        "Commercial logging and forestry operations. Sole output: timber at high volume. Vehicle and freight-intensive.",
      // Buffed 0.54→0.64.
      supply: { timber: 0.64 },
      demand: { vehicles: 0.2, energy: 0.15, freight: 0.15, construction_services: 0.05 },
    },
  ],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Look up a strategy by sector type and strategy ID.
 * Falls back to "standard" if not found.
 */
export function getStrategy(sectorType: CorporationType, strategyId: string): SectorStrategy {
  const strategies = SECTOR_STRATEGIES[sectorType];
  return strategies.find((s) => s.id === strategyId) ?? strategies[0];
}

/**
 * Compute effective supply/demand rates for a sector, handling transitions.
 *
 * During a transition the rates are linearly interpolated between the old
 * and new strategy over STRATEGY_TRANSITION_TURNS turns.
 */
export function getEffectiveStrategyRates(
  sectorType: CorporationType,
  strategyId: string,
  transitionFromStrategyId: string | undefined | null,
  transitionStartTurn: number | undefined | null,
  currentTurn: number
): EffectiveStrategyRates {
  const target = getStrategy(sectorType, strategyId);

  // No transition in progress → return target directly
  if (!transitionFromStrategyId || transitionStartTurn == null) {
    return {
      supply: { ...target.supply },
      demand: { ...target.demand },
      isTransitioning: false,
    };
  }

  const elapsed = currentTurn - transitionStartTurn;
  const progress = Math.min(1, Math.max(0, elapsed / STRATEGY_TRANSITION_TURNS));

  // Transition complete → return target directly
  if (progress >= 1) {
    return {
      supply: { ...target.supply },
      demand: { ...target.demand },
      isTransitioning: false,
    };
  }

  const source = getStrategy(sectorType, transitionFromStrategyId);

  // Interpolate each commodity rate
  const supply = blendRates(source.supply, target.supply, progress);
  const demand = blendRates(source.demand, target.demand, progress);

  return { supply, demand, isTransitioning: true };
}

/** Linearly blend two rate maps. Commodities in either map are included. */
function blendRates(
  from: Partial<Record<CommodityType, number>>,
  to: Partial<Record<CommodityType, number>>,
  progress: number
): Partial<Record<CommodityType, number>> {
  const allKeys = new Set([
    ...(Object.keys(from) as CommodityType[]),
    ...(Object.keys(to) as CommodityType[]),
  ]);
  const result: Partial<Record<CommodityType, number>> = {};
  for (const key of allKeys) {
    const fromVal = from[key] ?? 0;
    const toVal = to[key] ?? 0;
    const blended = fromVal * (1 - progress) + toVal * progress;
    if (blended > 0) {
      result[key] = Math.round(blended * 10000) / 10000;
    }
  }
  return result;
}

// ─── Planned-economy output remap ───────────────────────────────────────────

/**
 * What media produces in a command economy instead of `advertising`.
 *
 * Advertising is a market institution: it exists because rival brands bid for
 * custom. A planned economy has no such contest, so its broadcasters, presses
 * and cinemas are producing state information and culture, which households
 * consume — not airtime sold to advertisers.
 *
 * The 1953 seed nonetheless gave every Warsaw Pact state a full commercial
 * media sector on the standard strategy, so the bloc was pushing 3,343,618
 * units/day of advertising — 54% of world supply — into economies whose
 * combined advertising demand was 4,736 units/day. Measured on prod at turn
 * 114: Hungary ran 1,181x oversupplied, Czechoslovakia and Bulgaria 786x,
 * Poland 779x. That glut set the world price and pinned it to the deflation
 * clamp at 0.32x base, so every media owner on Earth was selling ~2% of output
 * at a 68% discount.
 */
export const PLANNED_ECONOMY_MEDIA_OUTPUT: CommodityType = "entertainment_services";

/**
 * Re-denominate a sector's OUTPUT mix for a planned economy.
 *
 * Pure and total: returns the input untouched for market economies, for
 * non-media sectors, and for a mix that produces no advertising, so every
 * existing call site is byte-identical unless the sector is bloc media.
 *
 * MUST be applied at every site that resolves output rates — the world supply
 * ledger AND the clearing offer both — or the offered book and the ledger drift
 * apart and clearing's lagged-supply reconciliation misfires. That is why this
 * lives here rather than being inlined at either call site.
 */
export function applyPlannedEconomyOutputMix(
  sectorType: CorporationType,
  supply: Partial<Record<CommodityType, number>>,
  plannedEconomy: boolean
): Partial<Record<CommodityType, number>> {
  if (!plannedEconomy || sectorType !== "media") return supply;
  const advertising = supply.advertising ?? 0;
  if (!(advertising > 0)) return supply;
  const remapped: Partial<Record<CommodityType, number>> = { ...supply };
  delete remapped.advertising;
  // Preserve the CAPACITY UNIT YIELD k = Σ(rate / basePrice) — the quantity the
  // engine actually uses (`capacityUnitYield` → `revenuePerCapacityUnit` → build
  // cost and facility sizing). Holding k means the rate scales by
  // base_new / base_old, so 0.5 advertising becomes 2.0 state broadcasting.
  //
  // The obvious-looking alternative, conserving Σ(rate × basePrice), is not an
  // invariant of anything the engine computes: it moves k by the price ratio and
  // `facilityQuantum.test.ts` fails on the resulting RPU shift.
  //
  // This does NOT hold output VALUE constant. Under plants a single-commodity
  // mix has `commodityMixWeight` 1 whatever the rate, so the sector still makes
  // the same `producedUnits`, now priced at 600 rather than 150. Capacity is the
  // only lever for that, which is why the bloc media seed is right-sized in the
  // same pass. See ops-knowledge `plants-output-mix-invariants`.
  const rateScale =
    COMMODITY_BASE_PRICES[PLANNED_ECONOMY_MEDIA_OUTPUT] / COMMODITY_BASE_PRICES.advertising;
  remapped[PLANNED_ECONOMY_MEDIA_OUTPUT] =
    (remapped[PLANNED_ECONOMY_MEDIA_OUTPUT] ?? 0) + advertising * rateScale;
  return remapped;
}

/**
 * Share of a planned economy's media output that reaches the market.
 *
 * The 1953 seed sized every bloc state's media sector like a Western commercial
 * broadcaster — 82,000 to 806,000 capitalStock each, one per state — so the bloc
 * physically produces about 4x what a state media budget plausibly funds. Under
 * plants the output mix cannot express that: `commodityMixWeight` is 1 for a
 * single-commodity mix whatever the rate, so a re-pointed sector still makes the
 * same `producedUnits`. Capacity is the only real lever, and derating the market
 * contribution is the reversible, code-side form of it — no mutation of live
 * state-owned sectors.
 *
 * 0.25 is chosen to be REVENUE-NEUTRAL: state broadcasting prices at 4x
 * advertising, so a quarter of the units at four times the price is the same
 * ₳/day the sector would earn selling its whole advertising output. Bloc media
 * therefore neither gains free money from the re-pointing nor is broken by the
 * derate — and in practice it is a large gain, because today those sectors clear
 * 0.14% of output at a third of base price.
 *
 * Proper fix is to right-size the seed; see ops-knowledge
 * `plants-output-mix-invariants`.
 */
export const PLANNED_ECONOMY_MEDIA_SUPPLY_FACTOR = 0.25;

/** The derate for one sector: 1 for everything that is not planned-economy media. */
export function plannedEconomyMediaSupplyFactor(
  sectorType: CorporationType,
  plannedEconomy: boolean
): number {
  return plannedEconomy && sectorType === "media" ? PLANNED_ECONOMY_MEDIA_SUPPLY_FACTOR : 1;
}
