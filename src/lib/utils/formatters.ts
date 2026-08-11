import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import {
  COUNTRIES_WITH_CONCURRENT_GENERAL_ELECTIONS,
  type CountryId,
} from "@/lib/constants/countries";
import { parseCountryParam } from "@/lib/db/partyLookup";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import {
  CANONICAL_REAL_ELECTION_YEARS_BY_PRESET,
  DEFAULT_CYCLE_ANCHOR_CONTEXT,
  type CycleAnchorContext,
} from "@/lib/elections/cycleAnchorContext";

// ── Display currency preference ───────────────────────────────────────────────

/**
 * Display preference: "local" (each asset's native), "home" (player's home),
 * "internal" (raw base unit ₳), or a specific CurrencyCode to pin every
 * amount to that currency.
 */
export type DisplayCurrencyPreference = "local" | "home" | "internal" | CurrencyCode;

/**
 * Convert an amount from internal units to a target currency.
 * Rates map: CurrencyCode → (local currency per 1 internal unit).
 * Returns the original amount if the rate is missing (graceful fallback).
 */
export function convertFromInternal(
  amount: number,
  toCurrencyCode: CurrencyCode,
  rates: Partial<Record<CurrencyCode, number>>
): number {
  const rate = rates[toCurrencyCode];
  if (!rate) return amount;
  return amount * rate;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Maps common currency symbols → ISO 4217 codes for Intl.NumberFormat. */
const SYMBOL_TO_CURRENCY: Record<string, string> = {
  $: "USD",
  "£": "GBP",
  "¥": "JPY",
  C$: "CAD",
  "€": "EUR",
};

/**
 * Format a number as currency.
 * @param amount - The amount to format
 * @param currency - ISO 4217 currency code (defaults to "USD")
 * @returns Formatted currency string (e.g., "$1,000" or "£1,000")
 */
export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format a party treasury / hourly amount in the country's home currency (e.g. GBP for UK).
 * Accepts URL-style codes (`uk`), API `countryId` (`UK`), or other casing.
 */
export function formatPartyCountryMoney(amount: number, countryId: string): string {
  const trimmed = countryId?.trim() ?? "";
  // Resolve against COUNTRY_CURRENCY_MAP directly so runtime-activated countries
  // (seceded SCO/WAL) resolve too — a static CountryId allowlist would wrongly
  // fall back to USD for them.
  const upper = trimmed.toUpperCase() as CountryId;
  const parsed: CountryId | null =
    upper in COUNTRY_CURRENCY_MAP ? upper : parseCountryParam(trimmed.toLowerCase() || null);
  const currency: CurrencyCode = parsed ? COUNTRY_CURRENCY_MAP[parsed] : "USD";
  return formatCurrency(amount, currency);
}

/**
 * Format a price with cents only when needed.
 * Whole-dollar values stay compact, while fractional prices keep two decimals.
 */
export function formatCurrencyPrecise(amount: number, currency = "USD"): string {
  const rounded = Math.round(amount * 100) / 100;
  const hasCents = Math.abs(rounded - Math.round(rounded)) >= 0.005;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rounded);
}

/**
 * Format a per-share stock price for summary UI (financials, shares header, charts).
 * Uses cent precision from $0.01 up; sub-penny prices show four decimals.
 * @param symbol - Currency symbol to prefix (defaults to "$")
 */
export function formatSharePrice(price: number, symbol = "$"): string {
  if (!Number.isFinite(price)) return `${symbol}—`;
  if (Math.abs(price) < 0.01) {
    // Fixed 4dp printed a real, non-zero price as "$0.0000" once it fell below
    // half a hundredth, which reads as "worthless" rather than "very small".
    // Widen to whatever it takes to show two significant figures (capped at 8dp
    // so the column cannot run away), then trim the trailing zeros.
    if (price === 0) return `${symbol}0.0000`;
    const magnitude = Math.floor(Math.log10(Math.abs(price)));
    const decimals = Math.min(8, Math.max(4, 1 - magnitude));
    return `${symbol}${price.toFixed(decimals).replace(/(\.\d*?[1-9])0+$/, "$1")}`;
  }
  // Derive ISO code from symbol for Intl formatting, fall back to manual formatting
  const currencyCode = SYMBOL_TO_CURRENCY[symbol];
  if (currencyCode) return formatCurrencyPrecise(price, currencyCode);
  // For symbols without an Intl code mapping, format manually
  const rounded = Math.round(price * 100) / 100;
  const hasCents = Math.abs(rounded - Math.round(rounded)) >= 0.005;
  const formatted = hasCents ? rounded.toFixed(2) : String(Math.round(rounded));
  return `${symbol}${Number(formatted).toLocaleString("en-US")}`;
}

/**
 * Format a per-share price on order books and limit orders (fixed four decimal places).
 * @param symbol - Currency symbol to prefix (defaults to "$")
 */
export function formatSharePriceOrder(price: number, symbol = "$"): string {
  if (!Number.isFinite(price)) return `${symbol}—`;
  return `${symbol}${price.toFixed(4)}`;
}

/**
 * Format a number as full currency (no abbreviation).
 * @param amount - The amount to format
 * @param symbol - Currency symbol to prefix (defaults to "$")
 * @returns Formatted currency string (e.g., "$1,234,567" or "£1,234,567")
 */
export function formatCurrencyFull(amount: number, symbol = "$"): string {
  // en-US pinned for SSR/client determinism — see formatCurrencyFaceAmount.
  return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
}

/**
 * Format population numbers with M/K suffixes
 * @param pop - Population number
 * @returns Formatted string (e.g., "1.5M" or "500K")
 */
export function formatPopulation(pop: number): string {
  if (pop >= 1000000) {
    return `${(pop / 1000000).toFixed(1)}M`;
  }
  return `${(pop / 1000).toFixed(0)}K`;
}

/**
 * Format GDP with T/B suffixes
 * @param gdp - GDP number
 * @param currencySymbol - Currency symbol to prefix (defaults to "$")
 * @returns Formatted string (e.g., "$1.50T", "¥1.50T", or "£500B")
 */
export function formatGDP(gdp: number, currencySymbol = "$"): string {
  if (gdp >= 1000000) {
    return `${currencySymbol}${(gdp / 1000000).toFixed(2)}T`;
  }
  return `${currencySymbol}${(gdp / 1000).toFixed(0)}B`;
}

/**
 * Round marketing strength (MS) to two decimal places for API payloads and display.
 * Avoids integer rounding that made e.g. 6.8 appear as 7 while validation still failed.
 */
export function roundMarketingStrength(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * Format MS for UI: locale grouping, up to two fractional digits (trims ".00").
 */
export function formatMarketingStrength(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = roundMarketingStrength(value);
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Abbreviate large numbers without a currency symbol (votes, shares, etc.).
 * Examples: 999 → "999", 263000 → "263K", 1_200_000 → "1.2M", 5_000_000 → "5M",
 *           2_500_000_000 → "2.5B", 1_500_000_000_000 → "1.5T"
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  /** Format a divided value to at most 1 decimal place, dropping ".0". */
  const compact1dp = (divided: number): string => {
    if (divided >= 100 || Number.isInteger(divided)) return `${Math.round(divided)}`;
    const rounded = Math.round(divided * 10) / 10;
    return `${rounded}`.replace(/\.0$/, "");
  };

  if (abs < 1_000) return `${sign}${Math.round(abs)}`;
  if (abs < 1_000_000) return `${sign}${compact1dp(abs / 1_000)}K`;
  if (abs < 1_000_000_000) return `${sign}${compact1dp(abs / 1_000_000)}M`;
  if (abs < 1_000_000_000_000) return `${sign}${compact1dp(abs / 1_000_000_000)}B`;
  return `${sign}${compact1dp(abs / 1_000_000_000_000)}T`;
}

/**
 * Format a 0..100 index metric with an explicit scale anchor so a naked value
 * like "42" reads as "42 / 100". Used for command-economy readouts (monetary
 * overhang, shortage index) where the number is an index, not a count.
 * Rounds to a whole number; non-finite input renders the anchor with an em
 * placeholder value ("— / 100").
 */
export function formatIndex100(value: number): string {
  if (!Number.isFinite(value)) return "— / 100";
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return `${clamped} / 100`;
}

/**
 * Format funds with K/M/B suffixes for compact display.
 * @param amount - The amount to format
 * @param symbol - Currency symbol to prefix (defaults to "$")
 * @returns Formatted string (e.g., "$1.2M", "£263K", "¥500")
 */
export function formatFundsCompact(amount: number, symbol = "$"): string {
  if (!Number.isFinite(amount)) return `${symbol}—`;
  const plain = formatCompactNumber(amount);
  if (plain.startsWith("-")) return `-${symbol}${plain.slice(1)}`;
  return `${symbol}${plain}`;
}

/**
 * Format a value already denominated in a local currency. Use for post-
 * cf-inconsistency-fix Phase 6 fields (party / state-party / caucus treasury
 * and the soft reserves that gate them) where the stored number is already
 * in the holder's home currency and must NOT be re-multiplied by an FX rate.
 *
 * Unlike `useCurrency().formatAmount`, this function performs no FX
 * conversion — it just decorates the value with the matching currency
 * symbol.
 */
export function formatLocalAmount(amount: number, currencyCode: CurrencyCode): string {
  const symbol = CURRENCY_SYMBOLS[currencyCode] ?? "$";
  return formatFundsCompact(amount, symbol);
}

/** Long-form variant of {@link formatLocalAmount} (no K/M/B suffix). */
export function formatLocalAmountFull(amount: number, currencyCode: CurrencyCode): string {
  const symbol = CURRENCY_SYMBOLS[currencyCode] ?? "$";
  return formatCurrencyFull(amount, symbol);
}

/**
 * Compact currency for status bar chips and profile fund strips.
 * Each tier shows two fractional digits (e.g. "$2.15M", "$1.23B") so large balances
 * do not collapse to a coarse whole-unit abbreviation like formatFundsCompact can.
 */
export function formatCurrencyCompactChip(amount: number, symbol = "$"): string {
  if (!Number.isFinite(amount)) return `${symbol}—`;
  const neg = amount < 0;
  const abs = Math.abs(amount);
  let core: string;
  if (abs >= 1_000_000_000_000) {
    core = `${symbol}${(abs / 1_000_000_000_000).toFixed(2)}T`;
  } else if (abs >= 1_000_000_000) {
    core = `${symbol}${(abs / 1_000_000_000).toFixed(2)}B`;
  } else if (abs >= 1_000_000) {
    core = `${symbol}${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 1_000) {
    core = `${symbol}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  } else {
    core = `${symbol}${abs.toLocaleString("en-US")}`;
  }
  return neg ? `-${core}` : core;
}

/**
 * Compact currency with a FIXED single decimal place at every tier (e.g.
 * "¥49.6T", "¥620.0B", "¥31.0T"). Unlike {@link formatFundsCompact}, the
 * decimal is always shown — even ".0" — so a row of headline figures lines up
 * and reads consistently. Used for the budget headline stats (Annual Revenue,
 * Spending, Surplus, GDP, Treasury Balance).
 * @param symbol - Currency symbol to prefix (defaults to "$")
 */
export function formatFundsCompact1dp(amount: number, symbol = "$"): string {
  if (!Number.isFinite(amount)) return `${symbol}—`;
  const neg = amount < 0;
  const abs = Math.abs(amount);
  let core: string;
  if (abs >= 1_000_000_000_000) {
    core = `${(abs / 1_000_000_000_000).toFixed(1)}T`;
  } else if (abs >= 1_000_000_000) {
    core = `${(abs / 1_000_000_000).toFixed(1)}B`;
  } else if (abs >= 1_000_000) {
    core = `${(abs / 1_000_000).toFixed(1)}M`;
  } else if (abs >= 1_000) {
    core = `${(abs / 1_000).toFixed(1)}K`;
  } else {
    core = abs.toFixed(1);
  }
  return `${neg ? "-" : ""}${symbol}${core}`;
}

/**
 * Format a commodity quantity with K/M suffixes and a unit label.
 * @param value - The quantity to format
 * @param unit - The unit label (e.g., "barrels", "tonnes")
 * @returns Formatted string (e.g., "1.2M barrels", "500K tonnes", "42 barrels")
 */
export function formatUnits(value: number, unit: string): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ${unit}`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K ${unit}`;
  if (value >= 10) return `${Math.round(value)} ${unit}`;
  return `${value.toFixed(1)} ${unit}`;
}

export type TimeUrgency = "normal" | "warning" | "critical" | "ended" | "paused";

export interface TimeRemaining {
  text: string;
  urgency: TimeUrgency;
}

/**
 * Format time remaining until a deadline against the game clock.
 *
 * **Prefer `useGameClock().formatRemaining(deadline)` (client) or
 * `(await getGameClock()).formatRemaining(deadline)` (server) instead of
 * calling this directly** — those facades thread the game clock in for you
 * and ensure the UI is consistent with the game's resolution logic.
 *
 * @param endTimeStr - ISO date string or Date for the deadline
 * @param pausedAt - If set (game paused), used as the reference instead of gameTimeRef
 * @param gameTimeRef - Required. The current game-clock "now" (lastTurnProcessed).
 *   Using a real-Date() fallback here is forbidden because it desyncs the UI
 *   countdown from the game's deadline resolution.
 * @returns Object with formatted text and urgency level
 */
export function formatTimeRemaining(
  endTimeStr: string | Date | undefined,
  pausedAt: string | Date | null | undefined,
  gameTimeRef: Date
): TimeRemaining {
  if (!endTimeStr) return { text: "No timer", urgency: "normal" };
  const end = new Date(endTimeStr);

  const referenceTime = pausedAt ? new Date(pausedAt) : gameTimeRef;
  const diff = end.getTime() - referenceTime.getTime();

  if (diff <= 0) return { text: "Ended", urgency: "ended" };

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  let text = "";
  if (days > 0) {
    text = `${days}d ${remainingHours}h`;
  } else if (hours > 0) {
    text = `${hours}h ${minutes}m`;
  } else {
    text = `${minutes}m`;
  }

  // If paused, indicate that in the text and urgency
  if (pausedAt) {
    text = `${text} (Paused)`;
    return { text, urgency: "paused" };
  }

  let urgency: TimeUrgency = "normal";
  if (hours < 6) urgency = "critical";
  else if (hours < 24) urgency = "warning";

  return { text, urgency };
}

/**
 * Format time until a deadline in compact hours format against the game clock.
 *
 * **Prefer `useGameClock().formatCompact(deadline)` (client) or
 * `(await getGameClock()).formatCompact(deadline)` (server) instead of
 * calling this directly** — those facades thread the game clock in for you.
 *
 * For wall-clock countdowns (e.g. StatusBar's next-cron timer), use
 * `formatRealTimeCountdown` instead.
 *
 * @param endTime - ISO date string or Date for the deadline
 * @param pausedAt - If set (game paused), used as the reference instead of gameTimeRef
 * @param gameTimeRef - Required. The current game-clock "now" (lastTurnProcessed).
 *   Using a real-Date() fallback here is forbidden — see formatTimeRemaining.
 * @returns Compact string like "45m", "2h 30m", "2d 0h", or "Ended"
 */
export function formatTimeUntilCompact(
  endTime: string | Date | undefined,
  pausedAt: string | Date | null | undefined,
  gameTimeRef: Date
): string {
  if (!endTime) return "—";
  const end = new Date(endTime);
  const referenceTime = pausedAt ? new Date(pausedAt) : gameTimeRef;
  const diff = end.getTime() - referenceTime.getTime();
  if (diff <= 0) return "Ended";
  if (pausedAt) return "Paused";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 0) return `${days}d ${remainingHours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Format time remaining against REAL wall-clock. Use ONLY for displays that
 * count down to a wall-clock event (e.g. the StatusBar's next-cron countdown).
 *
 * For game-clock deadlines (election timers, vote windows, cooldowns, bond
 * maturity, etc.), use `useGameClock().formatCompact()` instead — see
 * docs/plans/archive/2026-05/2026-05-20-clock-mismatch-design.md.
 *
 * @returns "—" when no endTime, "Ended" when past, "Paused" when paused,
 *   otherwise a compact string like "45m", "2h 30m", "2d 0h".
 */
export function formatRealTimeCountdown(
  endTime?: string | Date,
  pausedAt?: string | Date | null
): string {
  if (!endTime) return "—";
  const end = new Date(endTime);
  const referenceTime = pausedAt ? new Date(pausedAt) : new Date();
  const diff = end.getTime() - referenceTime.getTime();
  if (diff <= 0) return "Ended";
  if (pausedAt) return "Paused";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 0) return `${days}d ${remainingHours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Format time remaining as simple string (for admin displays)
 * @param endTimeStr - ISO date string for the deadline
 * @returns Simple formatted string
 */
export function formatTimeRemainingSimple(endTimeStr?: string | Date): string {
  if (!endTimeStr) return "No timer";
  const end = new Date(endTimeStr);
  const now = new Date();
  const diff = end.getTime() - now.getTime();
  if (diff <= 0) return "Ended";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 0) return `${days}d ${remainingHours}h`;
  return `${hours}h`;
}

/**
 * Format a date string or Date object for display
 * @param dateStr - Date string or Date object
 * @returns Localized date/time string
 */
export function formatDate(dateStr: string | Date): string {
  return new Date(dateStr).toLocaleString();
}

/**
 * Format a date in user's local time (date + time).
 * Use for election end dates (primary, general).
 */
export function formatDateLocal(dateStr?: string | Date | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Get CSS classes for success/error message styling
 * @param message - The message text (success if starts with ✓, error otherwise)
 * @returns Tailwind CSS classes for the message container
 */
export function getMessageStyle(message: string): string {
  return message.startsWith("✓") || message.startsWith("Success:")
    ? "bg-green-500/20 text-green-400"
    : "bg-red-500/20 text-red-400";
}

/**
 * Compute the LARP election year from election metadata.
 * Returns the year the general election takes place (voting year).
 *
 * `ctx` selects the preset's real-world election-year anchors via
 * `CANONICAL_REAL_ELECTION_YEARS_BY_PRESET`. For the 2019-default preset
 * (the back-compat default) cycle 1 of US House is 2022, UK GE is 2024,
 * etc. For the 1991-default preset cycle 1 of US House is 1992, UK GE
 * is 1992, etc.
 */
/**
 * Resolve a baked `electionYear` if present on the doc, else fall back to
 * cycle-derived math under the caller-supplied ctx. New elections always
 * have `electionYear` baked at spawn (see Election type); this helper keeps
 * legacy/un-backfilled docs displaying correctly under the active preset
 * without each call site repeating the `?? electionToLarpYear(...)` dance.
 */
export function resolveElectionYear(
  election: {
    electionType: string;
    cycle: number;
    electionYear?: number | null;
    senateClass?: number | null;
    chamberClass?: number | null;
  },
  ctx: CycleAnchorContext = DEFAULT_CYCLE_ANCHOR_CONTEXT
): number {
  if (election.electionYear != null) return election.electionYear;
  return electionToLarpYear(
    election.electionType,
    election.cycle,
    election.senateClass,
    election.chamberClass,
    ctx
  );
}

export function electionToLarpYear(
  electionType: string,
  cycle: number,
  senateClass?: number | null,
  chamberClass?: number | null,
  ctx: CycleAnchorContext = DEFAULT_CYCLE_ANCHOR_CONTEXT,
  countryId?: CountryId
): number {
  // Cycle 0 is the pre-iteration "founding" election: it happens at the pinned
  // era start, so it is labeled with the starting year (not a pre-anchor year).
  if (cycle === 0) return ctx.startingYear;
  const years =
    CANONICAL_REAL_ELECTION_YEARS_BY_PRESET[ctx.preset] ??
    CANONICAL_REAL_ELECTION_YEARS_BY_PRESET["2019-default"];
  // Concurrent-general countries (NG): all four general offices share the
  // `ngGeneral` LARP year on a 4-year cadence, matching the schedule in
  // `canonicalTurnsForCycle`.
  const CONCURRENT_GENERAL_TYPES = new Set([
    "president",
    "house",
    "senate",
    "governor",
    "stateSenate",
  ]);
  if (
    countryId != null &&
    COUNTRIES_WITH_CONCURRENT_GENERAL_ELECTIONS.has(countryId) &&
    CONCURRENT_GENERAL_TYPES.has(electionType)
  ) {
    return years.ngGeneral + (cycle - 1) * 4;
  }
  switch (electionType) {
    case "house":
      // 2-year cycles
      return years.house + (cycle - 1) * 2;
    case "senate": {
      // BR Federal Senate: 4-year cycle riding its own `brSenate` anchor —
      // see BR_SENATE_CYCLE_PERIOD_HOURS in canonicalCycle.ts for the
      // full-chamber staggering-simplification note.
      if (countryId === "BR") {
        return years.brSenate + (cycle - 1) * 4;
      }
      // 6-year cycles, staggered by class
      const klass = senateClass ?? 2;
      const firstYear =
        klass === 1 ? years.senateClass1 : klass === 2 ? years.senateClass2 : years.senateClass3;
      return firstYear + (cycle - 1) * 6;
    }
    case "president":
      // 4-year cycles
      return years.president + (cycle - 1) * 4;
    case "governor":
    case "special_governor":
    case "stateSenate":
      // 4-year mid-term cycles. A governor by-election's cycle is an off-calendar
      // marker, so its computed year is approximate — display sites prefer the
      // doc's stored electionYear when present. RU First Secretaries ride the
      // republic-soviet cycle (D10) and DD Land First Secretaries the
      // Volkskammer cycle — same anchor overrides as canonicalCycle.
      if (countryId === "RU") {
        return (years.ruRepublicSoviet ?? years.governorStateSenate) + (cycle - 1) * 4;
      }
      if (countryId === "DD") {
        return (years.ddVolkskammer ?? years.governorStateSenate) + (cycle - 1) * 4;
      }
      return years.governorStateSenate + (cycle - 1) * 4;
    case "commons":
    case "snap_commons":
    case "regionalCouncil":
      // 5-year UK Commons cycle
      return years.ukCommons + (cycle - 1) * 5;
    case "shugiin":
    case "snap_shugiin":
      // 4-year JP Shugiin cycle
      return years.jpShugiin + (cycle - 1) * 4;
    case "bundestag":
    case "snap_bundestag":
      // 4-year DE Bundestag cycle
      return years.deBundestag + (cycle - 1) * 4;
    case "landtag":
    case "ministerPresident":
      // 5-year cycles. Real-world per-Land election years are staggered,
      // but the cycle-1 anchor at the preset level is the preset's
      // canonical Landtag year (1995 for 1991-default, 2026 for
      // 2019-default). Per-Land overrides live in
      // LANDTAG_CYCLE1_END_TURN_BY_LAND for the spawn-side turn math;
      // for the year label we use the preset-level anchor.
      return years.deLandtag + (cycle - 1) * 5;
    case "supremeSovietDeputy":
    case "nationalitiesDeputy":
      // RU: both national chambers share the ruSupremeSoviet anchor, 4-year
      // cadence (D3). Null-anchored presets never spawn these; the fallback
      // only guards display totality for malformed docs.
      return (years.ruSupremeSoviet ?? years.governorStateSenate) + (cycle - 1) * 4;
    case "republicSupremeSoviet":
      return (years.ruRepublicSoviet ?? years.governorStateSenate) + (cycle - 1) * 4;
    case "volkskammerDeputy":
      // DD: single-list Volkskammer, 4-year cadence (mirrors RU; the 192-turn
      // cycle table drives scheduling). Fallback guards display totality only.
      return (years.ddVolkskammer ?? years.governorStateSenate) + (cycle - 1) * 4;
    case "npcDelegate":
    case "peoplesCongress":
      // CN: 5-year cycle. 14th NPC → 2023 for 2019-default; 8th NPC →
      // 1993 for 1991-default. Same anchor for both NPC delegates and
      // Provincial People's Congresses (they sync).
      return years.cnNpcDelegate + (cycle - 1) * 5;
    case "sangiin": {
      // 3-year half-elections, two classes
      const cls = chamberClass ?? senateClass;
      const sangiinFirstYear = cls === 2 ? years.jpSangiinClass2 : years.jpSangiinClass1;
      return sangiinFirstYear + (cycle - 1) * 3;
    }
    case "dail":
      // IE Dáil Éireann — 4-year cycle (modelled), anchored on the preset's
      // ieDail year (2024 for 2019-default, 1992 for 1991-default).
      return years.ieDail + (cycle - 1) * 4;
    case "uachtaran":
      // IE Uachtarán na hÉireann — 7-year direct nationwide cycle, anchored
      // on the preset's ieUachtaran year (2025 / 1997).
      return years.ieUachtaran + (cycle - 1) * 7;
    case "localCouncil":
      // IE Local Council — 5-year synchronized cycle, anchored on the
      // preset's ieLocalCouncil year (2024 / 1991), matching the EP cycle.
      return years.ieLocalCouncil + (cycle - 1) * 5;
    case "holyrood":
      // SCO Holyrood — 5-year AMS cycle, anchored on the preset's devolved
      // election year (2021 / 1999).
      return years.scoHolyrood + (cycle - 1) * 5;
    case "senedd":
      // WAL Senedd Cymru — 5-year AMS cycle, anchored on the preset's devolved
      // election year (2021 / 1999).
      return years.walSenedd + (cycle - 1) * 5;
    // Beta-country parliamentary lower chambers (FR/IT/ES/SE/TR) — periods
    // match BETA_PARLIAMENT_CYCLES in canonicalCycle.ts (FR/IT 5y, ES/SE/TR 4y).
    case "assembleeNationale":
      return years.frAssembly + (cycle - 1) * 5;
    case "cameraDeputati":
      return years.itCamera + (cycle - 1) * 5;
    case "congresoDiputados":
      // Era-gated presets (ES 1953) never spawn this type; the fallback only
      // guards display totality for malformed docs.
      return (years.esCongreso ?? years.governorStateSenate) + (cycle - 1) * 4;
    case "riksdag":
      return years.seRiksdag + (cycle - 1) * 4;
    case "milletMeclisi":
      return years.trMeclis + (cycle - 1) * 4;
    default:
      return years.governorStateSenate + (cycle - 1) * 4;
  }
}

/**
 * Compute the LARP election year from an election's endTime.
 *
 * Uses currentTurn + lastTurnProcessed for an absolute (not relative) calculation
 * so elections with a past endTime are labelled correctly.
 *
 * Elections that end exactly on "Week 1" of a new year are displayed as
 * "Week 52" of the previous year — matching turnToLarpDate's special-case for
 * turn 48 and honouring the user preference that a race barely crossing a year
 * boundary keeps the prior year's label.
 *
 * @param endTime - ISO string or Date for the election's endTime
 * @param currentTurn - Current game turn (1-based)
 * @param lastTurnProcessed - Real-world timestamp of the last processed turn
 */
export function endTimeToGameYear(
  endTime: string | Date,
  currentTurn: number,
  lastTurnProcessed: string | Date,
  startingYear: number = STARTING_YEAR
): number {
  const TURNS_PER_YEAR = 48;
  const MS_PER_TURN = 3_600_000;

  const end = new Date(endTime);
  const ref = new Date(lastTurnProcessed);
  const turnsFromNow = Math.round((end.getTime() - ref.getTime()) / MS_PER_TURN);
  const turnAtEnd = currentTurn + turnsFromNow;

  // Treat elections ending on "Week 1" of year N as belonging to year N-1
  // (same logic as turnToLarpDate's turn-48 → Week 52 special case).
  const isAtYearBoundary = turnAtEnd > 1 && (turnAtEnd - 1) % TURNS_PER_YEAR === 0;
  const effectiveTurn = isAtYearBoundary ? turnAtEnd - 1 : turnAtEnd;

  return startingYear + Math.floor((effectiveTurn - 1) / TURNS_PER_YEAR);
}

const LARP_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * Calendar position of a game turn. 48 turns = 1 year, so a year is exactly
 * 12 months of 4 weeks and every turn lands on a whole week of a month.
 */
export function turnToLarpParts(
  currentTurn: number,
  startingYear: number = STARTING_YEAR
): { month: string; weekOfMonth: number; year: number } {
  const turn = !currentTurn || currentTurn < 1 ? 1 : currentTurn;
  const turnsInYear = ((turn - 1) % 48) + 1;
  return {
    month: LARP_MONTHS[Math.floor((turnsInYear - 1) / 4)],
    weekOfMonth: ((turnsInYear - 1) % 4) + 1,
    year: startingYear + Math.floor((turn - 1) / 48),
  };
}

/**
 * Convert game turn to LARP date string.
 *
 * Reads as a calendar date rather than a running week count: "Week 15" told a
 * player nothing about where they were in the year, so turns render as their
 * month plus the week within that month.
 *
 * @param currentTurn - Current game turn (1-based)
 * @returns Formatted string like "April, Week 3, 1953"
 */
export function turnToLarpDate(currentTurn: number, startingYear: number = STARTING_YEAR): string {
  const { month, weekOfMonth, year } = turnToLarpParts(currentTurn, startingYear);
  return `${month}, Week ${weekOfMonth}, ${year}`;
}

/**
 * Convert a real-world future timestamp to its expected LARP week string.
 * Turns process every hour. Given the current turn + the time of the last processed
 * turn, we project how many turns will have elapsed by `targetTime`.
 *
 * @param targetTime - The real-world deadline to convert (ISO string or Date)
 * @param currentTurn - The game's current turn number
 * @param lastTurnProcessed - Real-world time when the last turn ran
 * @returns LARP date string like "Week 12, 2024", or "" if inputs are missing
 */
export function realTimestampToLarpDate(
  targetTime?: string | Date | null,
  currentTurn?: number | null,
  lastTurnProcessed?: string | Date | null,
  startingYear: number = STARTING_YEAR
): string {
  if (!targetTime || !currentTurn || !lastTurnProcessed) return "";
  const end = new Date(targetTime);
  const ref = new Date(lastTurnProcessed);
  const TURN_MS = 60 * 60 * 1000; // 1 hour per turn
  const turnsUntil = Math.round((end.getTime() - ref.getTime()) / TURN_MS);
  // Subtract 1 so we show the last turn of the election period (e.g. turn 96
  // = Week 52, 2021) instead of the first turn after (turn 97 = Week 1, 2022).
  const targetTurn = currentTurn + Math.max(0, turnsUntil);
  return turnToLarpDate(
    Math.max(1, targetTurn > currentTurn ? targetTurn - 1 : targetTurn),
    startingYear
  );
}

/**
 * Convert a real-world PAST timestamp to the LARP week it fell in — the
 * backwards counterpart of {@link realTimestampToLarpDate}. Turns process
 * hourly, so the elapsed wall-clock hours between the timestamp and the last
 * processed turn approximate the elapsed turns (pauses make this an
 * approximation; acceptable for display badges like "since Week 23, 1991").
 *
 * @param pastTime - The real-world timestamp to convert (ISO string or Date)
 * @param currentTurn - The game's current turn number
 * @param lastTurnProcessed - Real-world time when the last turn ran
 * @returns LARP date string like "Week 12, 1991", or "" if inputs are missing
 */
export function pastRealTimestampToLarpDate(
  pastTime?: string | Date | null,
  currentTurn?: number | null,
  lastTurnProcessed?: string | Date | null,
  startingYear: number = STARTING_YEAR
): string {
  if (!pastTime || !currentTurn || !lastTurnProcessed) return "";
  const past = new Date(pastTime);
  const ref = new Date(lastTurnProcessed);
  const TURN_MS = 60 * 60 * 1000; // 1 hour per turn
  const turnsAgo = Math.max(0, Math.floor((ref.getTime() - past.getTime()) / TURN_MS));
  return turnToLarpDate(Math.max(1, currentTurn - turnsAgo), startingYear);
}

/**
 * Get CSS classes for timer urgency display
 * @param urgency - The urgency level from formatTimeRemaining
 * @returns Tailwind CSS classes for the timer text
 */
export function getTimerUrgencyStyle(urgency: TimeUrgency): string {
  switch (urgency) {
    case "paused":
      return "text-purple-400";
    case "critical":
      return "text-red-400";
    case "warning":
      return "text-yellow-400";
    case "ended":
      return "text-gray-400";
    default:
      return "text-green-400";
  }
}
