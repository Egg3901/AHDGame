"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { bondIssueIncomePreview } from "@/lib/bonds/bondIssueIncomePreview";
import { BOND_DEFAULT_CREDIT_PENALTY_TURNS } from "@/lib/constants/bonds";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BondData, BondInfo, CorporationDetail, Financials } from "./CorporationPageTypes";
import BondHistoryPanel from "./bonds/BondHistoryPanel";
import {
  DenseSection,
  InlineStatus,
  KVList,
  KVRow,
  Segmented,
  SmallButton,
  TableScroll,
  Td,
  Th,
} from "./dense/DenseKit";
import { corpIncomeBasis } from "./financials/financialsModel";

interface BondsTabProps {
  bondInfo: BondInfo | null;
  bondLoading: boolean;
  corpId: string;
  corporation: CorporationDetail;
  onRefresh: () => void;
  financials: Financials | null;
}

type BondsSubTab = "overview" | "history";

const MATURITIES = [
  { turns: 96, label: "2 years" },
  { turns: 240, label: "5 years" },
  { turns: 336, label: "7 years" },
] as const;

function BondStatus({ bond }: { bond: BondData }) {
  if (bond.matured && bond.defaultCure && bond.defaultedAtTurn != null) {
    return (
      <span
        className="text-warning"
        title={`Defaulted on turn ${bond.defaultedAtTurn}, cured on turn ${bond.defaultCure.curedAtTurn} via ${bond.defaultCure.cureMethod.replace("_", " ")}`}
      >
        Default cured
      </span>
    );
  }
  if (bond.matured && bond.defaultCure?.cureMethod === "parent_payoff") {
    return (
      <span
        className="text-muted"
        title={`Settled by parent corporation on turn ${bond.defaultCure.curedAtTurn}`}
      >
        Parent paid off
      </span>
    );
  }
  if (bond.matured) return <span className="text-muted">Matured</span>;
  if (bond.defaulted) return <span className="font-medium text-error">Default</span>;
  return <span className="text-foreground">Active</span>;
}

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
  const liquidCode = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
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
  // Clock for the launch-window freeze, advanced once when the freeze lifts so
  // the controls unlock without a reload.
  const [now, setNow] = useState(() => Date.now());
  const frozenUntilMs = bondInfo?.issuanceFrozenUntil
    ? new Date(bondInfo.issuanceFrozenUntil).getTime()
    : null;
  useEffect(() => {
    if (frozenUntilMs == null) return;
    const wait = frozenUntilMs - Date.now();
    if (!(wait > 0)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(wait + 250, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [frozenUntilMs]);

  async function issueBond() {
    setBondActionError("");
    setBondActionSuccess("");
    setBondActionLoading(true);
    try {
      const res = await fetch(`/api/corporations/${corpId}/bonds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          faceValue: bondIssueFaceValue,
          maturityTurns: bondIssueMaturity,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBondActionSuccess(
          typeof data.unitsUnsold === "number" && data.unitsUnsold > 0
            ? `Bond issued: ${fmtMoney(data.faceValue)} at ${data.couponRate}% coupon. The market took ${Math.round((data.fillRatio ?? 0) * 100)}% up front; ${data.unitsUnsold.toLocaleString("en-US")} units are still placing and will fund as they sell.`
            : `Bond issued: ${fmtMoney(data.faceValue)} at ${data.couponRate}% coupon`
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
  }

  const viewToggle = (
    <Segmented
      ariaLabel="Bonds view"
      options={[
        { value: "overview", label: "Bonds" },
        { value: "history", label: "Bond history" },
      ]}
      value={activeSubTab}
      onChange={setActiveSubTab}
    />
  );

  if (activeSubTab === "history") {
    return (
      <div className="space-y-4">
        {viewToggle}
        {/* Single mount-gate on `bondInfo`: defers the panel's first fetch
            until parent corp data is ready (avoids the null→data transition
            that would cause a duplicate fetch). The panel's own internal
            skeleton handles the bond-history fetch loading state, so there
            is no double flash from a separate BondsTab skeleton. */}
        {bondInfo ? (
          <BondHistoryPanel corpId={corpId} refreshKey={bondInfo} />
        ) : !bondLoading ? (
          <p className="py-2 text-xs text-muted">Bond data not available.</p>
        ) : null}
      </div>
    );
  }

  if (bondLoading) {
    return (
      <div className="space-y-4">
        {viewToggle}
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!bondInfo) {
    return (
      <div className="space-y-4">
        {viewToggle}
        <p className="py-2 text-xs text-muted">Bond data not available.</p>
      </div>
    );
  }

  const ceoShares = corporation.ceoCharacterId
    ? (corporation.shareholders.find((sh) => sh.characterId === corporation.ceoCharacterId)
        ?.shares ?? 0)
    : 0;
  const ceoStake =
    !corporation.isPrivate && corporation.totalShares > 0 ? ceoShares / corporation.totalShares : 0;
  const ratingTitle =
    ceoStake > 0.65
      ? `CEO holds ${(ceoStake * 100).toFixed(1)}% of the shares. Holding more than 65% costs the company one credit rating grade.`
      : undefined;

  const couponFor = (turns: number) =>
    bondInfo.creditRating.couponRatesByDuration?.[turns as 96 | 240 | 336] ??
    bondInfo.creditRating.effectiveCouponRate;

  return (
    <div className="space-y-6">
      {viewToggle}

      {bondInfo.imfFacility && (
        <DenseSection title="IMF restructuring facility" meta="replaces the retired bonds">
          <p className="py-1 text-xs text-muted">
            This corporation&apos;s previous corporate bonds were retired and consolidated into this
            IMF facility as part of the bailout, so the debt is tracked here instead of as tradable
            bonds. New corporate bonds cannot be issued until the IMF program ends.
          </p>
          <KVList className="grid gap-x-8 sm:grid-cols-2">
            <KVRow
              label="Facility principal"
              value={fmtMoney(bondInfo.imfFacility.principalOutstanding)}
            />
            <KVRow
              label="Annual rate"
              value={`${bondInfo.imfFacility.annualRatePercent.toFixed(2)}%`}
            />
            <KVRow
              label="Turns until paid off"
              value={bondInfo.imfFacility.amortizationTurnsRemaining}
            />
            <KVRow
              label="Income capture (max payment share)"
              value={`${bondInfo.imfFacility.incomeCapturePercent}%`}
            />
          </KVList>
        </DenseSection>
      )}

      {/* Issue bonds (CEO only; hidden during IMF, which matches the POST guard) */}
      {bondInfo.isCeo &&
        !bondInfo.imfFacility &&
        (() => {
          // Slider operates in ₳ anchor units, so no conversion is needed.
          const parsedFaceValue = bondIssueFaceValue;
          // Minimum is clamped server-side to the corp's own ceiling, so a
          // small corp can issue below ₳100,000 (ticket #1083).
          const isValidInput =
            !isNaN(parsedFaceValue) && parsedFaceValue >= (bondInfo.minIssuance ?? 100_000);
          const couponRate = couponFor(bondIssueMaturity);
          // Debt headroom and the issuance ceiling both come from the
          // server, which is the only place all three rules live
          // (per-issuance cap, 2x going-concern equity, 1x exit equity).
          // Re-deriving one of them here is what let the quoted ceiling
          // drift from the enforced one in ticket #1198. The local
          // fallbacks only cover a response from an older deploy.
          const toBondUnits = (v: number) => Math.max(0, Math.floor(v / 1_000) * 1_000);
          const maxIssuableDebt =
            bondInfo.debtHeadroom !== undefined
              ? toBondUnits(bondInfo.debtHeadroom)
              : bondInfo.creditDiagnostics
                ? toBondUnits(bondInfo.creditDiagnostics.totalEquity * 2 - bondInfo.totalDebt)
                : null;
          // Per-issuance cap: 25% of annual revenue, floored at $100M
          const perIssuanceCap = bondInfo.maxPerIssuance ?? 100_000_000;

          // NOT floored to bond units: the server guarantees
          // `minIssuance <= maxAllowedIssuance`, and flooring the ceiling
          // alone can push it under the minimum for a corp whose headroom
          // sits between the dust floor and the flat minimum, leaving it
          // with no legal issuance at all. The slider still steps in
          // A1,000 units; only its endpoint is exact.
          const effectiveCap =
            bondInfo.maxAllowedIssuance !== undefined
              ? Math.max(0, bondInfo.maxAllowedIssuance)
              : maxIssuableDebt !== null
                ? Math.min(perIssuanceCap, maxIssuableDebt)
                : perIssuanceCap;
          const limitedByExitEquity = bondInfo.issuanceLimitedBy === "exitEquity";
          // Minimum is clamped to the corp's own ceiling server-side, so a
          // small corp can issue below ₳100,000 rather than being locked out
          // (ticket #1083). `bondsAvailable` is false below the dust floor.
          const effectiveMin = bondInfo.minIssuance ?? 100_000;
          const bondsUnavailable = bondInfo.bondsAvailable === false;
          // Launch-window freeze: issuance is paused server-side until this
          // instant. Mirror it in the UI so the control reads as disabled
          // rather than erroring on submit.
          const issuanceFrozen = frozenUntilMs != null && now < frozenUntilMs;
          const cooldown = bondInfo.cooldownTurnsRemaining;
          // parsedFaceValue is ₳; formatAmountIn takes anchor and formats in a specific currency.
          const inLiquid = (anchor: number) =>
            liquidCode ? formatAmountIn(anchor, liquidCode) : formatFull(anchor);
          const nativeDisplay = inLiquid(parsedFaceValue);
          const userPrefDisplay = formatAmount(parsedFaceValue);
          const showParens =
            !!liquidCode &&
            displayCurrencyPreference !== "local" &&
            nativeDisplay !== userPrefDisplay;
          const sliderDisabled =
            effectiveCap === 0 || bondsUnavailable || cooldown > 0 || issuanceFrozen;

          const preview = isValidInput
            ? (() => {
                const retainedLocal = financials ? corpIncomeBasis(financials).retained : 0;
                const retainedAnchor = financials
                  ? liquidCode
                    ? toInternalFrom(retainedLocal, liquidCode)
                    : retainedLocal
                  : 0;
                return bondIssueIncomePreview({
                  retainedDaily: retainedAnchor,
                  couponRatePercent: couponRate,
                  faceValue: parsedFaceValue,
                });
              })()
            : null;

          return (
            <DenseSection
              title="Issue bonds"
              meta={
                cooldown > 0
                  ? `cooldown, ${cooldown} turns left`
                  : issuanceFrozen
                    ? "paused for the world opening"
                    : "CEO"
              }
            >
              <div className="grid gap-x-8 gap-y-4 pt-1 md:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-3">
                  <p className="text-xs text-muted">
                    You receive the full face value in cash now and pay a fixed coupon every turn,
                    set by your credit rating. The full face value then comes back out of liquid
                    capital in a single payment on the maturity turn, not gradually. Coupons and
                    that repayment are charged on every unit issued, including units that never
                    sell.
                  </p>
                  {/* The default trigger is the one thing the issue flow never
                      said out loud. `bondTurn` folds the maturity debit into
                      the same negative-liquid-capital test as the coupon, so a
                      repayment a CEO has not saved for is itself the default. */}
                  <p className="text-xs text-foreground">
                    <span className="font-semibold text-warning">
                      Keep liquid capital positive.
                    </span>{" "}
                    If a coupon or a maturity repayment drives liquid capital below zero and this
                    corporation cannot cover its debt from what it could realize by selling up, the
                    bond defaults. Holders are marked down to $0.10 on the dollar, and the credit
                    score is pinned to CCC for {BOND_DEFAULT_CREDIT_PENALTY_TURNS} turns.
                  </p>
                  {cooldown > 0 && (
                    <p className="text-xs text-warning">
                      Cooldown: {cooldown} turns remaining before the next issue.
                    </p>
                  )}
                  {issuanceFrozen && (
                    <p className="text-xs text-warning">
                      Bond issuance is paused for the opening of the world and will reopen shortly.
                    </p>
                  )}

                  <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                    <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1 text-xs text-muted">
                      <span className="flex items-baseline justify-between gap-2">
                        <span>Face value</span>
                        <span className="font-mono text-[13px] font-medium tabular-nums text-foreground">
                          {nativeDisplay}
                          {showParens && (
                            <span className="ml-1 font-normal text-muted">({userPrefDisplay})</span>
                          )}
                        </span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={effectiveCap}
                        step={1000}
                        value={bondIssueFaceValue}
                        onChange={(e) => setBondIssueFaceValue(Number(e.target.value))}
                        disabled={sliderDisabled}
                        className="w-full accent-primary disabled:opacity-40"
                      />
                      <span className="flex justify-between font-mono text-[11px] tabular-nums">
                        <span>0</span>
                        <span>{inLiquid(effectiveCap)}</span>
                      </span>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Maturity
                      <select
                        value={bondIssueMaturity}
                        onChange={(e) => setBondIssueMaturity(Number(e.target.value))}
                        className="h-7 rounded-md border border-card-border bg-background px-2 text-xs text-foreground focus:border-foreground focus:outline-none"
                      >
                        {MATURITIES.map((m) => (
                          <option key={m.turns} value={m.turns}>
                            {m.label}, {couponFor(m.turns).toFixed(2)}%
                          </option>
                        ))}
                      </select>
                    </label>
                    <SmallButton
                      tone="primary"
                      onClick={() => void issueBond()}
                      disabled={bondActionLoading || cooldown > 0 || issuanceFrozen}
                    >
                      {bondActionLoading ? "Issuing..." : "Issue bonds"}
                    </SmallButton>
                  </div>

                  {bondsUnavailable ? (
                    <p className="text-xs text-error">
                      {limitedByExitEquity
                        ? "No borrowing capacity yet. Build capacity this corporation could sell."
                        : "Too small to issue bonds yet. Build more equity headroom."}
                    </p>
                  ) : parsedFaceValue < effectiveMin ? (
                    <p className="text-xs text-muted">
                      Minimum{" "}
                      <span className="font-mono tabular-nums">
                        {liquidCode
                          ? formatAmountIn(effectiveMin, liquidCode)
                          : `$${effectiveMin.toLocaleString("en-US")}`}
                      </span>
                      , in units of{" "}
                      <span className="font-mono tabular-nums">
                        {liquidCode ? formatAmountIn(1_000, liquidCode) : "$1,000"}
                      </span>
                      .
                    </p>
                  ) : null}

                  <InlineStatus message={bondActionError} tone="error" />
                  <InlineStatus message={bondActionSuccess} tone="success" />
                </div>

                <div className="min-w-0 space-y-4">
                  <KVList>
                    <KVRow
                      label="Rating"
                      value={bondInfo.creditRating.rating}
                      title={ratingTitle}
                      hint={ratingTitle ? "CEO stake penalty" : undefined}
                    />
                    <KVRow
                      label={`Coupon, ${MATURITIES.find((m) => m.turns === bondIssueMaturity)?.label ?? `${bondIssueMaturity} turns`}`}
                      value={`${couponRate.toFixed(2)}%`}
                    />
                    <KVRow label="Per-issuance cap" value={formatFull(perIssuanceCap)} />
                    {maxIssuableDebt !== null && (
                      <KVRow
                        label="Debt headroom"
                        value={
                          maxIssuableDebt === 0 ? (
                            <span className="text-error">At debt limit</span>
                          ) : (
                            formatFull(maxIssuableDebt)
                          )
                        }
                      />
                    )}
                    {/* `totalDebt` arrives already normalized to ₳ by
                        sumBondPrincipalAnchor, so it takes formatFull
                        directly. Passing it through fmtMoney, which
                        assumes a corp-local figure, converted it a second
                        time and overstated the debt of every corp outside
                        the anchor currency. */}
                    {bondInfo.totalDebt > 0 && (
                      <KVRow label="Outstanding debt" value={formatFull(bondInfo.totalDebt)} />
                    )}
                  </KVList>

                  {limitedByExitEquity && bondInfo.exitEquity !== undefined && (
                    <p className="text-[11px] text-muted">
                      Your headroom is set by what this corporation could realize by selling up (
                      {formatFull(bondInfo.exitEquity)}), not by what it is worth as a going
                      concern. Debt beyond that could not be repaid out of assets, so it is not
                      offered. Building capacity, holding cash, or buying bonds all raise that
                      figure.
                    </p>
                  )}

                  {/* Live impact preview (realized retained vs new coupon,
                      ticket #1109). The principal line is the number the
                      coupon row does not contain: face value is repaid whole
                      on a single turn, so showing only interest priced the
                      cheap half of the debt and hid the expensive half. */}
                  {preview && (
                    <div>
                      <h3 className="border-b border-card-border pb-1 text-xs font-medium text-muted">
                        If issued
                      </h3>
                      <KVList>
                        <KVRow
                          label="Coupon cost per day"
                          value={
                            <span className="text-error">
                              ({formatAmount(Math.round(preview.dailyCost))})
                            </span>
                          }
                          hint={`${formatAmount(Math.round(preview.annualCost))}/yr`}
                        />
                        {financials && (
                          <>
                            <KVRow
                              label="Income per turn, before"
                              value={
                                <span
                                  className={
                                    preview.incomeBeforePerTurn >= 0 ? "text-success" : "text-error"
                                  }
                                >
                                  {formatAmount(Math.round(preview.incomeBeforePerTurn))}
                                </span>
                              }
                            />
                            <KVRow
                              label="Income per turn, after"
                              value={
                                <span
                                  className={
                                    preview.staysProfitable ? "text-success" : "text-error"
                                  }
                                >
                                  {formatAmount(Math.round(preview.incomeAfterPerTurn))}
                                </span>
                              }
                            />
                          </>
                        )}
                        <KVRow
                          label="Principal due at maturity"
                          value={
                            <span className="text-error">({formatAmount(parsedFaceValue)})</span>
                          }
                          hint="one payment"
                        />
                        <KVRow
                          label="Repaid on"
                          value={`Turn ${(bondInfo.currentTurn + bondIssueMaturity).toLocaleString("en-US")}`}
                          hint={`in ${bondIssueMaturity} turns`}
                        />
                      </KVList>
                    </div>
                  )}
                </div>
              </div>
            </DenseSection>
          );
        })()}

      <DenseSection
        title="Outstanding bonds"
        meta={
          bondInfo.bonds.length > 0
            ? `${bondInfo.bonds.length} ${bondInfo.bonds.length === 1 ? "issue" : "issues"}`
            : undefined
        }
      >
        <p className="py-1 text-xs text-muted">
          Tradable corporate bonds issued by this corporation. Each unit has a $1,000 face value,
          and the face value below is repaid in full on the maturity turn, out of liquid capital, in
          one payment.
          {bondInfo.imfFacility && " IMF facility debt is shown above, not in this table."}
        </p>
        {bondInfo.bonds.length === 0 ? (
          bondInfo.imfFacility ? (
            <p className="py-2 text-xs text-muted">
              No tradable bonds on issue. Outstanding debt from the old bond issues is now the IMF
              facility. New tradable bonds may appear here if the company issues them later; the
              facility is separate from this table.
            </p>
          ) : (
            <p className="py-2 text-xs text-muted">No bonds issued yet.</p>
          )
        ) : (
          <TableScroll>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Coupon</Th>
                  <Th align="right">Face value</Th>
                  <Th align="right" title="Market price as a share of face value">
                    Price
                  </Th>
                  <Th align="right">Maturity</Th>
                  <Th align="right" title="Units available to buy">
                    Float
                  </Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {bondInfo.bonds.map((bond) => {
                  const href = `/bond/${bond._id}`;
                  return (
                    <tr
                      key={bond._id}
                      className="cursor-pointer hover:bg-card-elevated/50"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a")) return;
                        router.push(href);
                      }}
                    >
                      <Td className="font-mono">
                        <Link href={href} className="text-foreground hover:underline">
                          {bond.couponRate.toFixed(2)}%
                        </Link>
                      </Td>
                      {/* Formatted in the BOND's currency, not the corp's.
                          A relocation re-denominates the corporation and
                          leaves its outstanding bonds where they were, so
                          `fmtMoney` (which assumes the corp's code) labelled
                          a pre-move bond with a currency it is not in. */}
                      <Td align="right">
                        {bond.totalIssuedAnchor !== undefined
                          ? formatAmount(
                              bond.totalIssuedAnchor,
                              bond.currencyCode as CurrencyCode | undefined
                            )
                          : fmtMoney(bond.totalIssued)}
                      </Td>
                      <Td
                        align="right"
                        className={
                          bond.marketPrice > 1
                            ? "text-success"
                            : bond.marketPrice < 0.95
                              ? "text-error"
                              : "text-foreground"
                        }
                      >
                        {(bond.marketPrice * 100).toFixed(2)}%
                      </Td>
                      <Td align="right">
                        {bond.matured
                          ? "Matured"
                          : bond.defaulted
                            ? "Default"
                            : `${bond.turnsRemaining} turns`}
                      </Td>
                      <Td align="right">{bond.publicFloat.toLocaleString("en-US")}</Td>
                      <Td>
                        <BondStatus bond={bond} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </DenseSection>
    </div>
  );
}
