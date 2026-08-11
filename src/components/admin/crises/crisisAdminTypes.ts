import type { CrisisEffect } from "@/lib/db/types/crisis";

export interface AutoTemplate {
  key: string;
  name: string;
  kind: "disaster" | "condition" | "random";
  scope: "region" | "country" | "global";
  cooldownTurns: number;
  countries?: string[];
  excludeCountries?: string[];
  requiresRegionTags?: string[];
  spawnChance?: number;
  conditionSummary?: string;
}

export interface AutoCooldownRow {
  templateKey: string;
  scopeKey: string;
  lastSpawnTurn: number;
  remaining: number;
}

// FormEffect holds value as a string so the input can represent partial states
// like "-" or "0." without snapping back to 0. Converted to number at submit.
export type FormEffect = Omit<CrisisEffect, "value"> & { value: string };

export function makeEmptyEffect(): FormEffect {
  return {
    effectType: "tick",
    targetType: "metric",
    metricCategory: "economic",
    metricField: "unemploymentRate",
    sectorType: null,
    strategyId: null,
    value: "",
    label: "",
  };
}

export interface FormState {
  name: string;
  description: string;
  scope: "global" | "country" | "region";
  countryIds: string[];
  regionIds: string[];
  durationFixed: boolean;
  durationTurns: string;
  wireMessageOnStart: string;
  wireMessageOnEnd: string;
  effects: FormEffect[];
}

export function makeEmptyForm(): FormState {
  return {
    name: "",
    description: "",
    scope: "global",
    countryIds: [],
    regionIds: [],
    durationFixed: false,
    durationTurns: "10",
    wireMessageOnStart: "",
    wireMessageOnEnd: "",
    effects: [makeEmptyEffect()],
  };
}
