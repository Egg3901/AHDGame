import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";

/**
 * The presets that ship.
 *
 * A const tuple, NOT `ResetPresetId`. That union terminates with `| string`
 * (`src/lib/seeds/presetSelector.ts`), which TypeScript collapses to plain
 * `string`, so `Record<ResetPresetId, X>` is `Record<string, X>` and gives no
 * exhaustiveness on the preset axis at all — the roster would look type-safe
 * while enforcing nothing.
 */
export const SHIPPING_PRESETS = [
  "1953-default",
  "1979-default",
  "1991-default",
  "1999-default",
  "2007-default",
  "2019-default",
  "2023-default",
] as const;

export type ShippingPreset = (typeof SHIPPING_PRESETS)[number];

/**
 * What a country IS in a given era — specifically, whether it appears in this
 * world at all, and on what terms.
 *
 * - `player` / `econ` / `npp` — registered (in `COUNTRY_ORDER`) and seeded,
 *   differing only in what a player may do with it.
 * - `latent` — **seeded but deliberately not registered.** The bootstrap writes
 *   its regions, parties and budgets, and it renders on the world map, but it is
 *   absent from `COUNTRY_ORDER` so nothing offers it to players. UKR/BLR/BAL in
 *   the Cold-War presets are the case: authored countries "shipping at Poland's
 *   standing", per `scoWalInvisibility.test.ts`.
 * - `absent` — not present in this world at all. Nothing seeds it and nothing
 *   surfaces it.
 *
 * `absent` is about presence in the world, not about history. The historical
 * question — did this polity exist? — is what JUSTIFIES a tier, and belongs in
 * comments beside each entry. East Germany is `absent` after 1990 because the
 * GDR ceased to exist; Russia is `npp` in 1991 because it plainly existed, even
 * though its 1991 seed data is unauthored (that gap is a deferred capability
 * waiver, not a claim of non-existence).
 *
 * Keeping "not present" and "not authored" apart is the whole point of this
 * type: it is the same conflation `Partial<Record<CountryId, X>>` makes
 * everywhere else, where "does not apply" and "not done yet" are
 * indistinguishable and so neither can be checked.
 */
export type CountryEraTier = "player" | "econ" | "npp" | "latent" | "absent";

export interface EraRosterSpec {
  /** Tier for every country not named below. */
  default: CountryEraTier;
  player?: readonly CountryId[];
  econ?: readonly CountryId[];
  npp?: readonly CountryId[];
  /** Seeded, rendered on the map, deliberately NOT in `COUNTRY_ORDER`. */
  latent?: readonly CountryId[];
  /**
   * Chambers this preset deliberately leaves unseated, as `"UK.commons"`.
   *
   * Turns `getPresetSeats`'s prose ("the democracies start vacant") into data,
   * so a chamber seeded 0 can be told apart from a chamber whose roster nobody
   * wrote — the same ambiguity as `absent` versus unauthored, one level down.
   */
  vacantChambers?: readonly `${CountryId}.${string}`[];
}

export const ERA_ROSTER = {
  "1953-default": {
    default: "absent",
    player: ["US", "UK", "RU", "DD"],
    // The Warsaw Pact six are economy-preview here, NOT npp. Every spawner
    // behind them (ensureEasternBlocAssemblyElections, BLOC_CHAMBERS_1953) is
    // gated on countryGameStates.status in {beta, active}; demoting them to
    // coming-soon makes all of it silently no-op, which is the pre-#3747
    // production bug. ES is absent from this list on purpose: the 1953 manifest
    // demotes Franco's Spain to a US-sphere macro entity (outside the UN until
    // 1955), so it is npp here and econ only from 1979.
    econ: [
      "FR",
      "IT",
      "SE",
      "TR",
      "DE",
      "JP",
      "CN",
      "BR",
      "NG",
      "IE",
      "AT",
      "FI",
      "GR",
      "PL",
      "CS",
      "HU",
      "RO",
      "BG",
      "YU",
    ],
    npp: ["ES"],
    // Seeded by the Warsaw-Pact pack (bootstrapGameWorld, behind the
    // isEasternBlocEra gate) but held out of COUNTRY_ORDER on purpose.
    latent: ["UKR", "BLR", "BAL"],
    vacantChambers: [
      "UK.commons",
      "JP.shugiin",
      "JP.sangiin",
      "DE.bundestag",
      "FR.assembleeNationale",
      "IT.camera",
      "ES.congresoDiputados",
      "SE.riksdag",
      "TR.milletMeclisi",
      "BR.chamber",
      "IE.dail",
      "IE.seanad",
    ],
  },
  "1979-default": {
    default: "absent",
    player: ["US", "UK", "RU", "DD"],
    econ: ["FR", "IT", "ES", "SE", "TR", "DE", "JP", "CN", "BR", "NG", "IE", "AT", "FI", "GR"],
    npp: ["PL", "CS", "HU", "RO", "BG", "YU"],
    // Seeded by the Warsaw-Pact pack (bootstrapGameWorld, behind the
    // isEasternBlocEra gate) but held out of COUNTRY_ORDER on purpose.
    latent: ["UKR", "BLR", "BAL"],
    vacantChambers: [
      "US.house",
      "US.senate",
      "UK.commons",
      "JP.shugiin",
      "JP.sangiin",
      "DE.bundestag",
      "FR.assembleeNationale",
      "IT.camera",
      "ES.congresoDiputados",
      "SE.riksdag",
      "TR.milletMeclisi",
      "BR.chamber",
      "IE.dail",
      "IE.seanad",
    ],
  },
  "1991-default": {
    default: "absent",
    player: ["US", "UK", "JP"],
    econ: ["DE", "FR", "IT", "ES", "SE", "TR", "CN", "NG", "BR", "IE", "AT", "FI", "GR"],
    npp: ["RU", "PL", "CS", "HU", "RO", "BG", "YU"],
  },
  // CS dissolved 31 Dec 1992, and BAL is coherent only as a Soviet
  // union-republic grouping — both go absent here. YU, as Serbia and
  // Montenegro, survives to 2006.
  "1999-default": {
    default: "absent",
    player: ["US", "UK", "JP"],
    econ: ["DE", "IE", "CN", "BR", "NG", "FR", "IT", "ES", "SE", "TR", "AT", "FI", "GR"],
    npp: ["RU", "PL", "HU", "RO", "BG", "YU"],
  },
  "2007-default": {
    default: "absent",
    player: ["US", "UK", "JP"],
    econ: ["DE", "IE", "CN", "BR", "NG", "FR", "IT", "ES", "SE", "TR", "AT", "FI", "GR"],
    npp: ["RU", "PL", "HU", "RO", "BG"],
  },
  "2019-default": {
    default: "absent",
    player: ["US", "UK", "JP"],
    econ: ["DE", "IE", "CN", "BR", "NG"],
    npp: ["RU", "FR", "IT", "ES", "SE", "TR", "AT", "FI", "GR", "PL", "HU", "RO", "BG"],
  },
  "2023-default": {
    default: "absent",
    player: ["US", "UK", "JP"],
    econ: ["DE", "IE", "CN", "BR", "NG"],
    npp: ["RU", "FR", "IT", "ES", "SE", "TR", "AT", "FI", "GR", "PL", "HU", "RO", "BG"],
  },
} satisfies Record<ShippingPreset, EraRosterSpec>;

export function isShippingPreset(value: string): value is ShippingPreset {
  return (SHIPPING_PRESETS as readonly string[]).includes(value);
}

/**
 * What this country is in this era. A total function: it never throws and never
 * falls back to another era's answer.
 */
export function tierFor(preset: ShippingPreset, countryId: CountryId): CountryEraTier {
  const spec = ERA_ROSTER[preset];
  if (spec.player?.includes(countryId)) return "player";
  if (spec.econ?.includes(countryId)) return "econ";
  if (spec.npp?.includes(countryId)) return "npp";
  if (spec.latent?.includes(countryId)) return "latent";
  return spec.default;
}

/**
 * Countries at a given tier.
 *
 * Iterates every configured country, not just `COUNTRY_ORDER` — `latent` and
 * `absent` are defined by NOT being registered, so filtering the registered set
 * for them would always return nothing. Registered countries keep their
 * `COUNTRY_ORDER` position; the rest follow in config order.
 */
export function countriesByTier(preset: ShippingPreset, tier: CountryEraTier): CountryId[] {
  const ordered = COUNTRY_ORDER.filter((id) => tierFor(preset, id) === tier);
  const unregistered = (Object.keys(COUNTRY_CONFIGS) as CountryId[]).filter(
    (id) => !COUNTRY_ORDER.includes(id) && tierFor(preset, id) === tier
  );
  return [...ordered, ...unregistered];
}

/** True when the roster says this country is registered in this preset. */
export function isRegisteredTier(tier: CountryEraTier): boolean {
  return tier === "player" || tier === "econ" || tier === "npp";
}

/** True when this preset deliberately leaves the chamber unseated. */
export function isVacantChamber(
  preset: ShippingPreset,
  countryId: CountryId,
  chamberKey: string
): boolean {
  return ERA_ROSTER[preset].vacantChambers?.includes(`${countryId}.${chamberKey}`) ?? false;
}
