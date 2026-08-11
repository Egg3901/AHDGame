"use client";

import {
  createContext,
  useContext,
  useReducer,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  COUNTRY_CURRENCY_MAP,
  CURRENCY_ANCHOR_COUNTRY,
  FOREX_ACTIVE_CURRENCIES,
  getEraAwareCurrencySymbol,
} from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import type { CountryId } from "@/lib/constants/countries";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { useGameEvents } from "@/hooks/useGameEvents";
import {
  formatFundsCompact,
  formatCurrencyCompactChip,
  formatSharePrice,
  formatSharePriceOrder,
  formatCurrencyFull,
  type DisplayCurrencyPreference,
} from "@/lib/utils/formatters";
import { resolveSourceRate } from "@/lib/currency/resolveSourceRate";
import { resolveForcedDisplay } from "@/lib/currency/resolveForcedDisplay";

/**
 * Rate map: currencyCode → "local per 1 internal unit"
 * e.g. { USD: 1.0, GBP: 0.75, JPY: 106.0 }
 */
type RateMap = Partial<Record<CurrencyCode, number>>;

type RatesState = { data: RateMap | null; baseRates: RateMap | null; loading: boolean };
type RatesAction =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; rates: RateMap; baseRates: RateMap }
  | { type: "FETCH_DONE" }
  | { type: "FETCH_ERROR" }; // preserves cached data on refetch failure

/** Shallow-compare two rate maps (same currency keys, same numeric values). */
function rateMapsEqual(a: RateMap | null, b: RateMap | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a) as CurrencyCode[];
  const bKeys = Object.keys(b) as CurrencyCode[];
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

function ratesReducer(state: RatesState, action: RatesAction): RatesState {
  switch (action.type) {
    case "FETCH_START":
      // Silent background refresh: when rates are already cached (turn_complete /
      // tab-focus refetch), keep the state object identical so the ~111 useCurrency
      // consumers don't get a wasted first re-render wave before FETCH_SUCCESS.
      // The initial load (no cached data) still flips `loading` for skeletons.
      if (state.data) return state;
      return { ...state, loading: true };
    case "FETCH_SUCCESS":
      // Bail out when the fetched rates are identical to the cached ones (common
      // on tab-focus refreshes between turns) — returning the same state object
      // lets React skip re-rendering the provider subtree entirely.
      if (
        !state.loading &&
        rateMapsEqual(state.data, action.rates) &&
        rateMapsEqual(state.baseRates, action.baseRates)
      ) {
        return state;
      }
      return { data: action.rates, baseRates: action.baseRates, loading: false };
    case "FETCH_DONE":
      return { data: null, baseRates: null, loading: false };
    case "FETCH_ERROR":
      return { ...state, loading: false }; // keep whatever was cached
    default:
      return state;
  }
}

interface CurrencyContextValue {
  /**
   * The viewing player's home country (imperial character's country first, then
   * regular character, then nav fallback). Null when unauthenticated / not yet
   * loaded. Exposed so callers derive country-keyed values (e.g. founding FX
   * rate) from the SAME source as `currencyCode`/`currencySymbol`, instead of a
   * separate fetch that can drift out of sync.
   */
  countryId: CountryId | null;
  /** ISO 4217 code for the viewing player's home currency. "USD" when unauthenticated. */
  currencyCode: CurrencyCode;
  /** Display symbol (e.g. "£", "¥", "$"). */
  currencySymbol: string;
  /**
   * Convert an amount stored in internal units to the player's home currency.
   * e.g. convert(1000) for a GBP player with rate 0.75 → 750.
   */
  convert: (internalAmount: number) => number;
  /**
   * Convert an amount stored in a specific currency to the player's home currency.
   * e.g. convertFrom(1000, "GBP") for a JPY player → 1000 / 0.75 * 106 ≈ 141,333.
   */
  convertFrom: (amount: number, fromCurrency: CurrencyCode) => number;
  /**
   * Convert an amount stored in a specific currency back to ₳ (internal units).
   * Use when a value is denominated in a known currency (e.g. corp liquidCapital
   * in `liquidCurrencyCode`) and you need a ₳-scale input for formatAmount()
   * so the player's display preference is respected.
   */
  /**
   * Convert a display-currency amount back to internal units.
   * Inverse of convert(): toInternal(convert(x)) ≈ x.
   * Use this when a player types a value in their display currency and
   * the API expects internal units.
   */
  toInternal: (displayAmount: number) => number;
  /**
   * Convert an amount from any named currency to internal units.
   * e.g. toInternalFrom(750, "GBP") with rate 0.75 → 1000 ₳.
   * Use for values stored in a specific currency (e.g. corp liquidCapital).
   */
  toInternalFrom: (amount: number, fromCurrency: CurrencyCode) => number;
  /**
   * Convert an amount the player typed in their current display currency into
   * a specific target currency (e.g. a share-order limit-price entered in the
   * viewer's display currency but stored server-side in the target corp's
   * liquidCurrencyCode). Round-trips through ₳: displayAmount / displayRate
   * × targetRate. Returns displayAmount unchanged if rates are missing.
   */
  toLocalOf: (displayAmount: number, targetCurrency: CurrencyCode) => number;
  /**
   * Format an internal-unit amount according to the player's display preference.
   * - "internal": shows $X (raw game dollar, no conversion)
   * - "home": converts to player's home currency and formats
   * - "local": converts to nativeCurrencyCode (falls back to home when omitted)
   */
  formatAmount: (internalAmount: number, nativeCurrencyCode?: CurrencyCode) => string;
  /**
   * Like {@link formatAmount} but uses a snapshot FX rate map taken at the time
   * the value was recorded, instead of today's live rates. Use for historical
   * chart points (portfolio snapshots) so each point converts back through the
   * rate that was in effect then — without this, a floating ₳/local rate paints
   * phantom volatility on past turns whose underlying local-currency value was
   * actually unchanged. Falls back to live rates when `snapshotRates` is
   * undefined or empty (pre-fix snapshots).
   */
  formatAmountAtRates: (
    internalAmount: number,
    snapshotRates: Partial<Record<CurrencyCode, number>> | undefined,
    nativeCurrencyCode?: CurrencyCode
  ) => string;
  /**
   * Like {@link formatAmountAtRates} but returns the raw display value plus
   * symbol — for chart code that needs both the numeric value (Y-axis scale)
   * and a label without re-formatting. Falls back to live rates when
   * `snapshotRates` is missing.
   */
  resolveDisplayAt: (
    internalAmount: number,
    snapshotRates: Partial<Record<CurrencyCode, number>> | undefined,
    nativeCurrencyCode?: CurrencyCode
  ) => { value: number; symbol: string };
  /**
   * Like formatAmount but uses {@link formatCurrencyCompactChip} after conversion — matches
   * status bar / profile fund strip precision (two decimals in the millions tier).
   */
  formatAmountChip: (internalAmount: number, nativeCurrencyCode?: CurrencyCode) => string;
  /**
   * Force-format an internal-unit amount in a specific currency, ignoring the
   * viewer's `displayCurrencyPreference`. Use this for economy-anchored
   * quantities like total sector market size, where the number represents the
   * underlying state economy (not the viewer's wallet) and should not drift
   * turn-over-turn with forex rate changes on the viewer's preferred currency.
   */
  formatAmountIn: (internalAmount: number, currencyCode: CurrencyCode) => string;
  /** Chip-precision variant of {@link formatAmountIn}. */
  formatAmountChipIn: (internalAmount: number, currencyCode: CurrencyCode) => string;
  /** The symbol for the player's current display mode ("₳" in internal, "£"/"$"/"¥" otherwise). */
  inputSymbol: string;
  /** Current display preference. */
  displayCurrencyPreference: DisplayCurrencyPreference;
  /** Save a new preference (optimistic update + persists to server). */
  setDisplayCurrencyPreference: (pref: DisplayCurrencyPreference) => void;
  /**
   * Format a share price (2-decimal precision) in the player's preferred currency.
   * Accepts an internal-unit amount and optional native currency code for "local" mode.
   */
  formatPrice: (internalAmount: number, nativeCurrencyCode?: CurrencyCode) => string;
  /**
   * Format a full currency amount (no abbreviation, no decimals) in the player's preferred currency.
   * Accepts an internal-unit amount and optional native currency code for "local" mode.
   */
  formatFull: (internalAmount: number, nativeCurrencyCode?: CurrencyCode) => string;
  /**
   * Format an order-book price (4-decimal precision) in the player's preferred currency.
   * Accepts an internal-unit amount and optional native currency code for "local" mode.
   */
  formatPriceOrder: (internalAmount: number, nativeCurrencyCode?: CurrencyCode) => string;
  /**
   * Format a share price ALWAYS in the given currency, ignoring the viewer's
   * `displayCurrencyPreference`. Use for shares that trade on a specific
   * exchange (e.g. an NGX-listed corp priced in the naira): a native price of
   * 1,339 must read as its own currency, not collapse to "$0.00" when the
   * viewer's preference converts a weak-currency price into USD or the anchor.
   */
  formatPriceIn: (internalAmount: number, currencyCode: CurrencyCode) => string;
  /** True while exchange rates are still loading. */
  ratesLoading: boolean;
  /**
   * Calibration rates (local per internal unit) from DB `baseRate`, parallel to live `rates`.
   * Null when forex is off or rates have not loaded.
   */
  baseRates: RateMap | null;
  /** Live rates map (same keys as `/api/forex/rates`). Null when forex is off or not yet loaded. */
  forexRates: RateMap | null;
  /** True when the multi-currency system is enabled for the viewing player. */
  forexEnabled: boolean;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

const USD_FALLBACK: CurrencyContextValue = {
  countryId: null,
  currencyCode: "USD",
  currencySymbol: "$",
  convert: (x) => x,
  convertFrom: (x) => x,
  toInternal: (x) => x,
  toInternalFrom: (x) => x,
  toLocalOf: (x) => x,
  formatAmount: (x) => formatFundsCompact(x, "₳"),
  formatAmountAtRates: (x) => formatFundsCompact(x, "₳"),
  resolveDisplayAt: (x) => ({ value: x, symbol: "₳" }),
  formatAmountChip: (x) => formatCurrencyCompactChip(x, "₳"),
  formatAmountIn: (x) => formatFundsCompact(x, "₳"),
  formatAmountChipIn: (x) => formatCurrencyCompactChip(x, "₳"),
  inputSymbol: "₳",
  displayCurrencyPreference: "internal",
  setDisplayCurrencyPreference: () => {},
  formatPrice: (x) => formatSharePrice(x, "₳"),
  formatFull: (x) => formatCurrencyFull(x, "₳"),
  formatPriceOrder: (x) => formatSharePriceOrder(x, "₳"),
  formatPriceIn: (x) => formatSharePrice(x, "₳"),
  ratesLoading: false,
  baseRates: null,
  forexRates: null,
  forexEnabled: false,
};

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user, navData } = useAuthMe();
  const worldFlags = useWorldFlags();
  const [ratesState, dispatchRates] = useReducer(ratesReducer, {
    data: null,
    baseRates: null,
    loading: false,
  });
  // Local override set when the player manually changes preference mid-session.
  // Falls back to server-persisted value from auth/me so no sync effect is needed.
  const [prefOverride, setPrefOverride] = useState<DisplayCurrencyPreference | null>(null);

  const forexEnabled = user?.forexEnabled === true;
  const countryId =
    user?.imperialCharacter?.countryId ??
    user?.character?.countryId ??
    navData?.characterCountryId ??
    null;
  const currencyCode: CurrencyCode = countryId
    ? (COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD")
    : "USD";
  const currencySymbol =
    getEraAwareCurrencySymbol(
      currencyCode,
      worldFlags.preset,
      worldFlags.eurozoneEnabled,
      countryId ?? undefined
    ) ?? "$";

  // Derive preference: local override wins; otherwise use server-persisted value.
  const rawServerPref =
    user?.imperialCharacter?.displayCurrencyPreference ??
    user?.character?.displayCurrencyPreference;
  const VALID_PREFS: readonly DisplayCurrencyPreference[] = [
    "local",
    "home",
    "internal",
    "CAD",
    ...FOREX_ACTIVE_CURRENCIES,
  ];
  const serverPref: DisplayCurrencyPreference =
    rawServerPref && VALID_PREFS.includes(rawServerPref as DisplayCurrencyPreference)
      ? (rawServerPref as DisplayCurrencyPreference)
      : forexEnabled
        ? "local"
        : "internal";
  const displayCurrencyPreference = prefOverride ?? serverPref;

  // Derive effective rates — treat as null when forex is disabled so callers
  // don't need to know about the flag.
  const effectiveRates = forexEnabled ? ratesState.data : null;
  const effectiveBaseRates = forexEnabled ? ratesState.baseRates : null;

  const refreshRates = useCallback(() => {
    if (!forexEnabled) return;
    dispatchRates({ type: "FETCH_START" });
    fetch("/api/forex/rates", { credentials: "same-origin", cache: "no-store" })
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{
          rates: Partial<Record<CurrencyCode, number>>;
          baseRates?: Partial<Record<CurrencyCode, number>>;
        }>;
      })
      .then((data) => {
        if (data?.rates) {
          dispatchRates({
            type: "FETCH_SUCCESS",
            rates: data.rates,
            baseRates: data.baseRates ?? {},
          });
        } else {
          dispatchRates({ type: "FETCH_DONE" });
        }
      })
      .catch(() => {
        // Preserve cached rates on error rather than reverting to ₳.
        dispatchRates({ type: "FETCH_ERROR" });
      });
  }, [forexEnabled]);

  // Initial load + reload whenever the user toggles forex availability.
  useEffect(() => {
    refreshRates();
  }, [refreshRates]);

  // Live-refresh: rates update each turn server-side, so pull fresh values
  // when the shared turn poller signals a turn completed. Without this, a
  // long-lived tab keeps showing the rate snapshot from when it was loaded.
  useGameEvents(
    useCallback(() => {
      refreshRates();
    }, [refreshRates]),
    ["turn_complete"],
    forexEnabled
  );

  // Refresh when the user returns to the tab after a period away. Avoids
  // stale rates surfacing on the first interaction post-idle (the most
  // common path to a forex-related affordability error).
  // Both listeners stay (visibilitychange misses window-focus switches between
  // visible windows; focus misses tab switches in some browsers) but returning
  // to a tab fires BOTH back-to-back, so throttle to one fetch per second.
  const lastFocusRefreshRef = useRef(0);
  useEffect(() => {
    if (!forexEnabled) return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastFocusRefreshRef.current < 1_000) return;
      lastFocusRefreshRef.current = now;
      refreshRates();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [forexEnabled, refreshRates]);

  const convert = useCallback(
    (internalAmount: number): number => {
      if (!effectiveRates) return internalAmount;
      const rate = effectiveRates[currencyCode] ?? 1;
      return internalAmount * rate;
    },
    [effectiveRates, currencyCode]
  );

  const toInternal = useCallback(
    (displayAmount: number): number => {
      if (!effectiveRates) return displayAmount;
      // Must mirror resolveDisplay: whatever currency the UI shows is what the
      // user's input is assumed to be denominated in. A JP player with pref
      // pinned to "USD" sees "$156K" and types "50000" thinking USD — we must
      // divide by the USD rate, not the home-country (JPY) rate.
      const rate = resolveSourceRate(displayCurrencyPreference, currencyCode, effectiveRates);
      return rate > 0 ? displayAmount / rate : displayAmount;
    },
    [effectiveRates, currencyCode, displayCurrencyPreference]
  );

  const toInternalFrom = useCallback(
    (amount: number, fromCurrency: CurrencyCode): number => {
      if (!effectiveRates) return amount;
      const rate = effectiveRates[fromCurrency] ?? 1;
      return rate > 0 ? amount / rate : amount;
    },
    [effectiveRates]
  );

  const toLocalOf = useCallback(
    (displayAmount: number, targetCurrency: CurrencyCode): number => {
      if (!effectiveRates) return displayAmount;
      const sourceRate = resolveSourceRate(displayCurrencyPreference, currencyCode, effectiveRates);
      const targetRate = effectiveRates[targetCurrency] ?? 1;
      if (sourceRate <= 0) return displayAmount;
      return (displayAmount / sourceRate) * targetRate;
    },
    [effectiveRates, displayCurrencyPreference, currencyCode]
  );

  const convertFrom = useCallback(
    (amount: number, fromCurrency: CurrencyCode): number => {
      if (!effectiveRates) return amount;
      const fromRate = effectiveRates[fromCurrency] ?? 1;
      const toRate = effectiveRates[currencyCode] ?? 1;
      // amount / fromRate = internal units; internal * toRate = home currency
      return (amount / fromRate) * toRate;
    },
    [effectiveRates, currencyCode]
  );

  // Shared conversion logic: resolve (value, symbol) pair based on display preference.
  // All format* functions delegate here, differing only in the final string formatting.
  const resolveDisplay = useCallback(
    (
      internalAmount: number,
      nativeCurrencyCode?: CurrencyCode
    ): { value: number; symbol: string } => {
      if (displayCurrencyPreference === "internal") {
        return { value: internalAmount, symbol: "₳" };
      }
      if (!effectiveRates) {
        // Rates not yet loaded or temporarily unavailable — ₳ is loading fallback, not user preference.
        return { value: internalAmount, symbol: "₳" };
      }
      if (displayCurrencyPreference === "home") {
        return { value: convert(internalAmount), symbol: currencySymbol };
      }
      if (displayCurrencyPreference === "local") {
        if (nativeCurrencyCode && effectiveRates[nativeCurrencyCode] !== undefined) {
          const rate = effectiveRates[nativeCurrencyCode]!;
          const symbol =
            getEraAwareCurrencySymbol(
              nativeCurrencyCode,
              worldFlags.preset,
              worldFlags.eurozoneEnabled,
              CURRENCY_ANCHOR_COUNTRY[nativeCurrencyCode]
            ) ?? "$";
          return { value: internalAmount * rate, symbol };
        }
        return { value: convert(internalAmount), symbol: currencySymbol };
      }
      // Pinned to a specific CurrencyCode (e.g. "EUR"). Always render that
      // selected currency. If the live map is sparse, use the base calibration
      // rate before falling back to a neutral 1:1 internal display; do not
      // silently switch to home/local currency.
      const pinned = displayCurrencyPreference as CurrencyCode;
      const symbol =
        getEraAwareCurrencySymbol(
          pinned,
          worldFlags.preset,
          worldFlags.eurozoneEnabled,
          CURRENCY_ANCHOR_COUNTRY[pinned]
        ) ?? "$";
      const rate = effectiveRates[pinned] ?? effectiveBaseRates?.[pinned];
      if (rate !== undefined && Number.isFinite(rate) && rate > 0) {
        return { value: internalAmount * rate, symbol };
      }
      return { value: internalAmount, symbol };
    },
    [
      displayCurrencyPreference,
      effectiveRates,
      effectiveBaseRates,
      convert,
      currencySymbol,
      worldFlags,
    ]
  );

  const formatAmount = useCallback(
    (internalAmount: number, nativeCurrencyCode?: CurrencyCode): string => {
      const { value, symbol } = resolveDisplay(internalAmount, nativeCurrencyCode);
      return formatFundsCompact(Math.round(value), symbol);
    },
    [resolveDisplay]
  );

  // Mirror of resolveDisplay that uses a snapshot rate map when available.
  // Same branching as resolveDisplay — internal mode skips conversion, every
  // other mode converts via snapshotRates[currency] before falling through to
  // effectiveRates (live) when the snapshot lacks the currency. Lets historical
  // chart points show the local-currency value at the rate that was actually in
  // effect then, instead of today's rate getting back-applied to old anchor.
  const resolveDisplayAt = useCallback(
    (
      internalAmount: number,
      snapshotRates: Partial<Record<CurrencyCode, number>> | undefined,
      nativeCurrencyCode?: CurrencyCode
    ): { value: number; symbol: string } => {
      if (displayCurrencyPreference === "internal") {
        return { value: internalAmount, symbol: "₳" };
      }
      if (!effectiveRates) {
        return { value: internalAmount, symbol: "₳" };
      }
      const lookup = (code: CurrencyCode): number | undefined => {
        const fromSnap = snapshotRates?.[code];
        if (typeof fromSnap === "number" && Number.isFinite(fromSnap) && fromSnap > 0) {
          return fromSnap;
        }
        const live = effectiveRates[code];
        return typeof live === "number" && Number.isFinite(live) && live > 0 ? live : undefined;
      };

      if (displayCurrencyPreference === "home") {
        const rate = lookup(currencyCode);
        if (rate !== undefined) return { value: internalAmount * rate, symbol: currencySymbol };
        return { value: internalAmount, symbol: currencySymbol };
      }
      if (displayCurrencyPreference === "local") {
        if (nativeCurrencyCode) {
          const rate = lookup(nativeCurrencyCode);
          if (rate !== undefined) {
            const symbol =
              getEraAwareCurrencySymbol(
                nativeCurrencyCode,
                worldFlags.preset,
                worldFlags.eurozoneEnabled,
                CURRENCY_ANCHOR_COUNTRY[nativeCurrencyCode]
              ) ?? "$";
            return { value: internalAmount * rate, symbol };
          }
        }
        const rate = lookup(currencyCode);
        if (rate !== undefined) return { value: internalAmount * rate, symbol: currencySymbol };
        return { value: internalAmount, symbol: currencySymbol };
      }
      // Pinned to a specific currency code.
      const pinned = displayCurrencyPreference as CurrencyCode;
      const symbol =
        getEraAwareCurrencySymbol(
          pinned,
          worldFlags.preset,
          worldFlags.eurozoneEnabled,
          CURRENCY_ANCHOR_COUNTRY[pinned]
        ) ?? "$";
      const rate = lookup(pinned) ?? effectiveBaseRates?.[pinned];
      if (rate !== undefined && Number.isFinite(rate) && rate > 0) {
        return { value: internalAmount * rate, symbol };
      }
      return { value: internalAmount, symbol };
    },
    [
      displayCurrencyPreference,
      effectiveRates,
      effectiveBaseRates,
      currencyCode,
      currencySymbol,
      worldFlags,
    ]
  );

  const formatAmountAtRates = useCallback(
    (
      internalAmount: number,
      snapshotRates: Partial<Record<CurrencyCode, number>> | undefined,
      nativeCurrencyCode?: CurrencyCode
    ): string => {
      const { value, symbol } = resolveDisplayAt(internalAmount, snapshotRates, nativeCurrencyCode);
      return formatFundsCompact(Math.round(value), symbol);
    },
    [resolveDisplayAt]
  );

  const formatAmountChip = useCallback(
    (internalAmount: number, nativeCurrencyCode?: CurrencyCode): string => {
      const { value, symbol } = resolveDisplay(internalAmount, nativeCurrencyCode);
      return formatCurrencyCompactChip(value, symbol);
    },
    [resolveDisplay]
  );

  const formatAmountInFn = useCallback(
    (internalAmount: number, currencyCode: CurrencyCode): string => {
      const { value, symbol } = resolveForcedDisplay(
        internalAmount,
        currencyCode,
        effectiveRates,
        worldFlags.preset
      );
      return formatFundsCompact(Math.round(value), symbol);
    },
    [effectiveRates, worldFlags.preset]
  );

  const formatAmountChipInFn = useCallback(
    (internalAmount: number, currencyCode: CurrencyCode): string => {
      const { value, symbol } = resolveForcedDisplay(
        internalAmount,
        currencyCode,
        effectiveRates,
        worldFlags.preset
      );
      return formatCurrencyCompactChip(value, symbol);
    },
    [effectiveRates, worldFlags.preset]
  );

  const formatPriceFn = useCallback(
    (internalAmount: number, nativeCurrencyCode?: CurrencyCode): string => {
      const { value, symbol } = resolveDisplay(internalAmount, nativeCurrencyCode);
      return formatSharePrice(value, symbol);
    },
    [resolveDisplay]
  );

  const formatPriceInFn = useCallback(
    (internalAmount: number, currencyCode: CurrencyCode): string => {
      const { value, symbol } = resolveForcedDisplay(
        internalAmount,
        currencyCode,
        effectiveRates,
        worldFlags.preset
      );
      return formatSharePrice(value, symbol);
    },
    [effectiveRates, worldFlags.preset]
  );

  const formatFullFn = useCallback(
    (internalAmount: number, nativeCurrencyCode?: CurrencyCode): string => {
      const { value, symbol } = resolveDisplay(internalAmount, nativeCurrencyCode);
      return formatCurrencyFull(Math.round(value), symbol);
    },
    [resolveDisplay]
  );

  const formatPriceOrderFn = useCallback(
    (internalAmount: number, nativeCurrencyCode?: CurrencyCode): string => {
      const { value, symbol } = resolveDisplay(internalAmount, nativeCurrencyCode);
      return formatSharePriceOrder(value, symbol);
    },
    [resolveDisplay]
  );

  const setDisplayCurrencyPreference = useCallback((pref: DisplayCurrencyPreference) => {
    setPrefOverride(pref);
    // Persist to server (fire-and-forget; optimistic update already applied above)
    fetch("/api/settings/display-currency", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayCurrencyPreference: pref }),
    }).catch((err) => {
      // Non-critical — preference will re-sync on next page load
      console.debug("display-currency preference sync failed", err);
    });
  }, []);

  // Memoized: ~111 useCurrency consumers subscribe to this value. Without the
  // memo every provider re-render (auth updates, world-flag loads, parent
  // renders) minted a fresh object and re-rendered all of them.
  const value = useMemo<CurrencyContextValue>(
    () => ({
      countryId: (countryId as CountryId | null) ?? null,
      currencyCode,
      currencySymbol,
      convert,
      convertFrom,
      toInternal,
      toInternalFrom,
      toLocalOf,
      formatAmount,
      formatAmountAtRates,
      resolveDisplayAt,
      formatAmountChip,
      formatAmountIn: formatAmountInFn,
      formatAmountChipIn: formatAmountChipInFn,
      // Must match the currency toInternal assumes as the input denomination.
      // Pinned preferences (e.g. JP player pinned to "USD") show the pinned
      // symbol so the input prefix reflects what the user is actually typing.
      inputSymbol:
        displayCurrencyPreference === "internal" || !effectiveRates
          ? "₳"
          : displayCurrencyPreference === "home" || displayCurrencyPreference === "local"
            ? currencySymbol
            : (getEraAwareCurrencySymbol(
                displayCurrencyPreference as CurrencyCode,
                worldFlags.preset,
                worldFlags.eurozoneEnabled,
                CURRENCY_ANCHOR_COUNTRY[displayCurrencyPreference as CurrencyCode]
              ) ?? currencySymbol),
      displayCurrencyPreference,
      setDisplayCurrencyPreference,
      formatPrice: formatPriceFn,
      formatPriceIn: formatPriceInFn,
      formatFull: formatFullFn,
      formatPriceOrder: formatPriceOrderFn,
      ratesLoading: ratesState.loading,
      baseRates: effectiveBaseRates,
      forexRates: effectiveRates,
      forexEnabled,
    }),
    [
      countryId,
      currencyCode,
      currencySymbol,
      convert,
      convertFrom,
      toInternal,
      toInternalFrom,
      toLocalOf,
      formatAmount,
      formatAmountAtRates,
      resolveDisplayAt,
      formatAmountChip,
      formatAmountInFn,
      formatAmountChipInFn,
      displayCurrencyPreference,
      setDisplayCurrencyPreference,
      formatPriceFn,
      formatPriceInFn,
      formatFullFn,
      formatPriceOrderFn,
      ratesState.loading,
      effectiveBaseRates,
      effectiveRates,
      forexEnabled,
      worldFlags,
    ]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/**
 * Access the viewing player's home currency, conversion helpers, and display preference.
 * Falls back gracefully to USD/internal when used outside CurrencyProvider (e.g. in tests).
 */
export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  return ctx ?? USD_FALLBACK;
}
