/**
 * The one place that maps a country to its authored party seeds.
 *
 * This mapping used to live in `countryReadinessContract.ts` as
 * `AUTHORED_PARTY_SEED_MODULES`, covering 14 of the 24 registered countries.
 * That partial coverage is why `probeParties` short-circuited on
 * `COUNTRY_READINESS_EXPECTATIONS` — a country-keyed lookup that ignores the
 * preset entirely, and so reported a 2019 Russia as having the CPSU. A complete
 * registry removes the reason for the short-circuit.
 *
 * Static imports, matching how `seedDiagnostic/expectations.ts` already pulls
 * every era's region and census bundle: the readiness contract is consumed by an
 * admin route, not a player-facing page, and lazy thunks would make every
 * consumer async for no benefit.
 */
import type { CountryId } from "@/lib/constants/countries";
import { politicalParties, type PartySeed } from "@/lib/seeds/reference/politicalParties";
import { ukParties } from "@/lib/seeds/uk/ukParties";
import { deParties } from "@/lib/seeds/de/deParties";
import { jpParties } from "@/lib/countries/jp/data/jpParties";
import { cnParties } from "@/lib/seeds/cn/cnParties";
import { ruParties } from "@/lib/seeds/ru/ruParties";
import { ieParties } from "@/lib/seeds/ie/ieParties";
import { brParties } from "@/lib/seeds/br/brParties";
import { ngParties } from "@/lib/seeds/ng/ngParties";
import { frParties } from "@/lib/seeds/fr/frParties";
import { itParties } from "@/lib/seeds/it/itParties";
import { esParties } from "@/lib/seeds/es/esParties";
import { seParties } from "@/lib/seeds/se/seParties";
import { trParties } from "@/lib/seeds/tr/trParties";
import { grParties } from "@/lib/seeds/gr/grParties";
import { atParties } from "@/lib/seeds/at/atParties";
import { fiParties } from "@/lib/seeds/fi/fiParties";
import { ddParties } from "@/lib/seeds/dd/ddParties";
import { plParties } from "@/lib/seeds/pl/plParties";
import { csParties } from "@/lib/seeds/cs/csParties";
import { huParties } from "@/lib/seeds/hu/huParties";
import { roParties } from "@/lib/seeds/ro/roParties";
import { bgParties } from "@/lib/seeds/bg/bgParties";
import { yuParties } from "@/lib/seeds/yu/yuParties";
import { uaParties } from "@/lib/seeds/ua/uaParties";
import { blrParties } from "@/lib/seeds/blr/blrParties";
import { balParties } from "@/lib/seeds/bal/balParties";

export const PARTY_SEED_MODULES: Partial<Record<CountryId, readonly PartySeed[]>> = {
  // The US roster lives in the shared reference module rather than a us/ folder.
  US: politicalParties,
  UK: ukParties,
  DE: deParties,
  JP: jpParties,
  CN: cnParties,
  RU: ruParties,
  IE: ieParties,
  BR: brParties,
  NG: ngParties,
  FR: frParties,
  IT: itParties,
  ES: esParties,
  SE: seParties,
  TR: trParties,
  GR: grParties,
  AT: atParties,
  FI: fiParties,
  DD: ddParties,
  PL: plParties,
  CS: csParties,
  HU: huParties,
  RO: roParties,
  BG: bgParties,
  YU: yuParties,
  // Latent countries: seeded and drawn on the world map, never in COUNTRY_ORDER.
  UKR: uaParties,
  BLR: blrParties,
  BAL: balParties,
};

/**
 * The parties this country seeds in this preset.
 *
 * A seed with no `validForPresets` is valid in every era (`cnParties` is the
 * only module that relies on this). Returns `[]` for a country with no authored
 * module, which is the honest answer rather than a thrown error: callers
 * distinguish "no parties here" from "country unknown" themselves.
 */
export function partySeedsForPreset(countryId: CountryId, presetId: string): PartySeed[] {
  const seeds = PARTY_SEED_MODULES[countryId];
  if (!seeds) return [];
  return seeds.filter((seed) => !seed.validForPresets || seed.validForPresets.includes(presetId));
}

/** Comma-separated abbreviations, for readiness detail strings. */
export function partyRosterLabel(seeds: readonly PartySeed[]): string {
  return seeds.map((p) => p.abbreviation || p.name).join(", ");
}
