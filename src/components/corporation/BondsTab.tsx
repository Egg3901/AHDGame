"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { BondInfo, CorporationDetail, Financials } from "./CorporationPageTypes";
import BondHistoryPanel from "./bonds/BondHistoryPanel";

interface BondsTabProps {
  bondInfo: BondInfo | null;
  bondLoading: boolean;
  corpId: string;
  corporation: CorporationDetail;
  onRefresh: () => void;
  financials: Financials | null;
}

type BondsSubTab = "overview" | "history";

export default function BondsTab({
  bondInfo,
  bondLoading,
  corpId,
  corporation,
  onRefresh,
  financials,
}: BondsTabProps) {
  const { formatAmount, formatFull, toInternalFrom, formatAmountIn, displayCurrencyPreference } =
    useCurrency();
  // Corp-issued bonds + per-corp financials are in the corp's liquidCurrencyCode
  // post-v0.2.6. Normalize to ₳ + pass code so wallet-pref display governs.
  const liquidCode =
    (corporation.liquidCurrencyCode as
      import("@/lib/constants/currencies").CurrencyCode | undefined) ?? undefined;
  const fmtMoney = (val: number) => {
    const anchor = liquidCode ? toInternalFrom(val, liquidCode) : val;
    return formatAmount(anchor, liquidCode);
  };
  const router = useRouter();
  const [activeSubTab, setActiveSubTab] = useState<BondsSubTab>("overview");
  const [bondIssueFaceValue, setBondIssueFaceValue] = useState(0);
  const [bondIssueMaturity, setBondIssueMaturity] = useState(96);
  const [bondActionError, setBondActionError] = useState("");
  const [bondActionSuccess, setBondActionSuccess] = useState("");
  const [bondActionLoading, setBondActionLoading] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 rounded-lg bg-card-elevated p-1 w-fit border border-card-border">
        {[
          { key: "overview" as const, label: "Bond Overview" },
          { key: "history" as const, label: "Bond History" },
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveSubTab(key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeSubTab === key
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeSubTab === "history" &&
        // Single mount-gate on `bondInfo`: defers the panel's first fetch
        // until parent corp data is ready (avoids the null→data transition
        // that would cause a duplicate fetch). The panel's own internal
        // skeleton handles the bond-history fetch loading state — no
        // double-flash from a separate BondsTab skeleton wrapper.
        (bondInfo ? (
          <BondHistoryPanel corpId={corpId} refreshKey={bondInfo} />
        ) : !bondLoading ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="text-muted">Bond data not available.</p>
          </div>
        ) : null)}

      {activeSubTab === "overview" &&
        (bondLoading ? (
          <div className="rounded-xl border border-card-border bg-card p-6">
            <Skeleton className="h-8 w-32 mb-4" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : bondInfo ? (
          <>
            {bondInfo.imfFacility && (
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-5 space-y-3">
                <h2 className="text-lg font-bold text-foreground">IMF restructuring facility</h2>
                <p className="text-xs text-muted leading-relaxed">
                  This corporation&apos;s previous corporate bonds were retired and consolidated
                  into this IMF facility as part of the bailout. That is why the outstanding bond
                  list is empty. The debt is tracked here instead of as tradable bonds. New
                  corporate bonds cannot be issued until the IMF program ends.
                </p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div>
                    <dt className="text-[11px] text-muted uppercase tracking-wide">
                      Facility principal
                    </dt>
                    <dd className="font-semibold tabular-nums text-foreground">
                      {fmtMoney(bondInfo.imfFacility.principalOutstanding)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted uppercase tracking-wide">Annual rate</dt>
                    <dd className="font-semibold tabular-nums text-foreground">
                      {bondInfo.imfFacility.annualRatePercent.toFixed(2)}%
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted uppercase tracking-wide">
                      Turns until paid off
                    </dt>
                    <dd className="font-semibold tabular-nums text-foreground">
                      {bondInfo.imfFacility.amortizationTurnsRemaining}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted uppercase tracking-wide">
                      Income capture (max payment share)
                    </dt>
                    <dd className="font-semibold tabular-nums text-foreground">
                      {bondInfo.imfFacility.incomeCapturePercent}%
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {/* Issue Bond (CEO only; hidden during IMF — matches POST guard) */}
            {bondInfo.isCeo &&
              !bondInfo.imfFacility &&
              (() => {
                // Slider operates in ₳ anchor units — no conversion needed.
                const parsedFaceValue = bondIssueFaceValue;
                const isValidInput = !isNaN(parsedFaceValue) && parsedFaceValue >= 100_000;
                const couponRate =
                  bondInfo.creditRating.couponRatesByDuration?.[
                    bondIssueMaturity as 96 | 240 | 336
                  ] ?? bondInfo.creditRating.effectiveCouponRate;
                // Annual cost = rate% × face value; daily = annual / 2 (2 game-days per game-year)
                const annualCost = isValidInput ? (couponRate / 100) * parsedFaceValue : 0;
                const dailyCost = annualCost / 2;
                // Max issuable (total debt headroom) = 2× equity − existing debt, rounded to $1,000 units
                const maxIssuableDebt = bondInfo.creditDiagnostics
                  ? Math.max(
                      0,
                      Math.floor(
                        (bondInfo.creditDiagnostics.totalEquity * 2 - bondInfo.totalDebt) / 1_000
                      ) * 1_000
                    )
                  : null;
                // Per-issuance cap: 25% of annual revenue, floored at $100M
                const perIssuanceCap = bondInfo.maxPerIssuance ?? 100_000_000;

                const effectiveCap =
                  maxIssuableDebt !== null
                    ? Math.min(perIssuanceCap, maxIssuableDebt)
                    : perIssuanceCap;
                // Launch-window freeze: issuance is paused server-side until this
                // instant. Mirror it in the UI so the control reads as disabled
                // rather than erroring on submit.
                const issuanceFrozen =
                  !!bondInfo.issuanceFrozenUntil &&
                  Date.now() < new Date(bondInfo.issuanceFrozenUntil).getTime();
                // parsedFaceValue is ₳ — formatAmountIn takes anchor and formats in a specific currency.
                const nativeDisplay = liquidCode
                  ? formatAmountIn(parsedFaceValue, liquidCode)
                  : formatFull(parsedFaceValue);
                const userPrefDisplay = formatAmount(parsedFaceValue);
                const showParens =
                  !!liquidCode &&
                  displayCurrencyPreference !== "local" &&
                  nativeDisplay !== userPrefDisplay;

                return (
                  <div className="rounded-xl border border-card-border bg-card p-6">
                    <h2 className="text-lg font-bold text-foreground mb-1">Issue Bond</h2>
                    <p className="text-xs text-muted mb-3">
                      Issue corporate bonds to raise capital. Bonds pay a fixed coupon rate based on
                      your credit rating.
                      {bondInfo.cooldownTurnsRemaining > 0 && (
                        <span className="text-warning ml-1">
                          Cooldown: {bondInfo.cooldownTurnsRemaining} turns remaining.
                        </span>
                      )}
                      {issuanceFrozen && (
                        <span className="text-warning ml-1">
                          Bond issuance is paused for the opening of the world and will reopen
                          shortly.
                        </span>
                      )}
                    </p>

                    {/* Rate + capacity summary */}
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs mb-4 px-3 py-2.5 rounded-lg bg-background/60 border border-card-border">
                      <div>
                        <span className="text-muted">Rating </span>
                        <span
                          className="font-semibold text-foreground"
                          title={
                            !corporation.isPrivate &&
                            corporation.ceoCharacterId &&
                            corporation.shareholders.find(
                              (sh) => sh.characterId === corporation.ceoCharacterId
                            ) &&
                            corporation.totalShares > 0 &&
                            corporation.shareholders.find(
                              (sh) => sh.characterId === corporation.ceoCharacterId
                            )!.shares /
                              corporation.totalShares >
                              0.65
                              ? `CEO holds ${((corporation.shareholders.find((sh) => sh.characterId === corporation.ceoCharacterId)!.shares / corporation.totalShares) * 100).toFixed(1)}% of the shares. Holding more than 65% costs the company one credit rating grade.`
                              : undefined
                          }
                        >
                          {bondInfo.creditRating.rating}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted">Current rate </span>
                        <span className="font-semibold text-foreground">
                          {couponRate.toFixed(2)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-muted">Per-issuance cap </span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {formatFull(perIssuanceCap)}
                        </span>
                      </div>
                      {maxIssuableDebt !== null && (
                        <div>
                          <span className="text-muted">Debt headroom </span>
                          <span
                            className={`font-semibold tabular-nums ${maxIssuableDebt === 0 ? "text-error" : "text-foreground"}`}
                          >
                            {maxIssuableDebt === 0 ? "At debt limit" : formatFull(maxIssuableDebt)}
                          </span>
                        </div>
                      )}
                      {bondInfo.totalDebt > 0 && (
                        <div>
                          <span className="text-muted">Outstanding debt </span>
                          <span className="font-semibold text-foreground">
                            {fmtMoney(bondInfo.totalDebt)}
                          </span>
                        </div>
                      )}
                    </div>

                    {bondActionError && (
                      <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error mb-3">
                        {bondActionError}
                      </div>
                    )}
                    {bondActionSuccess && (
                      <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success mb-3">
                        {bondActionSuccess}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-4 items-end">
                      <div className="w-full sm:w-80">
                        <label className="block text-sm font-medium text-foreground mb-1">
                          Face Value
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={effectiveCap}
                          step={1000}
                          value={bondIssueFaceValue}
                          onChange={(e) => setBondIssueFaceValue(Number(e.target.value))}
                          disabled={
                            effectiveCap === 0 ||
                            bondInfo.cooldownTurnsRemaining > 0 ||
                            issuanceFrozen
                          }
                          className="w-full accent-primary disabled:opacity-40"
                        />
                        <div className="flex justify-between text-[10px] text-muted mb-1">
                          <span>0</span>
                          <span>
                            {liquidCode
                              ? formatAmountIn(effectiveCap, liquidCode)
                              : formatFull(effectiveCap)}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted">
                          {parsedFaceValue >= 100_000 ? (
                            <span className="text-foreground font-medium">
                              {nativeDisplay}
                              {showParens && (
                                <span className="text-muted font-normal ml-1">
                                  ({userPrefDisplay})
                                </span>
                              )}
                            </span>
                          ) : (
                            <>
                              Min {liquidCode ? formatAmountIn(100_000, liquidCode) : "$100,000"} ·{" "}
                              {liquidCode ? formatAmountIn(1_000, liquidCode) : "$1,000"} units
                            </>
                          )}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                          Maturity
                        </label>
                        <select
                          value={bondIssueMaturity}
                          onChange={(e) => setBondIssueMaturity(Number(e.target.value))}
                          className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
                        >
                          <option value={96}>
                            2 Years ·{" "}
                            {(
                              bondInfo.creditRating.couponRatesByDuration?.[96] ??
                              bondInfo.creditRating.effectiveCouponRate
                            ).toFixed(2)}
                            %
                          </option>
                          <option value={240}>
                            5 Years ·{" "}
                            {(
                              bondInfo.creditRating.couponRatesByDuration?.[240] ??
                              bondInfo.creditRating.effectiveCouponRate
                            ).toFixed(2)}
                            %
                          </option>
                          <option value={336}>
                            7 Years ·{" "}
                            {(
                              bondInfo.creditRating.couponRatesByDuration?.[336] ??
                              bondInfo.creditRating.effectiveCouponRate
                            ).toFixed(2)}
                            %
                          </option>
                        </select>
                      </div>
                      <button
                        onClick={async () => {
                          setBondActionError("");
                          setBondActionSuccess("");
                          setBondActionLoading(true);
                          try {
                            const rawFv = bondIssueFaceValue;
                            const res = await fetch(`/api/corporations/${corpId}/bonds`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                faceValue: rawFv,
                                maturityTurns: bondIssueMaturity,
                              }),
                            });
                            const data = await res.json();
                            if (res.ok) {
                              setBondActionSuccess(
                                `Bond issued: ${fmtMoney(data.faceValue)} at ${data.couponRate}% coupon`
                              );
                              setBondIssueFaceValue(0);
                              onRefresh();
                            } else {
                              setBondActionError(data.error || "Failed to issue bond");
                            }
                          } catch {
                            setBondActionError("Network error");
                          } finally {
                            setBondActionLoading(false);
                          }
                        }}
                        disabled={
                          bondActionLoading || bondInfo.cooldownTurnsRemaining > 0 || issuanceFrozen
                        }
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {bondActionLoading ? "Issuing..." : "Issue Bond"}
                      </button>
                    </div>

                    {/* Live impact preview */}
                    {isValidInput && (
                      <div className="mt-4 rounded-lg border border-card-border bg-background/60 p-4">
                        <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3">
                          Projected Impact
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                          <div>
                            <div className="text-[11px] text-muted mb-0.5">Daily interest cost</div>
                            <div className="font-semibold text-error tabular-nums">
                              ({formatAmount(Math.round(dailyCost))})
                            </div>
                            <div className="text-[10px] text-muted mt-0.5">
                              {formatAmount(Math.round(annualCost))}/yr
                            </div>
                          </div>
                          {financials &&
                            (() => {
                              // income/dividendDistribution are in local currency; normalise to ₳
                              // so we can subtract dailyCost (which is in ₳ anchor).
                              const retainedLocal =
                                financials.income - financials.dividendDistribution;
                              const retainedAnchor = liquidCode
                                ? toInternalFrom(retainedLocal, liquidCode)
                                : retainedLocal;
                              return (
                                <>
                                  <div>
                                    <div className="text-[11px] text-muted mb-0.5">
                                      Income before
                                    </div>
                                    <div
                                      className={`font-semibold tabular-nums ${retainedAnchor >= 0 ? "text-success" : "text-error"}`}
                                    >
                                      {formatAmount(retainedAnchor)}/day
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[11px] text-muted mb-0.5">
                                      Income after
                                    </div>
                                    <div
                                      className={`font-semibold tabular-nums ${retainedAnchor - dailyCost >= 0 ? "text-success" : "text-error"}`}
                                    >
                                      {formatAmount(Math.round(retainedAnchor - dailyCost))}/day
                                    </div>
                                  </div>
                                </>
                              );
                            })()}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

            {/* Outstanding Bonds */}
            <div className="rounded-xl border border-card-border bg-card overflow-hidden">
              <div className="p-6 pb-0">
                <h2 className="text-lg font-bold text-foreground mb-1">Outstanding Bonds</h2>
                <p className="text-xs text-muted mb-4">
                  Tradable corporate bonds issued by this corporation. Each unit has a $1,000 face
                  value.
                  {bondInfo.imfFacility && (
                    <span className="block mt-1 text-foreground/90">
                      IMF facility debt is shown above, not in this table.
                    </span>
                  )}
                </p>
              </div>
              {bondInfo.bonds.length === 0 ? (
                <div className="p-6 pt-0 text-center space-y-2">
                  {bondInfo.imfFacility ? (
                    <>
                      <p className="text-foreground text-sm font-medium">
                        No tradable bonds on issue
                      </p>
                      <p className="text-muted text-xs max-w-md mx-auto">
                        Outstanding debt from the old bond issues is now the IMF facility (see
                        above). New tradable bonds may appear here if the company issues them later;
                        the facility is separate from this table.
                      </p>
                    </>
                  ) : (
                    <p className="text-muted text-sm">No bonds issued yet.</p>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-card-border text-left text-xs uppercase tracking-wider text-muted">
                        <th className="px-6 py-3 font-semibold">Coupon</th>
                        <th className="px-4 py-3 font-semibold text-right">Face Value</th>
                        <th className="px-4 py-3 font-semibold text-right">Mkt Price</th>
                        <th className="px-4 py-3 font-semibold text-right">Maturity</th>
                        <th className="px-4 py-3 font-semibold text-right">Available</th>
                        <th className="px-4 py-3 font-semibold text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-card-border">
                      {bondInfo.bonds.map((bond) => (
                        <tr
                          key={bond._id}
                          className="hover:bg-background/40 transition-colors cursor-pointer"
                          onClick={() => router.push(`/bond/${bond._id}`)}
                        >
                          <td className="px-6 py-3 font-medium tabular-nums">
                            {bond.couponRate.toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {fmtMoney(bond.totalIssued)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span
                              className={
                                bond.marketPrice > 1
                                  ? "text-success"
                                  : bond.marketPrice < 0.95
                                    ? "text-error"
                                    : "text-foreground"
                              }
                            >
                              {(bond.marketPrice * 100).toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {bond.matured
                              ? "Matured"
                              : bond.defaulted
                                ? "Default"
                                : `${bond.turnsRemaining} turns`}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {bond.publicFloat.toLocaleString("en-US")} units
                          </td>
                          <td className="px-4 py-3 text-center">
                            {bond.matured && bond.defaultCure && bond.defaultedAtTurn != null ? (
                              <span
                                className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-warning"
                                title={`Defaulted on turn ${bond.defaultedAtTurn}, cured on turn ${bond.defaultCure.curedAtTurn} via ${bond.defaultCure.cureMethod.replace("_", " ")}`}
                              >
                                Default cured
                              </span>
                            ) : bond.matured && bond.defaultCure?.cureMethod === "parent_payoff" ? (
                              <span
                                className="rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-secondary"
                                title={`Settled by parent corporation on turn ${bond.defaultCure.curedAtTurn}`}
                              >
                                Parent paid off
                              </span>
                            ) : bond.matured ? (
                              <span className="rounded-full bg-muted/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">
                                Matured
                              </span>
                            ) : bond.defaulted ? (
                              <span className="rounded-full bg-error/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-error">
                                Default
                              </span>
                            ) : (
                              <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-success">
                                Active
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="text-muted">Bond data not available.</p>
          </div>
        ))}
    </div>
  );
}
