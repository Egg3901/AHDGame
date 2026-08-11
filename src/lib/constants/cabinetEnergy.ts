import type { CountryId } from "./countries";
import type { EnergyPlant, EnergySource } from "@/lib/db/types/energyPlant";

export interface EnergySourceDef {
  id: EnergySource;
  label: string;
  description: string; // player-facing one-liner: what this asset does mechanically
  icon: string;
  renewable: boolean;
  carbonPerMW: number; // emissions-intensity index per MW (0 for clean)
  firmness: number; // 0-1 dispatchable/firm
  upkeepPerMW: number; // millions/turn per MW
  baseCapacity: number; // default MW when built
}

export const ENERGY_SOURCES: EnergySourceDef[] = [
  {
    id: "coal",
    label: "Coal",
    description:
      "Firm, on-demand power at high capacity, with the highest emissions of any source.",
    icon: "coal",
    renewable: false,
    carbonPerMW: 1.0,
    firmness: 1.0,
    upkeepPerMW: 0.08,
    baseCapacity: 800,
  },
  {
    id: "gas",
    label: "Natural Gas",
    description: "Firm, on-demand power with moderate emissions and low upkeep.",
    icon: "flame",
    renewable: false,
    carbonPerMW: 0.5,
    firmness: 1.0,
    upkeepPerMW: 0.05,
    baseCapacity: 600,
  },
  {
    id: "nuclear",
    label: "Nuclear",
    description:
      "Zero-emission firm power at the largest capacity, with the highest upkeep per MW.",
    icon: "atom",
    renewable: false,
    carbonPerMW: 0.0,
    firmness: 1.0,
    upkeepPerMW: 0.12,
    baseCapacity: 1200,
  },
  {
    id: "hydro",
    label: "Hydro",
    description: "Renewable, near-firm power with zero emissions and the cheapest upkeep.",
    icon: "droplet",
    renewable: true,
    carbonPerMW: 0.0,
    firmness: 0.9,
    upkeepPerMW: 0.03,
    baseCapacity: 500,
  },
  {
    id: "wind",
    label: "Wind",
    description:
      "Zero-emission renewable power that comes and goes with the weather, so the grid still needs firm backup.",
    icon: "wind",
    renewable: true,
    carbonPerMW: 0.0,
    firmness: 0.3,
    upkeepPerMW: 0.04,
    baseCapacity: 300,
  },
  {
    id: "solar",
    label: "Solar",
    description:
      "Cheap zero-emission renewable power that comes and goes with the weather and builds in small blocks.",
    icon: "sun",
    renewable: true,
    carbonPerMW: 0.0,
    firmness: 0.25,
    upkeepPerMW: 0.03,
    baseCapacity: 250,
  },
];

/**
 * Energy-owning seat per country. Never a transportation seat (reserved for the
 * future Infrastructure widget). UK has no dedicated energy ministry and its grid
 * metric sits on the reserved transport seat → environment_secretary (net-zero home).
 */
export const ENERGY_POSITION_BY_COUNTRY: Partial<Record<CountryId, string>> = {
  US: "secretary_of_energy",
  UK: "environment_secretary",
  DE: "economy_minister",
  CN: "minister_of_ecology_environment",
  JP: "environment_minister",
  IE: "minister_for_environment_climate",
  // Power generation sat under heavy industry in the command-economy
  // abstraction. This seat is also an estates seat, so FlagshipRouter renders it
  // with the existing `Estates | Generation` toggle (the UK environment_secretary
  // path). Era-appropriate sources are enforced by seedEnergyPlants.
  RU: "minister_of_machine_building",
  DD: "minister_of_machine_building",
};

export const TIER_MULTIPLIER = [1.0, 1.5, 2.0, 2.5] as const;
export const TIER_LABELS = ["Standard", "Expanded", "Major", "Mega"] as const;

export const ENERGY_EFFECT = {
  // Nudge weights on native metric scales (renewable/reliability 0-100, carbon 0-60).
  // The pipeline clamps each delta to ±0.08, so a far-from-target nudge saturates the
  // cap and eases as the metric approaches its mix-implied target.
  renewableWeight: 0.01,
  carbonWeight: 0.01,
  reliabilityWeight: 0.01,
  // Carbon target: carbonIntensity (0..1) mapped onto the 0-60 metric scale.
  carbonTargetMax: 45,
  budgetWeight: 0.05,
};

export const ENERGY_UPKEEP_UNIT = 1_000_000;
export const ENERGY_ENVELOPE_FALLBACK_GDP_FRACTION = 0.015;

/** Discretionary slice applied to energy's gdp-fraction envelope (energy has no budget category). Tunable. */
export const ENERGY_DISCRETIONARY_FRACTION = 0.01;

/** Baseline discretionary allowance (millions of local currency); envelope = max(slice, baseline). Tunable. */
export const ENERGY_DISCRETIONARY_BASELINE = 3_500;

/** Absolute cap (millions) on the energy discretionary budget; envelope = clamp(slice, baseline, cap). */
export const ENERGY_DISCRETIONARY_CAP = 5_000;

export function getEnergySource(id: string): EnergySourceDef | undefined {
  return ENERGY_SOURCES.find((s) => s.id === id);
}
export function resolveEnergyPosition(countryId: string, positionId: string): string | null {
  return ENERGY_POSITION_BY_COUNTRY[countryId as CountryId] === positionId ? positionId : null;
}
export function effectiveCapacity(plant: Pick<EnergyPlant, "capacityBase" | "tier">): number {
  return Math.round(plant.capacityBase * TIER_MULTIPLIER[plant.tier]);
}
export function effectiveUpkeep(
  plant: Pick<EnergyPlant, "source" | "capacityBase" | "tier">
): number {
  const src = getEnergySource(plant.source);
  if (!src) return 0;
  return +(effectiveCapacity(plant) * src.upkeepPerMW).toFixed(4);
}

export interface MixAggregate {
  totalCapacity: number; // MW
  totalUpkeep: number; // millions/turn
  bySource: Record<EnergySource, number>; // MW per source
  renewableShare: number; // 0-1
  firmShare: number; // 0-1 (capacity-weighted firmness)
  carbonIntensity: number; // Σ(capacity × carbonPerMW) / totalCapacity, 0 if empty
}
export function aggregateMix(plants: EnergyPlant[]): MixAggregate {
  const bySource = { coal: 0, gas: 0, nuclear: 0, hydro: 0, wind: 0, solar: 0 } as Record<
    EnergySource,
    number
  >;
  let totalCapacity = 0;
  let totalUpkeep = 0;
  let renewableCap = 0;
  let firmCap = 0;
  let carbonSum = 0;
  for (const p of plants) {
    const src = getEnergySource(p.source);
    if (!src) continue;
    const cap = effectiveCapacity(p);
    bySource[p.source] += cap;
    totalCapacity += cap;
    totalUpkeep += effectiveUpkeep(p);
    if (src.renewable) renewableCap += cap;
    firmCap += cap * src.firmness;
    carbonSum += cap * src.carbonPerMW;
  }
  return {
    totalCapacity,
    totalUpkeep: +totalUpkeep.toFixed(4),
    bySource,
    renewableShare: totalCapacity > 0 ? renewableCap / totalCapacity : 0,
    firmShare: totalCapacity > 0 ? firmCap / totalCapacity : 0,
    carbonIntensity: totalCapacity > 0 ? carbonSum / totalCapacity : 0,
  };
}
