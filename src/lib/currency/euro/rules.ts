/**
 * Euro adoption records national consent and fixes legacy ledger units to the
 * common currency without changing principal. National financial accounts remain
 * separate from the shared monetary authority selected by euroPolicyBankId.
 */
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  COUNTRY_CURRENCY_MAP,
  getCountryIdForCurrency,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { EU_EUROZONE_MEMBERS } from "@/lib/constants/countries";

export interface EuroMember {
  countryId: CountryId;
  ledgerCurrency: CurrencyCode;
  /** Fixed legacy ledger units per one unit of the anchor's persisted FX quotation. */
  ledgerUnitsPerAnchorUnit: number;
  joinedTurn: number;
  source: "enacted-law" | "legacy-settlement";
}

export interface EuroMonetaryUnion {
  authorityId: "ECB";
  anchorCountryId: "DE";
  anchorCurrency: "EUR";
  /** The 1953 ledger stores marks; later presets store EUR or EUR-equivalent units. */
  anchorUnitsPerEuro: number;
  establishedTurn: number;
  revision: number;
  members: Partial<Record<CountryId, EuroMember>>;
}

export interface EuroAdoptionConditions {
  countryId: CountryId;
  year: number;
  europeanMembers: readonly string[];
  europeanStage?: "community" | "union";
  consentedCountries: readonly CountryId[];
  union?: EuroMonetaryUnion;
}

/** A passed law can remain contingent on membership at settlement time. */
export function euroAuthorizationRefusal(
  input: Pick<EuroAdoptionConditions, "countryId" | "year">
): string | null {
  if (!Number.isFinite(input.year) || input.year < 1999) {
    return "Euro adoption decisions open in 1999.";
  }
  const currency = COUNTRY_CURRENCY_MAP[input.countryId];
  if (getCountryIdForCurrency(currency) !== input.countryId) {
    return "A country sharing another issuer's currency must establish its own currency before applying.";
  }
  return null;
}

export function euroAdoptionRefusal(input: EuroAdoptionConditions): string | null {
  const unavailable = euroAuthorizationRefusal(input);
  if (unavailable) return unavailable;
  if (input.europeanStage === "community")
    return "Euro adoption requires a ratified European Union settlement.";
  if (!input.europeanMembers.includes(input.countryId)) {
    return "Euro adoption requires membership in the European organization.";
  }
  if (input.union?.members[input.countryId])
    return "This country already belongs to the euro area.";
  if (input.consentedCountries.includes(input.countryId))
    return "This country has already authorized adoption.";
  return null;
}

function positiveRate(rate: number | undefined): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

/**
 * Build an immutable, value-preserving settlement from actual legislative consent.
 * The game's existing DE/IE founding compact remains pending until both consent;
 * later eligible members, including the UK, do not need to refound the union.
 */
export function planEuroSettlement(input: {
  year: number;
  turn: number;
  preset: string;
  europeanMembers: readonly string[];
  europeanStage?: "community" | "union";
  consentedCountries: readonly CountryId[];
  rates: Partial<Record<CurrencyCode, number>>;
  existing?: EuroMonetaryUnion;
  /** Preserve an enabled old save as an already-authorized settlement. */
  legacyEnabled?: boolean;
}): { union: EuroMonetaryUnion | undefined; addedCountries: CountryId[]; pending: boolean } {
  const consent = [...new Set(input.consentedCountries)];
  const legacy = input.legacyEnabled === true && !input.existing;
  if (!legacy && input.europeanStage === "community") {
    return {
      union: input.existing,
      addedCountries: [],
      pending: consent.some((country) => !input.existing?.members[country]),
    };
  }
  const candidates = legacy ? [...new Set([...EU_EUROZONE_MEMBERS, ...consent])] : consent;
  const available = legacy || (Number.isFinite(input.year) && input.year >= 1999);
  const eligible = candidates.filter(
    (country) =>
      available &&
      (legacy || input.europeanMembers.includes(country)) &&
      getCountryIdForCurrency(COUNTRY_CURRENCY_MAP[country]) === country
  );
  if (
    !input.existing &&
    !legacy &&
    (input.year < 1999 ||
      !Number.isFinite(input.year) ||
      !EU_EUROZONE_MEMBERS.every((country) => eligible.includes(country)))
  ) {
    return { union: undefined, addedCountries: [], pending: true };
  }
  const anchorRate = input.rates.EUR;
  if (!positiveRate(anchorRate))
    return { union: input.existing, addedCountries: [], pending: true };
  const union: EuroMonetaryUnion = input.existing
    ? structuredClone(input.existing)
    : {
        authorityId: "ECB",
        anchorCountryId: "DE",
        anchorCurrency: "EUR",
        anchorUnitsPerEuro: input.preset === "1953-default" ? 1.95583 : 1,
        establishedTurn: input.turn,
        revision: 0,
        members: {},
      };
  const addedCountries: CountryId[] = [];
  let pending = false;
  for (const countryId of eligible) {
    if (union.members[countryId]) continue;
    const ledgerCurrency = COUNTRY_CURRENCY_MAP[countryId];
    const rate = input.rates[ledgerCurrency];
    if (!positiveRate(rate)) {
      pending = true;
      continue;
    }
    const ratio = rate / anchorRate;
    if (!positiveRate(ratio)) {
      pending = true;
      continue;
    }
    union.members[countryId] = {
      countryId,
      ledgerCurrency,
      ledgerUnitsPerAnchorUnit: ratio,
      joinedTurn: input.turn,
      source: legacy ? "legacy-settlement" : "enacted-law",
    };
    addedCountries.push(countryId);
  }
  // Never publish a partly materialized founding compact because a rate was missing.
  if (!input.existing && !EU_EUROZONE_MEMBERS.every((country) => union.members[country])) {
    return { union: undefined, addedCountries: [], pending: true };
  }
  if (addedCountries.length > 0) union.revision += 1;
  return { union, addedCountries, pending };
}

/** Resolve the authority without merging the members' national financial accounts. */
export function euroPolicyBankId(countryId: CountryId, union?: EuroMonetaryUnion): string {
  const issuer = getCountryIdForCurrency(COUNTRY_CURRENCY_MAP[countryId]);
  if (union?.members[issuer]) return union.authorityId;
  return COUNTRY_CONFIGS[countryId]?.centralBank.sharedBankId ?? countryId;
}

/** Apply links after the anchor's turn update, independent of country iteration order. */
export function linkedEuroRates(
  union: EuroMonetaryUnion,
  rates: Partial<Record<CurrencyCode, number>>
): Partial<Record<CurrencyCode, number>> {
  const anchor = rates[union.anchorCurrency];
  if (!positiveRate(anchor)) throw new Error("The euro anchor quotation is unavailable");
  const linked: Partial<Record<CurrencyCode, number>> = {};
  for (const member of Object.values(union.members)) {
    if (!member || !positiveRate(member.ledgerUnitsPerAnchorUnit)) {
      throw new Error("The euro conversion settlement is invalid");
    }
    const rate = anchor * member.ledgerUnitsPerAnchorUnit;
    if (!positiveRate(rate)) throw new Error("The linked euro quotation is invalid");
    linked[member.ledgerCurrency] = rate;
  }
  return linked;
}

export interface EuroWorldSnapshot {
  eurozoneEnabled?: boolean;
  euroAdoptedCountries?: readonly CountryId[];
  euroMonetaryUnion?: EuroMonetaryUnion;
}

export function euroConsentedCountries(state: EuroWorldSnapshot): CountryId[] {
  return [
    ...new Set([
      ...(state.euroAdoptedCountries ?? []),
      ...(state.euroMonetaryUnion
        ? (Object.keys(state.euroMonetaryUnion.members) as CountryId[])
        : state.eurozoneEnabled
          ? EU_EUROZONE_MEMBERS
          : []),
    ]),
  ];
}

/** Active display currencies never include a merely pending national authorization. */
export function euroMemberCurrencies(state: EuroWorldSnapshot): CurrencyCode[] {
  if (state.euroMonetaryUnion) {
    return [
      ...new Set(
        Object.values(state.euroMonetaryUnion.members).flatMap((member) =>
          member ? [member.ledgerCurrency] : []
        )
      ),
    ];
  }
  return state.eurozoneEnabled
    ? EU_EUROZONE_MEMBERS.map((country) => COUNTRY_CURRENCY_MAP[country])
    : [];
}

export interface EuroPolicyIndicators {
  inflationRate: number;
  gdpGrowth: number;
  targetInflation: number;
  neutralRate: number;
}

/** GDP weights arrive in shared accounting units, never at current FX quotes. */
export function aggregateEuroPolicyIndicators(
  members: readonly (EuroPolicyIndicators & { gdpAnchor: number })[]
): EuroPolicyIndicators | undefined {
  if (
    !members.length ||
    members.some(
      (member) =>
        !Number.isFinite(member.gdpAnchor) ||
        member.gdpAnchor <= 0 ||
        ![member.inflationRate, member.gdpGrowth, member.targetInflation, member.neutralRate].every(
          Number.isFinite
        )
    )
  )
    return undefined;
  // Normalize before summing, keeping very large but finite GDP inputs bounded.
  const scale = Math.max(...members.map((member) => member.gdpAnchor));
  const totalWeight = members.reduce((sum, member) => sum + member.gdpAnchor / scale, 0);
  const result: EuroPolicyIndicators = {
    inflationRate: 0,
    gdpGrowth: 0,
    targetInflation: 0,
    neutralRate: 0,
  };
  for (const member of members) {
    const weight = member.gdpAnchor / scale / totalWeight;
    for (const key of ["inflationRate", "gdpGrowth", "targetInflation", "neutralRate"] as const)
      result[key] += member[key] * weight;
  }
  return result;
}

/** Legacy ledger denominations within one settled euro area have a fixed cross rate. */
export function euroLedgerCrossRate(
  union: EuroMonetaryUnion | undefined,
  from: CurrencyCode,
  to: CurrencyCode
): number | undefined {
  if (!union) return undefined;
  const members = Object.values(union.members);
  const fromMember = members.find((member) => member?.ledgerCurrency === from);
  const toMember = members.find((member) => member?.ledgerCurrency === to);
  const fromRatio = fromMember?.ledgerUnitsPerAnchorUnit;
  const toRatio = toMember?.ledgerUnitsPerAnchorUnit;
  if (
    fromRatio == null ||
    toRatio == null ||
    !Number.isFinite(fromRatio) ||
    !Number.isFinite(toRatio) ||
    fromRatio <= 0 ||
    toRatio <= 0
  )
    return undefined;
  const rate = toRatio / fromRatio;
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

/** Historical pre-accession trades keep their original issuer. */
export function euroTradeCurrency(
  union: EuroMonetaryUnion | undefined,
  ledgerCurrency: CurrencyCode,
  tradeTurn: number
): CurrencyCode {
  const member =
    union && Object.values(union.members).find((value) => value?.ledgerCurrency === ledgerCurrency);
  return member && (member.source === "legacy-settlement" || tradeTurn >= member.joinedTurn)
    ? "EUR"
    : ledgerCurrency;
}

/** Source spend that covers a target amount under whole-unit settlement. */
export function euroLedgerSpendForTarget(targetAmount: number, crossRate: number): number {
  if (
    !Number.isFinite(targetAmount) ||
    targetAmount < 0 ||
    !Number.isFinite(crossRate) ||
    crossRate <= 0
  )
    return Number.NaN;
  const targetUnits = Math.ceil(targetAmount);
  const spend = targetUnits / crossRate;
  return Math.floor(spend * crossRate) >= targetUnits
    ? spend
    : spend + Math.max(Number.MIN_VALUE, Math.abs(spend) * Number.EPSILON);
}

/** Member ledger quotes follow the common anchor, even while quote caches lag. */
export function euroCurrencyRate(
  union: EuroMonetaryUnion | undefined,
  currency: CurrencyCode,
  rates: Partial<Record<CurrencyCode, number>>
): number | undefined {
  const member =
    union && Object.values(union.members).find((entry) => entry?.ledgerCurrency === currency);
  const rate =
    member && union
      ? (rates[union.anchorCurrency] ?? Number.NaN) * member.ledgerUnitsPerAnchorUnit
      : rates[currency];
  return positiveRate(rate) ? rate : undefined;
}
