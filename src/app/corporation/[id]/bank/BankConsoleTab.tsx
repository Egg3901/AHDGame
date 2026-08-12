"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import Link from "next/link";
import { Badge, Button, EmptyState, Input, Skeleton, Slider } from "@/components/ui";
import { useDebounce } from "@/hooks/useDebounce";
import { useToast } from "@/contexts/ToastContext";
import { WarningBandBadge } from "@/components/banking/WarningBandBadge";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import type { BankCharterType } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { assessCapital, capitalShortfall } from "@/lib/banking/capitalAdequacy";

type Corridor = { minOffset: number; maxOffset: number };

/** A named counterparty, resolved server-side. Never a bare ObjectId in the UI. */
type Party = {
  id: string;
  name: string;
  sequentialId: number | null;
  ticker?: string | null;
};

type ConsolePayload = {
  privateBankingEnabled: boolean;
  bankPropTradingEnabled: boolean;
  visible: boolean;
  isCeo: boolean;
  isAdmin: boolean;
  isChair: boolean;
  canMutate: boolean;
  canRevoke: boolean;
  corporation: {
    id: string;
    name: string;
    liquidCapital: number;
    liquidCurrencyCode: string;
    countryId?: string;
    ownsFinancial: boolean;
  };
  currency: CurrencyCode;
  legalCharterTypes: BankCharterType[];
  eligibleTypes: BankCharterType[];
  eligibilityReasons: string[];
  capitalRequirement: number;
  corridors: { deposit: Corridor; lending: Corridor } | null;
  reserveRatio: number | null;
  depositCeiling: number | null;
  defaultBranchCapacityShare: number;
  /** Catalog for the blacklist fund picker. Absent for viewers who cannot edit. */
  blacklistableFunds?: { slug: string; name: string }[];
  charter: {
    type: BankCharterType;
    status: string;
    currency: CurrencyCode;
    charteredTurn: number;
    postedCapital: number;
    depositOffset: number;
    lendingOffset: number;
    totalDeposits: number;
    totalLoans: number;
    npcDeposits: number;
    reserves: number;
    confidence: number | null;
    warningBand: "green" | "amber" | "red" | null;
    panicTurns: number;
    branchCapacityShare: number;
    depositCeiling: number;
    interbankDebt: number;
    cbMarginDebt: number;
    propBookMarkValue: number;
    propBook: Array<{
      asset: string;
      ref: string;
      units: number;
      costBasis: number;
      markValue: number | null;
    }>;
    /** Null for viewers who are not the CEO, an admin, or the currency's chair. */
    blacklist: {
      corporations: Party[];
      characters: Party[];
      indexFunds: { slug: string; name: string }[];
    } | null;
  } | null;
  rates: { depositRatePercent: number; lendingRatePercent: number } | null;
  loans: Array<{
    id: string;
    borrowerType: string;
    borrower: Party | null;
    principal: number;
    outstanding: number;
    ratePercent: number;
    originatedTurn: number;
    termTurns: number;
    status: string;
    arrearsTurns: number;
  }>;
  interbankLoans: Array<{
    id: string;
    lenderCorporationId: string;
    borrowerCorporationId: string;
    counterparty: Party | null;
    principal: number;
    outstanding: number;
    ratePercent: number;
    originatedTurn: number;
    status: string;
    role: "lender" | "borrower";
  }>;
};

function charterLabel(type: BankCharterType): string {
  if (type === "retail") return "Retail";
  if (type === "investment") return "Investment";
  return "Universal";
}

interface Props {
  corporationId: string;
  isCeo: boolean;
}

function mergeState<State>(state: State, patch: Partial<State>): State {
  return { ...state, ...patch };
}

/** Link to a party's public page, by sequentialId when it has one. */
function partyHref(kind: "character" | "corporation", party: Party): string {
  const seg = party.sequentialId ?? party.id;
  return kind === "character" ? `/character/${seg}` : `/corporation/${seg}`;
}

/**
 * Name search that yields a {@link Party}. The blacklist editor previously
 * asked the CEO to type 24-character Mongo ids, which no player can obtain
 * through the game, and rendered saved entries as raw hex.
 */
function PartySearch({
  kind,
  excludeIds,
  onPick,
  disabled,
}: {
  kind: "character" | "corporation";
  excludeIds: string[];
  onPick: (party: Party) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  // Results are stamped with the term that produced them, so "is this stale"
  // and "are we still searching" are derived rather than tracked in their own
  // state. Setting state synchronously in the effect would cascade renders.
  const [answered, setAnswered] = useState<{ term: string; results: Party[] }>({
    term: "",
    results: [],
  });
  const debounced = useDebounce(query, 300);
  const term = debounced.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let cancelled = false;
    const url =
      kind === "character"
        ? `/api/characters/search?limit=8&q=${encodeURIComponent(term)}`
        : `/api/corporations/search?limit=8&q=${encodeURIComponent(term)}`;
    fetch(url)
      .then((res) => (res.ok ? res.json() : { results: [] }))
      .then((json: { results?: Party[] }) => {
        if (!cancelled) setAnswered({ term, results: json.results ?? [] });
      })
      .catch(() => {
        if (!cancelled) setAnswered({ term, results: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [term, kind]);

  const searching = term.length >= 2 && answered.term !== term;
  const visible =
    answered.term === term ? answered.results.filter((r) => !excludeIds.includes(r.id)) : [];

  return (
    <div className="space-y-1">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        placeholder={kind === "character" ? "Search players by name" : "Search companies by name"}
        aria-label={kind === "character" ? "Search players" : "Search companies"}
      />
      {query.trim().length >= 2 && (
        <div className="rounded-lg border border-card-border bg-card-elevated divide-y divide-card-border">
          {searching && visible.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">Searching...</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No match.</p>
          ) : (
            visible.map((party) => (
              <button
                key={party.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onPick(party);
                  setQuery("");
                  setAnswered({ term: "", results: [] });
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-card disabled:opacity-50"
              >
                <span className="truncate">{party.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {party.ticker ?? (party.sequentialId != null ? `#${party.sequentialId}` : "")}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** One removable entry on the blacklist. */
function BlacklistChip({
  label,
  href,
  onRemove,
  canMutate,
}: {
  label: string;
  href?: string;
  onRemove: () => void;
  canMutate: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-card-border bg-card-elevated py-1 pl-3 pr-1 text-sm">
      {href ? (
        <Link href={href} className="text-primary hover:opacity-80">
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      )}
      {canMutate && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-error/15 hover:text-error"
        >
          ×
        </button>
      )}
    </span>
  );
}

interface ConsoleLoadState {
  data: ConsolePayload | null;
  loading: boolean;
  error: string | null;
}

export function BankConsoleTab({ corporationId, isCeo }: Props) {
  const { showToast } = useToast();
  const [{ data, loading, error }, updateLoadState] = useReducer(mergeState<ConsoleLoadState>, {
    data: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    updateLoadState({ loading: true });
    try {
      const res = await fetch(`/api/banking/corporation/${corporationId}`);
      const json = (await res.json().catch(() => ({}))) as ConsolePayload & { error?: string };
      if (!res.ok) {
        updateLoadState({
          error: json.error ?? "Failed to load bank console",
          data: null,
        });
        return;
      }
      updateLoadState({ error: null, data: json });
    } catch {
      updateLoadState({ error: "Failed to load bank console", data: null });
    } finally {
      updateLoadState({ loading: false });
    }
  }, [corporationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return <EmptyState title="Bank console unavailable" description={error ?? undefined} />;
  }

  if (!data.visible) {
    return (
      <EmptyState
        title="No bank console"
        description="Own a financial sector to charter a bank, or open a corp that already holds a charter."
      />
    );
  }

  const canMutate = data.canMutate && isCeo;
  // Why the actions are off matters to the player. `canMutate` folds two very
  // different reasons together (not CEO / banking frozen), and the panels used
  // to blame the CEO check for both, telling a sitting CEO they were not the
  // CEO during a freeze.
  const blockReason = canMutate
    ? null
    : !isCeo || !data.isCeo
      ? "Only the CEO can issue a charter."
      : "Bank actions are paused while private banking is frozen.";

  return (
    <div className="space-y-8">
      {!data.privateBankingEnabled && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Private banking is frozen. You can view this console, but bank actions are disabled.
        </div>
      )}

      {data.charter ? (
        <ActiveCharterPanel
          data={data}
          canMutate={canMutate}
          onChanged={load}
          showToast={showToast}
        />
      ) : (
        <CharterIssueForm
          data={data}
          canMutate={canMutate}
          blockReason={blockReason}
          onChanged={load}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function CharterIssueForm({
  data,
  canMutate,
  blockReason,
  onChanged,
  showToast,
}: {
  data: ConsolePayload;
  canMutate: boolean;
  blockReason: string | null;
  onChanged: () => Promise<void>;
  showToast: (msg: string, variant?: "success" | "error" | "info") => void;
}) {
  const defaultType =
    data.eligibleTypes[0] ?? data.legalCharterTypes[0] ?? ("retail" as BankCharterType);
  const [{ type, busy }, updateCharterState] = useReducer(
    mergeState<{ type: BankCharterType; busy: boolean }>,
    { type: defaultType, busy: false }
  );

  const issue = async () => {
    updateCharterState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${data.corporation.id}/bank/charter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, currency: data.currency }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        reasons?: string[];
      };
      if (!res.ok) {
        showToast(json.reasons?.join("; ") ?? json.error ?? "Could not issue charter", "error");
        return;
      }
      showToast("Bank charter issued", "success");
      await onChanged();
    } finally {
      updateCharterState({ busy: false });
    }
  };

  const types = data.legalCharterTypes.length > 0 ? data.legalCharterTypes : [];

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-4 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Issue bank charter</h2>
        <p className="mt-1 text-sm text-muted">
          Posts {formatBankMoney(data.capitalRequirement, data.currency)} from the corporation
          treasury. Legal types follow this nation&apos;s banking separation law.
        </p>
      </div>
      {data.eligibilityReasons.length > 0 && data.eligibleTypes.length === 0 && (
        <ul className="list-disc pl-5 text-sm text-error space-y-1">
          {data.eligibilityReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {types.length === 0 ? (
        <p className="text-sm text-muted">
          No private bank charters are legal in this jurisdiction.
        </p>
      ) : (
        <label className="block space-y-1 text-xs text-muted">
          Charter type
          <select
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            value={type}
            onChange={(e) => updateCharterState({ type: e.target.value as BankCharterType })}
            disabled={!canMutate}
            aria-label="Charter type"
          >
            {types.map((t) => (
              <option key={t} value={t} disabled={!data.eligibleTypes.includes(t) && canMutate}>
                {charterLabel(t)}
                {!data.eligibleTypes.includes(t) ? " (not eligible)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-xs text-muted font-mono">
        Treasury {formatBankMoney(data.corporation.liquidCapital, data.currency)} · currency{" "}
        {data.currency}
      </p>
      {canMutate ? (
        <Button
          type="button"
          onClick={() => void issue()}
          disabled={busy || data.eligibleTypes.length === 0}
        >
          {busy ? "Issuing..." : "Issue charter"}
        </Button>
      ) : (
        <p className="text-sm text-muted">{blockReason}</p>
      )}
    </section>
  );
}

type BankTab = "overview" | "lending" | "funding" | "trading" | "admin";

/**
 * Plain-language read on the confidence band. The band alone is a colour with
 * no stated consequence, which is the thing a CEO actually needs to know.
 */
function bandMeaning(
  band: "green" | "amber" | "red" | null,
  panicTurns: number
): { tone: "success" | "warning" | "error" | "default"; headline: string; detail: string } {
  if (panicTurns > 0) {
    return {
      tone: "error",
      headline: "Depositors are running",
      detail: `A bank run is in its ${panicTurns === 1 ? "first" : `${panicTurns}th`} turn. Withdrawals are elevated and reserves drain fastest now. Raise the deposit rate, sell assets, or draw the discount window.`,
    };
  }
  if (band === "red") {
    return {
      tone: "error",
      headline: "Depositors are losing confidence",
      detail:
        "One more bad turn can start a run. Hold more reserves, cut risk, and consider a better deposit rate before it tips.",
    };
  }
  if (band === "amber") {
    return {
      tone: "warning",
      headline: "Confidence is slipping",
      detail:
        "Depositors are watching. Arrears in the loan book and a thin reserve buffer are the usual causes.",
    };
  }
  if (band === "green") {
    return {
      tone: "success",
      headline: "Depositors are comfortable",
      detail: "Nothing here needs attention today.",
    };
  }
  return {
    tone: "default",
    headline: "No confidence reading yet",
    detail: "A band appears once the bank has traded for a turn.",
  };
}

function HealthCard({ data }: { data: ConsolePayload }) {
  const charter = data.charter!;
  const capital = assessCapital({
    postedCapital: charter.postedCapital,
    liquidCapital: data.corporation.liquidCapital,
    totalLoans: charter.totalLoans,
    propBookMarkValue: charter.propBookMarkValue,
  });
  const shortfall = capitalShortfall(capital);
  const meaning = bandMeaning(charter.warningBand, charter.panicTurns);
  const requiredReserves =
    data.reserveRatio != null ? charter.totalDeposits * data.reserveRatio : null;
  const reserveGap = requiredReserves != null ? charter.reserves - requiredReserves : null;
  const arrears = data.loans.filter((l) => l.status === "arrears" || l.status === "defaulted");
  const arrearsValue = arrears.reduce((sum, l) => sum + l.outstanding, 0);

  const toneBorder =
    meaning.tone === "error"
      ? "border-error/40 bg-error/5"
      : meaning.tone === "warning"
        ? "border-warning/40 bg-warning/5"
        : meaning.tone === "success"
          ? "border-success/30 bg-success/5"
          : "border-card-border bg-card";

  return (
    <section className={`space-y-4 rounded-xl border p-5 ${toneBorder}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{meaning.headline}</h2>
            <WarningBandBadge band={charter.warningBand} confidence={charter.confidence} />
          </div>
          <p className="max-w-2xl text-sm text-muted">{meaning.detail}</p>
        </div>
        <Badge color="default" variant="subtle">
          {charterLabel(charter.type)} · {charter.currency}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <HealthStat
          label="Capital"
          value={
            capital.riskAssetsAnchor > 0 ? `${(capital.capitalRatio * 100).toFixed(1)}%` : "No risk"
          }
          tone={
            capital.standing === "undercapitalized"
              ? "error"
              : capital.standing === "stressed"
                ? "warning"
                : "success"
          }
          detail={
            capital.standing === "undercapitalized"
              ? `Post ${formatBankMoney(shortfall, charter.currency)} or lose the charter`
              : capital.standing === "stressed"
                ? "Survives today, fails the stress scenario"
                : "Above the minimum and the stress scenario"
          }
        />
        <HealthStat
          label="Reserves"
          value={formatBankMoney(charter.reserves, charter.currency)}
          tone={reserveGap == null ? "default" : reserveGap < 0 ? "error" : "success"}
          detail={
            requiredReserves == null
              ? "No reserve requirement"
              : reserveGap != null && reserveGap < 0
                ? `${formatBankMoney(Math.abs(reserveGap), charter.currency)} short of the requirement`
                : `${formatBankMoney(reserveGap ?? 0, charter.currency)} above the requirement`
          }
        />
        <HealthStat
          label="Bad loans"
          value={arrears.length === 0 ? "None" : String(arrears.length)}
          tone={arrears.length === 0 ? "success" : "warning"}
          detail={
            arrears.length === 0
              ? "Every named loan is current"
              : `${formatBankMoney(arrearsValue, charter.currency)} in arrears or defaulted`
          }
        />
      </div>
    </section>
  );
}

function HealthStat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "success" | "warning" | "error" | "default";
}) {
  const valueTone =
    tone === "error"
      ? "text-error"
      : tone === "warning"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-card-border bg-card px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueTone}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{detail}</div>
    </div>
  );
}

function ActiveCharterPanel({
  data,
  canMutate,
  onChanged,
  showToast,
}: {
  data: ConsolePayload;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: (msg: string, variant?: "success" | "error" | "info") => void;
}) {
  const charter = data.charter!;
  const depositTaking = charter.type === "retail" || charter.type === "universal";
  const propEligible = charter.type === "investment" || charter.type === "universal";
  const playerDeposits = Math.max(0, charter.totalDeposits - charter.npcDeposits);
  const tradingVisible = propEligible;
  const [tab, setTab] = useState<BankTab>("overview");

  const tabs: { id: BankTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "lending", label: "Lending" },
    { id: "funding", label: "Funding" },
    ...(tradingVisible ? [{ id: "trading" as const, label: "Trading" }] : []),
    { id: "admin", label: "Admin" },
  ];

  return (
    <div className="space-y-6">
      <HealthCard data={data} />

      <div className="flex flex-wrap gap-1 border-b border-card-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y divide-card-border sm:divide-y-0 sm:divide-x">
            <StatCell
              label="Posted capital"
              value={formatBankMoney(charter.postedCapital, charter.currency)}
              sub={`chartered T${charter.charteredTurn}`}
            />
            <StatCell
              label="Deposits"
              value={formatBankMoney(charter.totalDeposits, charter.currency)}
              sub={`players ${formatBankMoney(playerDeposits, charter.currency)} · households ${formatBankMoney(charter.npcDeposits, charter.currency)}`}
            />
            <StatCell
              label="Deposit ceiling"
              value={formatBankMoney(
                data.depositCeiling ?? charter.depositCeiling,
                charter.currency
              )}
              sub={`branch share ${((charter.branchCapacityShare ?? data.defaultBranchCapacityShare) * 100).toFixed(0)}%`}
            />
            <StatCell
              label="Loans out"
              value={formatBankMoney(charter.totalLoans, charter.currency)}
              sub={
                data.reserveRatio != null
                  ? `reserve requirement ${(data.reserveRatio * 100).toFixed(0)}%`
                  : undefined
              }
            />
            <StatCell
              label="Rates"
              value={
                data.rates
                  ? `${formatRatePercent(data.rates.depositRatePercent)} / ${formatRatePercent(data.rates.lendingRatePercent)}`
                  : "n/a"
              }
              sub="you pay / you charge"
            />
          </div>
        </section>
      )}

      {tab === "lending" && (
        <div className="space-y-6">
          {depositTaking && data.corridors && (
            <RateOffsetEditor
              corporationId={data.corporation.id}
              corridors={data.corridors}
              depositOffset={charter.depositOffset}
              lendingOffset={charter.lendingOffset}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          )}
          <LoanBookTable
            loans={data.loans}
            currency={charter.currency}
            npcBulkOutstanding={Math.max(
              0,
              charter.totalLoans -
                data.loans
                  .filter((l) => l.status === "current" || l.status === "arrears")
                  .reduce((s, l) => s + l.outstanding, 0)
            )}
          />
          {charter.blacklist ? (
            <BlacklistEditor
              corporationId={data.corporation.id}
              blacklist={charter.blacklist}
              availableFunds={data.blacklistableFunds ?? []}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          ) : null}
        </div>
      )}

      {tab === "funding" && (
        <div className="space-y-6">
          <CapacityAllocationEditor
            corporationId={data.corporation.id}
            currency={charter.currency}
            branchCapacityShare={charter.branchCapacityShare}
            depositCeiling={data.depositCeiling ?? charter.depositCeiling}
            canMutate={canMutate}
            onChanged={onChanged}
            showToast={showToast}
          />
          {depositTaking && (
            <DiscountWindowPanel
              corporationId={data.corporation.id}
              currency={charter.currency}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          )}
          <RecapitalizePanel
            corporationId={data.corporation.id}
            currency={charter.currency}
            postedCapital={charter.postedCapital}
            liquidCapital={data.corporation.liquidCapital}
            totalLoans={charter.totalLoans}
            propBookMarkValue={charter.propBookMarkValue}
            canMutate={canMutate}
            onChanged={onChanged}
            showToast={showToast}
          />
        </div>
      )}

      {tab === "trading" && (
        <div className="space-y-6">
          {data.bankPropTradingEnabled ? (
            <>
              <PropBookPanel
                corporationId={data.corporation.id}
                currency={charter.currency}
                positions={charter.propBook}
                markValue={charter.propBookMarkValue}
                canMutate={canMutate}
                onChanged={onChanged}
                showToast={showToast}
              />
              <InterbankPanel
                corporationId={data.corporation.id}
                currency={charter.currency}
                depositTaking={depositTaking}
                interbankDebt={charter.interbankDebt}
                cbMarginDebt={charter.cbMarginDebt}
                loans={data.interbankLoans}
                canMutate={canMutate}
                onChanged={onChanged}
                showToast={showToast}
              />
            </>
          ) : (
            <EmptyState
              title="Trading is frozen"
              description="Prop trading and interbank markets are switched off for this world."
            />
          )}
        </div>
      )}

      {tab === "admin" && (
        <div className="space-y-6">
          <section className="rounded-xl border border-card-border bg-card p-5 text-sm text-muted">
            <h3 className="text-base font-semibold text-foreground">Charter</h3>
            <p className="mt-1">
              {charterLabel(charter.type)} charter in {charter.currency}, granted on turn{" "}
              {charter.charteredTurn}. Posted capital{" "}
              {formatBankMoney(charter.postedCapital, charter.currency)}.
            </p>
          </section>
          {data.canRevoke ? (
            <RevokeCharterForm
              corporationId={data.corporation.id}
              onChanged={onChanged}
              showToast={showToast}
            />
          ) : (
            <p className="text-sm text-muted">
              Only the chartering currency&apos;s central bank chair or an admin can revoke a
              charter.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function RateOffsetEditor({
  corporationId,
  corridors,
  depositOffset,
  lendingOffset,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  corridors: { deposit: Corridor; lending: Corridor };
  depositOffset: number;
  lendingOffset: number;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: (msg: string, variant?: "success" | "error" | "info") => void;
}) {
  const [{ deposit, lending, busy }, updateRateState] = useReducer(
    mergeState<{ deposit: number; lending: number; busy: boolean }>,
    { deposit: depositOffset, lending: lendingOffset, busy: false }
  );

  useEffect(() => {
    updateRateState({ deposit: depositOffset, lending: lendingOffset });
  }, [depositOffset, lendingOffset]);

  const save = async () => {
    updateRateState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/rates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depositOffset: deposit, lendingOffset: lending }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not update rates", "error");
        return;
      }
      showToast("Rate offsets saved", "success");
      await onChanged();
    } finally {
      updateRateState({ busy: false });
    }
  };

  const step = 0.05;

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-5 max-w-xl">
      <div>
        <h3 className="text-base font-semibold text-foreground">Rate offsets</h3>
        <p className="text-sm text-muted">
          Offsets are percentage points versus the central bank prime, bounded by the Regulation Q
          corridor.
        </p>
      </div>
      <label className="block space-y-2">
        <div className="flex justify-between text-xs text-muted">
          <span>Deposit offset</span>
          <span className="font-mono tabular-nums">{deposit.toFixed(2)} pp</span>
        </div>
        <Slider
          min={corridors.deposit.minOffset}
          max={corridors.deposit.maxOffset}
          step={step}
          value={deposit}
          disabled={!canMutate}
          onChange={(e) => updateRateState({ deposit: parseFloat(e.target.value) })}
          aria-label="Deposit rate offset"
        />
        <p className="text-[10px] text-muted font-mono">
          corridor [{corridors.deposit.minOffset}, {corridors.deposit.maxOffset}]
        </p>
      </label>
      <label className="block space-y-2">
        <div className="flex justify-between text-xs text-muted">
          <span>Lending offset</span>
          <span className="font-mono tabular-nums">{lending.toFixed(2)} pp</span>
        </div>
        <Slider
          min={corridors.lending.minOffset}
          max={corridors.lending.maxOffset}
          step={step}
          value={lending}
          disabled={!canMutate}
          onChange={(e) => updateRateState({ lending: parseFloat(e.target.value) })}
          aria-label="Lending rate offset"
        />
        <p className="text-[10px] text-muted font-mono">
          corridor [{corridors.lending.minOffset}, {corridors.lending.maxOffset}]
        </p>
      </label>
      {canMutate && (
        <Button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving..." : "Save offsets"}
        </Button>
      )}
    </section>
  );
}

function BlacklistEditor({
  corporationId,
  blacklist,
  availableFunds,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  blacklist: NonNullable<NonNullable<ConsolePayload["charter"]>["blacklist"]>;
  availableFunds: { slug: string; name: string }[];
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: (msg: string, variant?: "success" | "error" | "info") => void;
}) {
  const [{ corporations, characters, indexFunds, busy, dirty }, updateBlacklistState] = useReducer(
    mergeState<{
      corporations: Party[];
      characters: Party[];
      indexFunds: { slug: string; name: string }[];
      busy: boolean;
      dirty: boolean;
    }>,
    {
      corporations: blacklist.corporations,
      characters: blacklist.characters,
      indexFunds: blacklist.indexFunds,
      busy: false,
      dirty: false,
    }
  );

  // Re-sync when the console reloads, but never clobber edits in progress.
  useEffect(() => {
    updateBlacklistState({
      corporations: blacklist.corporations,
      characters: blacklist.characters,
      indexFunds: blacklist.indexFunds,
      dirty: false,
    });
  }, [blacklist]);

  const save = async () => {
    updateBlacklistState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/blacklist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          corporationIds: corporations.map((c) => c.id),
          characterIds: characters.map((c) => c.id),
          indexFundIds: indexFunds.map((f) => f.slug),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not update blacklist", "error");
        return;
      }
      showToast("Blacklist saved", "success");
      updateBlacklistState({ dirty: false });
      await onChanged();
    } finally {
      updateBlacklistState({ busy: false });
    }
  };

  const total = corporations.length + characters.length + indexFunds.length;

  return (
    <section className="space-y-4 rounded-xl border border-card-border bg-card p-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">Who this bank refuses</h3>
        <p className="mt-1 text-sm text-muted">
          Listed players cannot deposit here or borrow from you. Listed companies cannot borrow.
          Listing an index fund refuses every company in it. Nobody sees this list except you.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Players ({characters.length})
          </h4>
          {canMutate && (
            <PartySearch
              kind="character"
              excludeIds={characters.map((c) => c.id)}
              disabled={busy}
              onPick={(party) =>
                updateBlacklistState({ characters: [...characters, party], dirty: true })
              }
            />
          )}
          <div className="flex flex-wrap gap-2">
            {characters.length === 0 ? (
              <p className="text-xs text-muted">No players refused.</p>
            ) : (
              characters.map((party) => (
                <BlacklistChip
                  key={party.id}
                  label={party.name}
                  href={partyHref("character", party)}
                  canMutate={canMutate}
                  onRemove={() =>
                    updateBlacklistState({
                      characters: characters.filter((c) => c.id !== party.id),
                      dirty: true,
                    })
                  }
                />
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Companies ({corporations.length})
          </h4>
          {canMutate && (
            <PartySearch
              kind="corporation"
              excludeIds={corporations.map((c) => c.id)}
              disabled={busy}
              onPick={(party) =>
                updateBlacklistState({ corporations: [...corporations, party], dirty: true })
              }
            />
          )}
          <div className="flex flex-wrap gap-2">
            {corporations.length === 0 ? (
              <p className="text-xs text-muted">No companies refused.</p>
            ) : (
              corporations.map((party) => (
                <BlacklistChip
                  key={party.id}
                  label={party.ticker ? `${party.name} (${party.ticker})` : party.name}
                  href={partyHref("corporation", party)}
                  canMutate={canMutate}
                  onRemove={() =>
                    updateBlacklistState({
                      corporations: corporations.filter((c) => c.id !== party.id),
                      dirty: true,
                    })
                  }
                />
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Index funds ({indexFunds.length})
          </h4>
          {canMutate && (
            <select
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
              value=""
              disabled={busy}
              aria-label="Add an index fund to the blacklist"
              onChange={(e) => {
                const fund = availableFunds.find((f) => f.slug === e.target.value);
                if (fund) {
                  updateBlacklistState({ indexFunds: [...indexFunds, fund], dirty: true });
                }
              }}
            >
              <option value="">Add a fund...</option>
              {availableFunds
                .filter((f) => !indexFunds.some((picked) => picked.slug === f.slug))
                .map((fund) => (
                  <option key={fund.slug} value={fund.slug}>
                    {fund.name}
                  </option>
                ))}
            </select>
          )}
          <div className="flex flex-wrap gap-2">
            {indexFunds.length === 0 ? (
              <p className="text-xs text-muted">No funds refused.</p>
            ) : (
              indexFunds.map((fund) => (
                <BlacklistChip
                  key={fund.slug}
                  label={fund.name}
                  canMutate={canMutate}
                  onRemove={() =>
                    updateBlacklistState({
                      indexFunds: indexFunds.filter((f) => f.slug !== fund.slug),
                      dirty: true,
                    })
                  }
                />
              ))
            )}
          </div>
        </div>
      </div>

      {canMutate && (
        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => void save()} disabled={busy || !dirty}>
            {busy ? "Saving..." : "Save blacklist"}
          </Button>
          <span className="text-xs text-muted">
            {dirty ? "Unsaved changes" : `${total} ${total === 1 ? "entry" : "entries"}`}
          </span>
        </div>
      )}
    </section>
  );
}

function LoanBookTable({
  loans,
  currency,
  npcBulkOutstanding,
}: {
  loans: ConsolePayload["loans"];
  currency: CurrencyCode;
  npcBulkOutstanding: number;
}) {
  const named = loans.filter((l) => l.borrowerType !== "npcBulk");

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-foreground">Loan book</h3>
      <div className="rounded-xl border border-card-border bg-card px-4 py-3 text-sm">
        <span className="text-muted">NPC bulk outstanding (implied): </span>
        <span className="font-mono tabular-nums">
          {formatBankMoney(Math.max(0, npcBulkOutstanding), currency)}
        </span>
      </div>
      {named.length === 0 ? (
        <EmptyState
          title="No player loans"
          description="Named character and corporation loans appear here."
        />
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-xl border border-card-border bg-card">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-widest text-muted">
                <th className="px-4 py-3 font-semibold">Borrower</th>
                <th className="px-4 py-3 font-semibold text-right">Principal</th>
                <th className="px-4 py-3 font-semibold text-right">Outstanding</th>
                <th className="px-4 py-3 font-semibold text-right">Rate</th>
                <th className="px-4 py-3 font-semibold">Term</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {named.map((loan) => (
                <tr key={loan.id}>
                  <td className="px-4 py-3">
                    {loan.borrower ? (
                      <Link
                        href={partyHref(
                          loan.borrowerType === "character" ? "character" : "corporation",
                          loan.borrower
                        )}
                        className="font-medium text-primary hover:opacity-80"
                      >
                        {loan.borrower.name}
                      </Link>
                    ) : (
                      <span className="text-muted">Unknown borrower</span>
                    )}
                    <Badge color="default" variant="subtle" className="ml-2">
                      {loan.borrowerType}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBankMoney(loan.principal, currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBankMoney(loan.outstanding, currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatRatePercent(loan.ratePercent)}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    T{loan.originatedTurn} · {loan.termTurns}t
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      color={
                        loan.status === "current"
                          ? "success"
                          : loan.status === "arrears"
                            ? "warning"
                            : loan.status === "defaulted"
                              ? "error"
                              : "default"
                      }
                      variant="subtle"
                    >
                      {loan.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CapacityAllocationEditor({
  corporationId,
  currency,
  branchCapacityShare,
  depositCeiling,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  branchCapacityShare: number;
  depositCeiling: number;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: (msg: string, variant?: "success" | "error" | "info") => void;
}) {
  const [share, setShare] = useState(branchCapacityShare);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShare(branchCapacityShare);
  }, [branchCapacityShare]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/capacity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchCapacityShare: share }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not update capacity allocation", "error");
        return;
      }
      showToast("Capacity allocation saved", "success");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-4 max-w-xl">
      <div>
        <h3 className="text-base font-semibold text-foreground">Capacity allocation</h3>
        <p className="text-sm text-muted">
          Share of financial-sector capacity running the branch network (deposit ceiling). The rest
          produces financial services for the commodity market. Range 10% to 90%.
        </p>
      </div>
      <p className="text-sm font-mono tabular-nums text-foreground">
        Ceiling {formatBankMoney(depositCeiling, currency)}
      </p>
      <label className="block space-y-2">
        <div className="flex justify-between text-xs text-muted">
          <span>Branch share</span>
          <span className="font-mono tabular-nums">{(share * 100).toFixed(0)}%</span>
        </div>
        <Slider
          min={0.1}
          max={0.9}
          step={0.05}
          value={share}
          disabled={!canMutate}
          onChange={(e) => setShare(parseFloat(e.target.value))}
          aria-label="Branch capacity share"
        />
        <p className="text-[10px] text-muted font-mono">
          commodity {(100 - share * 100).toFixed(0)}% · branch {(share * 100).toFixed(0)}%
        </p>
      </label>
      {canMutate && (
        <Button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving..." : "Save allocation"}
        </Button>
      )}
    </section>
  );
}

function PropBookPanel({
  corporationId,
  currency,
  positions,
  markValue,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  positions: NonNullable<ConsolePayload["charter"]>["propBook"];
  markValue: number;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: (msg: string, variant?: "success" | "error" | "info") => void;
}) {
  const [asset, setAsset] = useState<"equity" | "bond" | "indexUnit" | "forex">("equity");
  const [ref, setRef] = useState("");
  const [units, setUnits] = useState("");
  const [busy, setBusy] = useState(false);

  const open = async () => {
    const u = parseFloat(units);
    if (!ref.trim() || !(u > 0)) {
      showToast("Ref and positive units are required", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/prop/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset, ref: ref.trim(), units: u }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not open position", "error");
        return;
      }
      showToast("Position opened", "success");
      setRef("");
      setUnits("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const close = async (pos: (typeof positions)[number]) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/prop/positions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset: pos.asset, ref: pos.ref, units: pos.units }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not close position", "error");
        return;
      }
      showToast("Position closed", "success");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">Prop book</h3>
        <p className="text-sm font-mono tabular-nums text-muted">
          Mark {formatBankMoney(markValue, currency)}
        </p>
      </div>
      {canMutate && (
        <div className="rounded-xl border border-card-border bg-card p-4 grid gap-3 sm:grid-cols-4 max-w-3xl">
          <label className="block space-y-1 text-xs text-muted">
            Asset
            <select
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
              value={asset}
              onChange={(e) => setAsset(e.target.value as typeof asset)}
              aria-label="Prop asset type"
            >
              <option value="equity">Equity</option>
              <option value="bond">Bond</option>
              <option value="indexUnit">Index unit</option>
              <option value="forex">Forex</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs text-muted sm:col-span-2">
            Ref
            <Input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="corp id / bond id / fund / currency"
              aria-label="Prop position ref"
            />
          </label>
          <label className="block space-y-1 text-xs text-muted">
            Units
            <Input
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              inputMode="decimal"
              aria-label="Prop position units"
            />
          </label>
          <div className="sm:col-span-4">
            <Button type="button" onClick={() => void open()} disabled={busy}>
              {busy ? "Working..." : "Open position"}
            </Button>
          </div>
        </div>
      )}
      {positions.length === 0 ? (
        <EmptyState title="No prop positions" description="Open a position to start the book." />
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-xl border border-card-border bg-card">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-widest text-muted">
                <th className="px-4 py-3 font-semibold">Asset</th>
                <th className="px-4 py-3 font-semibold">Ref</th>
                <th className="px-4 py-3 font-semibold text-right">Units</th>
                <th className="px-4 py-3 font-semibold text-right">Cost</th>
                <th className="px-4 py-3 font-semibold text-right">Mark</th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {positions.map((pos) => (
                <tr key={`${pos.asset}:${pos.ref}`}>
                  <td className="px-4 py-3">
                    <Badge color="default" variant="subtle">
                      {pos.asset}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{pos.ref}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {pos.units.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBankMoney(pos.costBasis, currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {pos.markValue != null ? formatBankMoney(pos.markValue, currency) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canMutate && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void close(pos)}
                      >
                        Close
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function InterbankPanel({
  corporationId,
  currency,
  depositTaking,
  interbankDebt,
  cbMarginDebt,
  loans,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  depositTaking: boolean;
  interbankDebt: number;
  cbMarginDebt: number;
  loans: ConsolePayload["interbankLoans"];
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: (msg: string, variant?: "success" | "error" | "info") => void;
}) {
  const [borrower, setBorrower] = useState<Party | null>(null);
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [marginAmount, setMarginAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const lend = async () => {
    const a = parseFloat(amount);
    const r = parseFloat(rate);
    if (!borrower || !(a > 0) || !(r >= 0)) {
      showToast("Pick a borrowing bank and enter an amount and a non-negative rate", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/interbank/loans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrowerCorporationId: borrower.id,
          amount: a,
          ratePercent: r,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not lend interbank", "error");
        return;
      }
      showToast("Interbank loan originated", "success");
      setBorrower(null);
      setAmount("");
      setRate("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const margin = async (action: "draw" | "repay") => {
    const a = parseFloat(marginAmount);
    if (!(a > 0)) {
      showToast("Positive amount required", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/interbank/margin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, amount: a }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? `Could not ${action} margin`, "error");
        return;
      }
      showToast(action === "draw" ? "Margin drawn" : "Margin repaid", "success");
      setMarginAmount("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <h3 className="text-base font-semibold text-foreground">Interbank &amp; CB margin</h3>
      <div className="rounded-xl border border-card-border bg-card grid grid-cols-2 divide-x divide-card-border max-w-xl">
        <StatCell
          label="Interbank debt"
          value={formatBankMoney(interbankDebt, currency)}
          sub="borrowed outstanding"
        />
        <StatCell
          label="CB margin debt"
          value={formatBankMoney(cbMarginDebt, currency)}
          sub="collateralised line"
        />
      </div>

      {depositTaking && canMutate && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3 max-w-2xl">
          <p className="text-sm text-muted">Lend non-reserved deposits to an investment bank.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 text-xs text-muted sm:col-span-3">
              Borrowing bank
              {borrower ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground">{borrower.name}</span>
                  <button
                    type="button"
                    onClick={() => setBorrower(null)}
                    className="text-xs text-muted underline hover:text-foreground"
                  >
                    change
                  </button>
                </div>
              ) : (
                <PartySearch
                  kind="corporation"
                  excludeIds={[corporationId]}
                  disabled={busy}
                  onPick={setBorrower}
                />
              )}
            </div>
            <label className="block space-y-1 text-xs text-muted">
              Amount
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                aria-label="Interbank lend amount"
              />
            </label>
            <label className="block space-y-1 text-xs text-muted">
              Rate %
              <Input
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                inputMode="decimal"
                aria-label="Interbank lend rate"
              />
            </label>
          </div>
          <Button type="button" onClick={() => void lend()} disabled={busy}>
            {busy ? "Working..." : "Lend interbank"}
          </Button>
        </div>
      )}

      {canMutate && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3 max-w-xl">
          <p className="text-sm text-muted">Draw or repay the central bank margin line.</p>
          <label className="block space-y-1 text-xs text-muted max-w-xs">
            Amount
            <Input
              value={marginAmount}
              onChange={(e) => setMarginAmount(e.target.value)}
              inputMode="decimal"
              aria-label="CB margin amount"
            />
          </label>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void margin("draw")} disabled={busy}>
              Draw
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void margin("repay")}
              disabled={busy}
            >
              Repay
            </Button>
          </div>
        </div>
      )}

      {loans.length > 0 && (
        <div className="overflow-x-auto overflow-hidden rounded-xl border border-card-border bg-card">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-widest text-muted">
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Counterparty</th>
                <th className="px-4 py-3 font-semibold text-right">Outstanding</th>
                <th className="px-4 py-3 font-semibold text-right">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {loans.map((loan) => (
                <tr key={loan.id}>
                  <td className="px-4 py-3">
                    <Badge color="default" variant="subtle">
                      {loan.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {loan.counterparty ? (
                      <Link
                        href={partyHref("corporation", loan.counterparty)}
                        className="text-primary hover:opacity-80"
                      >
                        {loan.counterparty.name}
                      </Link>
                    ) : (
                      <span className="text-muted">Unknown bank</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBankMoney(loan.outstanding, currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatRatePercent(loan.ratePercent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type DiscountWindowQuote = {
  available: boolean;
  capAnchor?: number;
  headroomAnchor?: number;
  ratePercent?: number;
  outstanding: number;
  currentStigma: number;
  maxStigma: number;
};

function DiscountWindowPanel({
  corporationId,
  currency,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: (msg: string, variant?: "success" | "error" | "info") => void;
}) {
  const [{ quote, loading, error }, updateWindowState] = useReducer(
    mergeState<{ quote: DiscountWindowQuote | null; loading: boolean; error: string | null }>,
    { quote: null, loading: true, error: null }
  );
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const loadQuote = useCallback(async () => {
    updateWindowState({ loading: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/discount-window`);
      const json = (await res.json().catch(() => ({}))) as DiscountWindowQuote & {
        error?: string;
      };
      if (!res.ok) {
        updateWindowState({ error: json.error ?? "Failed to load discount window", quote: null });
        return;
      }
      updateWindowState({ error: null, quote: json });
    } catch {
      updateWindowState({ error: "Failed to load discount window", quote: null });
    } finally {
      updateWindowState({ loading: false });
    }
  }, [corporationId]);

  useEffect(() => {
    void loadQuote();
  }, [loadQuote]);

  const act = async (action: "draw" | "repay") => {
    const a = parseFloat(amount);
    if (!(a > 0)) {
      showToast("Positive amount required", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/discount-window`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, amount: a }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? `Could not ${action} from the window`, "error");
        return;
      }
      showToast(action === "draw" ? "Discount window drawn" : "Discount window repaid", "success");
      setAmount("");
      await loadQuote();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (loading && !quote) {
    return <Skeleton className="h-24 w-full max-w-xl rounded-xl" />;
  }
  if (error || !quote || !quote.available) return null;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">Discount window</h3>
        <p className="text-sm text-muted">
          Emergency central bank liquidity for deposit-taking banks. Drawing carries a confidence
          stigma that fades once the debt is repaid.
        </p>
      </div>
      <div className="rounded-xl border border-card-border bg-card grid grid-cols-2 sm:grid-cols-4 divide-x divide-card-border max-w-2xl">
        <StatCell label="Outstanding" value={formatBankMoney(quote.outstanding, currency)} />
        <StatCell
          label="Rate"
          value={quote.ratePercent != null ? formatRatePercent(quote.ratePercent) : "-"}
          sub="penalty over prime"
        />
        <StatCell
          label="Remaining capacity"
          value={formatBankMoney(quote.headroomAnchor ?? 0, currency)}
          sub={`cap ${formatBankMoney(quote.capAnchor ?? 0, currency)}`}
        />
        <StatCell
          label="Stigma"
          value={`${(quote.currentStigma * 100).toFixed(1)}%`}
          sub={`confidence penalty, max ${(quote.maxStigma * 100).toFixed(0)}%`}
        />
      </div>
      {canMutate && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3 max-w-xl">
          <p className="text-sm text-muted">Draw against the window, or repay outstanding debt.</p>
          <label className="block space-y-1 text-xs text-muted max-w-xs">
            Amount
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              aria-label="Discount window amount"
            />
          </label>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void act("draw")} disabled={busy}>
              Draw
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void act("repay")}
              disabled={busy}
            >
              Repay
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function RecapitalizePanel({
  corporationId,
  currency,
  postedCapital,
  liquidCapital,
  totalLoans,
  propBookMarkValue,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  postedCapital: number;
  liquidCapital: number;
  totalLoans: number;
  propBookMarkValue: number;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: (msg: string, variant?: "success" | "error" | "info") => void;
}) {
  const position = assessCapital({ postedCapital, liquidCapital, totalLoans, propBookMarkValue });
  const shortfall = capitalShortfall(position);
  const [amount, setAmount] = useState(shortfall > 0 ? String(shortfall) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (shortfall > 0) setAmount(String(shortfall));
  }, [shortfall]);

  const submit = async () => {
    const a = parseFloat(amount);
    if (!(a > 0)) {
      showToast("Positive amount required", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/recapitalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: a }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not post capital", "error");
        return;
      }
      showToast(json.message ?? "Capital posted", "success");
      setAmount("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-4 max-w-xl">
      <div>
        <h3 className="text-base font-semibold text-foreground">Capital adequacy</h3>
        <p className="text-sm text-muted">
          Posted capital absorbs losses before depositors do. Moving treasury cash into posted
          capital cures a supervisory capital shortfall.
        </p>
      </div>
      <div className="text-sm space-y-1">
        <p className="font-mono tabular-nums text-foreground">
          Posted {formatBankMoney(postedCapital, currency)} · ratio{" "}
          {(position.capitalRatio * 100).toFixed(1)}%
        </p>
        {shortfall > 0 ? (
          <p className="text-error">
            Undercapitalized. Post {formatBankMoney(shortfall, currency)} to clear the minimum.
          </p>
        ) : (
          <p className="text-muted">
            Standing: {position.standing}. No capital shortfall at current book values.
          </p>
        )}
      </div>
      {canMutate && (
        <>
          <label className="block space-y-1 text-xs text-muted max-w-xs">
            Amount from treasury
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              aria-label="Recapitalization amount"
            />
          </label>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Posting..." : "Post capital"}
          </Button>
        </>
      )}
    </section>
  );
}

function RevokeCharterForm({
  corporationId,
  onChanged,
  showToast,
}: {
  corporationId: string;
  onChanged: () => Promise<void>;
  showToast: (msg: string, variant?: "success" | "error" | "info") => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    if (!reason.trim()) {
      showToast("Reason is required", "error");
      return;
    }
    if (!confirm("Revoke this bank charter? This cannot be undone by the CEO.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/charter`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not revoke charter", "error");
        return;
      }
      showToast("Charter revoked", "success");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-error/30 bg-error/5 p-5 space-y-3 max-w-xl">
      <h3 className="text-base font-semibold text-error">Revoke charter</h3>
      <p className="text-sm text-muted">
        Central bank chair of this currency, or an admin. The CEO cannot self-revoke.
      </p>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason"
        maxLength={500}
        aria-label="Revocation reason"
      />
      <Button type="button" variant="destructive" onClick={() => void revoke()} disabled={busy}>
        {busy ? "Revoking..." : "Revoke charter"}
      </Button>
    </section>
  );
}
