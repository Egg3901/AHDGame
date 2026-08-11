"use client";

import { useEffect, useMemo, useState } from "react";
import { getEraFoundingBounds, getEraFounderShares } from "@/lib/constants/sectorSeedEra";
import {
  CORPORATION_TYPE_LABELS,
  CORPORATION_FOUNDING_COST,
  CORPORATION_STARTING_CAPITAL,
  MIN_CORPORATION_STARTING_CAPITAL,
  MAX_CORPORATION_STARTING_CAPITAL,
  CEO_INITIAL_SHARES,
  IPO_MIN_FLOAT_PCT,
  IPO_MAX_FLOAT_PCT,
} from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { computeIpoIssuance } from "@/lib/corporations/ipoIssuance";
import {
  SUPERSHARE_MIN_MULTIPLIER,
  SUPERSHARE_MAX_MULTIPLIER,
  SUPERSHARE_IPO_MAX_FLOAT_PCT,
} from "@/lib/corporations/superShares";
import {
  computeFoundingCosts,
  getFoundingConfidenceMultiplier,
} from "@/lib/corporations/foundingCosts";
import { fetchJson } from "@/lib/observability/fetchJson";

export function FoundCorporationModal({
  open,
  onClose,
  onSuccess,
  currencySymbol = "$",
  foundingRate = 1,
  countryId,
  foundingCooldownTurnsRemaining = 0,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  currencySymbol?: string;
  /**
   * Local-currency units per ₳ for the FOUNDER's home country (server uses the
   * same INITIAL_RATES calibration). 1 for USD / forex-off. Every money figure
   * shown is in local currency so it matches what the server actually charges.
   */
  foundingRate?: number;
  /** The founder's home country — used to fetch investor confidence (feed-3). */
  countryId?: string;
  /**
   * Turns remaining on the per-user 168-turn founding cooldown (Bug #0728).
   * 0 = may found now. Disables the Found button and shows a countdown.
   */
  foundingCooldownTurnsRemaining?: number;
}) {
  const [founding, setFounding] = useState(false);
  const [foundName, setFoundName] = useState("");
  const [tickerSymbol, setTickerSymbol] = useState("");
  /** No default — prevents one-click founding as Financial when the player meant to pick another sector. */
  const [foundType, setFoundType] = useState<CorporationType | "">("");
  const [secondaryType, setSecondaryType] = useState<CorporationType | "">("");
  // Treasury the player commits, held in LOCAL currency — exactly what they
  // type and see. The ₳ (anchor) amount sent to the API is DERIVED from this.
  // Holding the local value directly, instead of re-deriving the field from a
  // floor(local/rate) → round(anchor*rate) round-trip on every keystroke, is
  // what lets the player enter a free amount: that round-trip is lossy for any
  // non-USD rate and corrupted the value as they typed (e.g. CN 7.2x).
  const [treasuryLocalInput, setTreasuryLocalInput] = useState<number>(() =>
    Math.round(CORPORATION_STARTING_CAPITAL * foundingRate)
  );
  const [foundingMode, setFoundingMode] = useState<"private" | "public">("private");
  const [floatPct, setFloatPct] = useState<number>(25);
  const [dualClass, setDualClass] = useState(false);
  const [superMultiplier, setSuperMultiplier] = useState<number>(SUPERSHARE_MAX_MULTIPLIER);
  const [highFloatAck, setHighFloatAck] = useState(false);
  const [foundError, setFoundError] = useState("");
  // Feed-3: the founder's country investor confidence drives a founding premium.
  // Fetched here so the preview matches the server charge (both use the same
  // getFoundingConfidenceMultiplier formula on this value).
  const [investorConfidence, setInvestorConfidence] = useState<number | null>(null);
  // World preset drives era money. The server route deflates the fee, the
  // baseline and the capital bounds by the same function, so preview == charge.
  const [worldPreset, setWorldPreset] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchJson<{ preset?: string }>("/api/world/flags", { feature: "world-flags" })
      .then((d) => {
        if (!cancelled) setWorldPreset(d?.preset);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  const eraBounds = useMemo(
    () =>
      getEraFoundingBounds(worldPreset, {
        fee: CORPORATION_FOUNDING_COST,
        baseline: CORPORATION_STARTING_CAPITAL,
        min: MIN_CORPORATION_STARTING_CAPITAL,
        max: MAX_CORPORATION_STARTING_CAPITAL,
      }),
    [worldPreset]
  );
  // Share base deflates with the era alongside the treasury, so the opening
  // price stays $0.10 instead of floored at MIN_SHARE_PRICE. Must match the
  // route's `getEraFounderShares` or the preview lies about the cap table.
  const founderShares = useMemo(
    () => getEraFounderShares(CEO_INITIAL_SHARES, worldPreset),
    [worldPreset]
  );

  useEffect(() => {
    if (!open || !countryId) return;
    let cancelled = false;
    fetchJson<{ investorConfidence?: number }>(
      `/api/country/${countryId.toLowerCase()}/investor-confidence`,
      { feature: "investor-confidence" }
    )
      .then((d) => {
        if (!cancelled) setInvestorConfidence(d?.investorConfidence ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, countryId]);

  // Re-seed the baseline treasury whenever the modal opens. The FX rate is
  // stable by the time the player can open it; this also corrects the seed when
  // the rate finished loading after first mount (rate starts at 1 until the
  // currency context resolves the player's country).
  useEffect(() => {
    if (open) setTreasuryLocalInput(Math.round(eraBounds.baseline * foundingRate));
  }, [open, foundingRate, eraBounds.baseline]);

  // ₳ (anchor) amount — the API contract — derived from the local input.
  const startingCapital = Math.floor(treasuryLocalInput / foundingRate);

  // Every figure shown to the player is converted to local currency via the
  // shared helper, so the preview matches what the server actually charges.
  const confidenceMultiplier = getFoundingConfidenceMultiplier(investorConfidence);
  const {
    corpStartingCapital,
    totalPlayerCost,
    extraCapitalOverBaselineAnchor,
    confidencePremiumLocal,
  } = useMemo(
    () =>
      computeFoundingCosts({
        startingCapitalAnchor: startingCapital,
        foundingRate,
        confidenceMultiplier,
        // Without the preset this compares the era's treasury against the
        // MODERN baseline, so a 1953 founder was shown a large negative
        // "extra treasury" (14,333 − 1,000,000). The total happened to come
        // out right because the unscaled fee cancelled the error exactly;
        // the line items did not. The route already passes the preset.
        preset: worldPreset,
      }),
    [startingCapital, foundingRate, confidenceMultiplier, worldPreset]
  );
  const foundingFeeLocal = Math.round(eraBounds.fee * foundingRate);
  const extraCapital = Math.round(extraCapitalOverBaselineAnchor * foundingRate);
  const treasuryLocal = corpStartingCapital;
  const totalPersonalCost = totalPlayerCost;
  const initialSharePrice = Math.max(0.01, Math.round((treasuryLocal / founderShares) * 100) / 100);
  // Local-currency bounds for the treasury input (anchor bounds × rate).
  const minCapitalLocal = Math.round(eraBounds.min * foundingRate);
  const maxCapitalLocal = Math.round(eraBounds.max * foundingRate);
  // step must stay 1 (any integer). A 100_000 spinner step — fine for modern
  // 1M–50M bounds — marks most in-range 1953 amounts `:invalid` in Chrome
  // because (value − min) % step !== 0, painting a red outline on legal input
  // (ticket #1003). Players type freely; spinner granularity is not worth that.
  const treasuryStepLocal = 1;
  const ipoPreview = useMemo(() => {
    if (foundingMode !== "public") return null;
    try {
      return computeIpoIssuance({
        existingShares: founderShares,
        pricePerShare: initialSharePrice,
        floatPct,
        withSuperShares: dualClass,
      });
    } catch {
      return null;
    }
  }, [foundingMode, floatPct, initialSharePrice, dualClass, founderShares]);

  const capitalTooLow = startingCapital < eraBounds.min;
  const capitalTooHigh = startingCapital > eraBounds.max;
  const secondaryMatchesPrimary = secondaryType !== "" && secondaryType === foundType;
  const onFoundingCooldown = foundingCooldownTurnsRemaining > 0;
  const maxFloatPct = dualClass ? SUPERSHARE_IPO_MAX_FLOAT_PCT : IPO_MAX_FLOAT_PCT;
  const requiresHighFloatAck = foundingMode === "public" && floatPct > IPO_MAX_FLOAT_PCT;
  const disabled =
    founding ||
    !foundName.trim() ||
    !tickerSymbol ||
    !foundType ||
    capitalTooLow ||
    capitalTooHigh ||
    secondaryMatchesPrimary ||
    onFoundingCooldown ||
    (requiresHighFloatAck && !highFloatAck);

  function clampFloatPct(raw: number): number {
    if (!Number.isFinite(raw)) return IPO_MIN_FLOAT_PCT;
    return Math.min(maxFloatPct, Math.max(IPO_MIN_FLOAT_PCT, Math.round(raw)));
  }

  async function handleFound() {
    if (disabled) return;
    if (requiresHighFloatAck && !highFloatAck) {
      setFoundError(
        `Floating more than ${IPO_MAX_FLOAT_PCT}% permanently dilutes your ownership below 51%. Confirm the checkbox first.`
      );
      return;
    }
    if (requiresHighFloatAck) {
      const ownership = ipoPreview?.founderOwnershipPctAfter.toFixed(1) ?? String(100 - floatPct);
      const ok = window.confirm(
        `Confirm founding IPO at ${floatPct}% public float?\n\nYou will keep only ~${ownership}% economic ownership (voting control stays via supershares).`
      );
      if (!ok) return;
    }
    setFounding(true);
    setFoundError("");
    try {
      const res = await fetch("/api/corporations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: foundName.trim(),
          tickerSymbol,
          type: foundType,
          startingCapital,
          ...(secondaryType ? { secondaryType } : {}),
          ...(foundingMode === "public"
            ? {
                ipo: {
                  floatPct,
                  ...(dualClass ? { superShareMultiplier: superMultiplier } : {}),
                },
              }
            : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setFoundName("");
        setTickerSymbol("");
        setFoundType("");
        setSecondaryType("");
        setTreasuryLocalInput(Math.round(eraBounds.baseline * foundingRate));
        setFoundingMode("private");
        setFloatPct(25);
        setDualClass(false);
        setSuperMultiplier(SUPERSHARE_MAX_MULTIPLIER);
        setHighFloatAck(false);
        onClose();
        onSuccess();
      } else {
        setFoundError(data.error || "Failed to found corporation");
      }
    } catch {
      setFoundError("Network error");
    } finally {
      setFounding(false);
    }
  }

  if (!open) return null;

  const fmt = (n: number) => `${currencySymbol}${n.toLocaleString("en-US")}`;

  return (
    // z-[100] sits above the sticky StatusBar (z-50). Extra bottom padding on
    // mobile keeps the Cancel/Found footer clear of that bar — same class of
    // bug as IssueOrderModal (ticket #1003: "something is hidden" on Android).
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 p-4 pb-28 sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="found-corporation-title"
    >
      <div className="flex w-full max-w-md max-h-[85dvh] flex-col overflow-hidden rounded-xl border border-card-border bg-card shadow-modal animate-in zoom-in-95 duration-200">
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <h2 id="found-corporation-title" className="text-xl font-bold text-foreground mb-1">
            Found a Corporation
          </h2>
          <p className="text-sm text-muted mb-4">
            A flat <span className="text-foreground font-semibold">{fmt(foundingFeeLocal)}</span>{" "}
            founding fee plus any extra treasury commitment is deducted from your personal funds.
            Headquarters will be set to your home state.
          </p>

          {foundError && (
            <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
              {foundError}
            </div>
          )}

          {onFoundingCooldown && (
            <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              You can found another corporation in {foundingCooldownTurnsRemaining} turns.
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Founding Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFoundingMode("private")}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    foundingMode === "private"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-card-border text-muted hover:bg-card-elevated"
                  }`}
                >
                  Private
                </button>
                <button
                  type="button"
                  onClick={() => setFoundingMode("public")}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    foundingMode === "public"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-card-border text-muted hover:bg-card-elevated"
                  }`}
                >
                  Public IPO
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted">
                {foundingMode === "private"
                  ? "You own 100% of shares. Treasury, income, and other financials are hidden from non-CEO viewers."
                  : "Issue shares to the public float. Your ownership is reduced but you keep majority control. The float's proceeds flow into the treasury as those shares are bought by investors, not at founding."}
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Corporation Name
              </label>
              <input
                type="text"
                value={foundName}
                onChange={(e) => setFoundName(e.target.value)}
                placeholder="e.g. Acme Industries"
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
                maxLength={60}
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Stock Ticker Symbol
              </label>
              <input
                type="text"
                value={tickerSymbol}
                onChange={(e) =>
                  setTickerSymbol(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))
                }
                placeholder="e.g. ACME"
                maxLength={5}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-mono uppercase tracking-wider focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
              />
              <p className="mt-1.5 text-xs text-muted">
                1–5 letters (A–Z). Shown on the stock exchange. Cannot be changed later.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Primary Sector
              </label>
              <div className="relative">
                <select
                  value={foundType}
                  onChange={(e) => setFoundType(e.target.value as CorporationType | "")}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none cursor-pointer appearance-none"
                >
                  <option value="" disabled>
                    Select sector…
                  </option>
                  {Object.entries(CORPORATION_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-2.5 pointer-events-none text-muted">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Sectors matching this type earn a +5% margin bonus; mismatched sectors take a −15%
                penalty.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Secondary Sector <span className="text-muted/60 normal-case">(optional)</span>
              </label>
              <div className="relative">
                <select
                  value={secondaryType}
                  onChange={(e) => setSecondaryType(e.target.value as CorporationType | "")}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none cursor-pointer appearance-none"
                >
                  <option value="">None</option>
                  {Object.entries(CORPORATION_TYPE_LABELS)
                    .filter(([key]) => key !== foundType)
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </select>
                <div className="absolute right-3 top-2.5 pointer-events-none text-muted">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Gives matching sectors a half-strength +2.5% bonus (instead of the −15% mismatch
                penalty). In exchange, the sprawl penalty doubles. Can be changed later, but that
                triggers a 48-turn cooldown and a 24-turn −10% margin penalty on every sector.
              </p>
              {secondaryMatchesPrimary && (
                <p className="mt-1.5 text-xs text-error">
                  Secondary sector must be different from the primary sector.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Starting Treasury
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-sm text-muted pointer-events-none">
                  {currencySymbol}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={Number.isFinite(treasuryLocalInput) ? treasuryLocalInput : ""}
                  onChange={(e) => {
                    // Player types LOCAL currency; the field stores it verbatim.
                    // Conversion to ₳ happens once, in the derived `startingCapital`.
                    const localVal = Number(e.target.value);
                    setTreasuryLocalInput(
                      Number.isFinite(localVal) ? Math.max(0, Math.floor(localVal)) : 0
                    );
                  }}
                  min={minCapitalLocal}
                  max={maxCapitalLocal}
                  step={treasuryStepLocal}
                  className="w-full rounded-lg border border-card-border bg-background pl-7 pr-3 py-2 text-sm focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all tabular-nums"
                />
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Cash seeded into the corporation&apos;s treasury at founding. Any amount above the{" "}
                {fmt(minCapitalLocal)} baseline is paid from your personal funds on top of the
                founding fee. Higher treasury means higher starting share price (treasury ÷{" "}
                {founderShares.toLocaleString("en-US")} founder shares). Range{" "}
                {fmt(minCapitalLocal)} – {fmt(maxCapitalLocal)}.
              </p>
              {capitalTooLow && (
                <p className="mt-1.5 text-xs text-error">
                  Minimum starting treasury is {fmt(minCapitalLocal)}.
                </p>
              )}
              {capitalTooHigh && (
                <p className="mt-1.5 text-xs text-error">
                  Maximum starting treasury is {fmt(maxCapitalLocal)}.
                </p>
              )}
            </div>

            {foundingMode === "public" && (
              <div>
                <div className="mb-3 rounded-lg border border-card-border bg-card-elevated p-3">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dualClass}
                      onChange={(e) => {
                        setDualClass(e.target.checked);
                        if (!e.target.checked && floatPct > IPO_MAX_FLOAT_PCT) {
                          setFloatPct(IPO_MAX_FLOAT_PCT);
                          setHighFloatAck(false);
                        }
                      }}
                      className="mt-0.5 accent-primary"
                    />
                    <span>
                      <span className="font-medium text-foreground">Dual-class supershares</span>
                      <span className="block text-xs text-muted mt-0.5">
                        Your founder shares each carry multiple votes, letting you float up to{" "}
                        {SUPERSHARE_IPO_MAX_FLOAT_PCT}% (instead of {IPO_MAX_FLOAT_PCT}%) while
                        keeping voting control. Economic ownership still drops with the float %.
                        Supershares convert to common stock when sold.
                      </span>
                    </span>
                  </label>
                  {dualClass && (
                    <div className="mt-3">
                      <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                        Votes per founder share ({superMultiplier}×)
                      </label>
                      <input
                        type="range"
                        min={SUPERSHARE_MIN_MULTIPLIER}
                        max={SUPERSHARE_MAX_MULTIPLIER}
                        step={1}
                        value={superMultiplier}
                        onChange={(e) => setSuperMultiplier(Number(e.target.value))}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-muted">
                        <span>{SUPERSHARE_MIN_MULTIPLIER}×</span>
                        <span>{SUPERSHARE_MAX_MULTIPLIER}×</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mb-1.5 flex items-end justify-between gap-3">
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted">
                    Public Float
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={IPO_MIN_FLOAT_PCT}
                      max={maxFloatPct}
                      step={1}
                      value={floatPct}
                      onChange={(e) => {
                        const next = clampFloatPct(Number(e.target.value));
                        setFloatPct(next);
                        if (next <= IPO_MAX_FLOAT_PCT) setHighFloatAck(false);
                      }}
                      className="w-16 rounded-md border border-card-border bg-background px-2 py-1 text-right text-sm tabular-nums focus:border-primary/60 focus:outline-none"
                      aria-label="Public float percent"
                    />
                    <span className="text-xs text-muted">%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={IPO_MIN_FLOAT_PCT}
                  max={maxFloatPct}
                  step={1}
                  value={floatPct}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setFloatPct(next);
                    if (next <= IPO_MAX_FLOAT_PCT) setHighFloatAck(false);
                  }}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted">
                  <span>{IPO_MIN_FLOAT_PCT}%</span>
                  <span>{maxFloatPct}%</span>
                </div>
                {requiresHighFloatAck && (
                  <label className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={highFloatAck}
                      onChange={(e) => setHighFloatAck(e.target.checked)}
                      className="mt-0.5 accent-primary"
                    />
                    <span className="text-foreground">
                      I understand I am floating <span className="font-semibold">{floatPct}%</span>{" "}
                      and will own only ~
                      <span className="font-semibold">
                        {ipoPreview?.founderOwnershipPctAfter.toFixed(1) ??
                          (100 - floatPct).toFixed(1)}
                        %
                      </span>{" "}
                      economically. Supershares preserve voting control, not ownership %.
                    </span>
                  </label>
                )}
                {ipoPreview && (
                  <div className="mt-3 rounded-lg border border-card-border bg-card-elevated p-3 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted">Founder ownership after IPO</span>
                      <span
                        className={`font-semibold tabular-nums ${
                          ipoPreview.founderOwnershipPctAfter < 50 ? "text-warning" : ""
                        }`}
                      >
                        {ipoPreview.founderOwnershipPctAfter.toFixed(1)}%
                      </span>
                    </div>
                    {dualClass && (
                      <div className="flex justify-between">
                        <span className="text-muted">Founder voting power after IPO</span>
                        <span className="font-semibold tabular-nums">
                          {(
                            ((founderShares * superMultiplier) /
                              (founderShares * superMultiplier + ipoPreview.newShares)) *
                            100
                          ).toFixed(1)}
                          %
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted">New shares issued</span>
                      <span className="font-semibold tabular-nums">
                        {ipoPreview.newShares.toLocaleString("en-US")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">IPO proceeds (as float sells)</span>
                      <span className="font-semibold tabular-nums">
                        {fmt(Math.round(ipoPreview.proceeds))}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-card-border pt-1 mt-1">
                      <span className="text-muted">Starting treasury</span>
                      <span className="font-bold text-foreground tabular-nums">
                        {fmt(treasuryLocal)}
                      </span>
                    </div>
                    <p className="pt-1 text-[11px] leading-snug text-muted">
                      Only your starting treasury is funded at founding. IPO proceeds arrive in the
                      treasury as the float is bought by investors.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-lg border border-card-border bg-card-elevated p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted">Founding fee (personal)</span>
                <span className="font-semibold tabular-nums">{fmt(foundingFeeLocal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Extra treasury (personal)</span>
                <span className="font-semibold tabular-nums">{fmt(extraCapital)}</span>
              </div>
              {confidencePremiumLocal > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Low-confidence premium (personal)</span>
                  <span className="font-semibold tabular-nums text-warning">
                    {fmt(confidencePremiumLocal)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-card-border pt-1 mt-1">
                <span className="text-muted">Total from your funds</span>
                <span className="font-bold text-foreground tabular-nums">
                  {fmt(totalPersonalCost)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Corporate treasury</span>
                <span className="font-semibold tabular-nums">{fmt(treasuryLocal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Starting share price</span>
                <span className="font-semibold tabular-nums">
                  {currencySymbol}
                  {initialSharePrice.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-end gap-3 border-t border-card-border px-6 py-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              setFoundError("");
            }}
            className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors hover:bg-card-elevated"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleFound}
            disabled={disabled}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-sm"
          >
            {founding ? "Founding..." : "Found Corporation"}
          </button>
        </div>
      </div>
    </div>
  );
}
