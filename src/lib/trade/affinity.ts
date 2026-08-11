import type { CountryId } from "@/lib/constants/countries";
import type { AffinityInputs } from "./types";
import {
  TRADE_BASE_AFFINITY_DEFAULT,
  TRADE_BASE_AFFINITY_OVERRIDES,
  TRADE_FTA_AFFINITY_BONUS,
  TRADE_BLOC_AFFINITY_BONUS,
  TRADE_TARIFF_DRAG_SCALE,
} from "./constants";

/** Symmetric base geographic affinity for a country pair. */
export function getBaseAffinity(a: CountryId, b: CountryId): number {
  const key = [a, b].sort().join("-");
  return TRADE_BASE_AFFINITY_OVERRIDES[key] ?? TRADE_BASE_AFFINITY_DEFAULT;
}

/**
 * Compose the trade affinity for one exporter→importer pair from base
 * geography, FTA coverage, shared bloc membership, and importer tariff drag.
 * Returns 0 if the pair is blocked by an embargo.
 */
export function computeAffinity(inputs: AffinityInputs): number {
  if (inputs.blocked) return 0;

  let affinity = getBaseAffinity(inputs.exporter, inputs.importer);
  if (inputs.ftaCovered) affinity *= TRADE_FTA_AFFINITY_BONUS;
  if (inputs.sharedBloc) affinity *= TRADE_BLOC_AFFINITY_BONUS;

  const tariff =
    Number.isFinite(inputs.importerTariffRate) && inputs.importerTariffRate > 0
      ? inputs.importerTariffRate
      : 0;
  const drag = 1 / (1 + TRADE_TARIFF_DRAG_SCALE * tariff);

  return affinity * drag;
}
