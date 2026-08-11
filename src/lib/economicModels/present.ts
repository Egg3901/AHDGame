import {
  MODEL_ARCHETYPES,
  intensityBand,
  SWITCH_TURNS,
  type EconomicModelState,
  type EconomicModelId,
} from "@/lib/constants/economicModels";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { metricCategories } from "@/lib/constants/metricDefinitions";
import {
  effectStrength,
  concentrationMultiplier,
  spendingEfficiencyMultiplier,
  synergyNudges,
  CORP_MARGIN_PRIMARY,
  CORP_MARGIN_SECONDARY,
  CORP_MARGIN_OFF_MODEL,
} from "./effects";

/** metricId → display name, for synergy labels. */
const METRIC_LABELS = new Map<string, string>(
  metricCategories.flatMap((c) => c.metrics.map((m) => [m.id, m.name] as const))
);

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The active model's live bonuses/debuffs (P7b), scaled by current intensity. */
export interface EconomicModelEffects {
  /** Primary-sector corp operating-margin bonus (%). */
  corpMarginFavoredPct: number;
  /** Secondary-sector corp margin bonus (%). */
  corpMarginSecondaryPct: number;
  /** Off-model corp margin penalty (%). */
  corpMarginOffModelPct: number;
  /** Aligned primary-sector GDP-growth weight boost (%). */
  sectorGdpWeightPct: number;
  /** Secondary-sector GDP-growth weight boost (%). */
  secondaryGdpWeightPct: number;
  /** Signature-category spending-efficiency boost (%); 0 if the model has none. */
  spendingEfficiencyPct: number;
  /** Per-metric synergy nudges (signed points), with display labels. */
  synergies: Array<{ label: string; delta: number }>;
}

/** Presentation DTO for the "National Economic Model" card / band field. */
export interface EconomicModelView {
  current: EconomicModelId;
  currentName: string;
  /** Rounded 0–100. */
  intensity: number;
  /** Qualitative band: Mixed / Emerging / Established / Dominant. */
  band: string;
  /** The current model's signal split (Sector / Spending / Law), 0–1 each. */
  drivers?: { sector: number; spend: number; law: number };
  /** Player-facing labels of the model's signature sectors (primary first). */
  signatureSectors: string[];
  /** Live bonuses/debuffs; absent for "mixed" or zero intensity. */
  effects?: EconomicModelEffects;
  challenger?: {
    modelId: EconomicModelId;
    name: string;
    turnsLeading: number;
    switchTurns: number;
  };
}

/** Map a stored `economicModel` subdoc to the card's view model. */
export function presentEconomicModel(state: EconomicModelState): EconomicModelView {
  const archetype = MODEL_ARCHETYPES[state.current];
  const signatureSectors = archetype.primarySector
    ? [archetype.primarySector, ...archetype.secondarySectors].map(
        (s) => CORPORATION_TYPE_LABELS[s]
      )
    : [];

  // Live effect magnitudes (mirror P7b's helpers so the displayed numbers match
  // what's actually applied). Activation is binary: a held named model shows its
  // FULL bonuses regardless of intensity (intensity is the fit readout below).
  const s = effectStrength(state);
  let effects: EconomicModelEffects | undefined;
  // s > 0 already implies a named model with a primary sector; the extra check
  // narrows `primarySector` from `CorporationType | null` for the helpers below.
  if (s > 0 && archetype.primarySector) {
    const firstSigCategory = Object.keys(archetype.spendingSignature)[0];
    effects = {
      corpMarginFavoredPct: round1(CORP_MARGIN_PRIMARY * 100 * s),
      corpMarginSecondaryPct: round1(CORP_MARGIN_SECONDARY * 100 * s),
      corpMarginOffModelPct: round1(CORP_MARGIN_OFF_MODEL * 100 * s),
      sectorGdpWeightPct: round1(
        (concentrationMultiplier(state, archetype.primarySector) - 1) * 100
      ),
      secondaryGdpWeightPct: round1(
        (concentrationMultiplier(state, archetype.secondarySectors[0] ?? "") - 1) * 100
      ),
      spendingEfficiencyPct: firstSigCategory
        ? round1((spendingEfficiencyMultiplier(state, firstSigCategory) - 1) * 100)
        : 0,
      synergies: [...synergyNudges(state)].map(([metricId, delta]) => ({
        label: METRIC_LABELS.get(metricId) ?? metricId,
        delta: round1(delta),
      })),
    };
  }

  return {
    current: state.current,
    currentName: archetype.name,
    intensity: Math.round(state.intensity),
    band: intensityBand(state.current, state.intensity),
    drivers: state.drivers,
    signatureSectors,
    effects,
    challenger: state.challenger
      ? {
          modelId: state.challenger.modelId,
          name: MODEL_ARCHETYPES[state.challenger.modelId].name,
          turnsLeading: state.challenger.turnsLeading,
          switchTurns: SWITCH_TURNS,
        }
      : undefined,
  };
}
