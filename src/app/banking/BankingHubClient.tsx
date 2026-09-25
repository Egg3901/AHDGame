"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Building2,
  HandCoins,
  Landmark,
  PiggyBank,
  Wallet,
  WalletCards,
} from "lucide-react";
import { CountryFlag } from "@/components/CountryFlag";
import { Badge, Button, EmptyState, Input, Skeleton } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { WarningBandBadge } from "@/components/banking/WarningBandBadge";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import { PrivateLoanModal } from "@/app/banking/PrivateLoanModal";
import { CHARACTER_LOAN_SPREAD_PP, convertFaceBetweenCurrencies } from "@/lib/banking/lendingMath";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type { BankCharterType } from "@/lib/db/types/bank";

type HubCentralBank = {
  currency: CurrencyCode;
  bankName: string;
  countryId: CountryId;
  countryName: string;
  href: string;
  primeRate: number;
  savingsApyPercent: number;
  isPrimary: boolean;
};

type HubPrivateBank = {
  corporationId: string;
  sequentialId: number | null;
  name: string;
  countryId: CountryId;
  countryName: string;
  currency: CurrencyCode;
  operatorType: "player" | "npp";
  charterType: BankCharterType;
  depositRatePercent: number;
  lendingRatePercent: number;
  warningBand: "green" | "amber" | "red" | null;
  confidence: number | null;
  totalDeposits: number;
  cashReserves: number;
  lendableHeadroom: number;
  requireApproval?: boolean;
  href: string;
};

type HubSavingsRow = {
  currency: CurrencyCode;
  balance: number;
  currentHolder: "centralBank" | string;
  options: Array<{
    holder: "centralBank" | string;
    label: string;
    depositRatePercent: number;
  }>;
};

type HubCeoCorporation = {
  id: string;
  name: string;
  liquidCapital: number;
  incomePerTurn: number;
  currency: CurrencyCode;
};

type HubLoan = {
  id: string;
  bankCorporationId: string;
  bankName: string;
  bankSequentialId: number | null;
  currency: CurrencyCode;
  borrowerType: "character" | "corporation";
  borrowerId: string | null;
  borrowerName: string;
  creditedTo: "personalCash" | "corporationLiquidCapital";
  principal: number;
  outstanding: number;
  ratePercent: number;
  originatedTurn: number;
  termTurns: number;
  status: string;
};

type HubPayload = {
  privateBankingEnabled: boolean;
  isAdmin: boolean;
  characterId: string | null;
  primaryCountryId: CountryId;
  primaryCurrency: CurrencyCode;
  centralBanks: HubCentralBank[];
  privateBanks: HubPrivateBank[];
  savings: HubSavingsRow[];
  savingsBalances?: Partial<Record<CurrencyCode, number>>;
  personalCash: Partial<Record<CurrencyCode, number>>;
  exchangeRates?: Partial<Record<CurrencyCode, number>>;
  displayFxRates?: Partial<Record<CurrencyCode, number>>;
  personalIncomeByCurrency: Partial<Record<CurrencyCode, number>>;
  currentTurn: number;
  ceoCorporations: HubCeoCorporation[];
  loans: HubLoan[];
  lendingBanks: HubPrivateBank[];
};

type HubTab = "central" | "private" | "accounts";

function charterLabel(type: BankCharterType): string {
  if (type === "retail") return "Retail";
  if (type === "investment") return "Investment";
  return "Universal";
}

export function BankingHubClient() {
  const { showToast } = useToast();
  const [data, setData] = useState<HubPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<HubTab>("private");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/banking/hub");
      const json = (await res.json().catch(() => ({}))) as HubPayload & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to load banking hub");
        setData(null);
        return;
      }
      setError(null);
      setData(json);
    } catch {
      setError("Failed to load banking hub");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <EmptyState title="Banking unavailable" description={error ?? "Could not load."} />
      </div>
    );
  }

  const primary = data.centralBanks.find((b) => b.isPrimary);
  const resolvedTab: HubTab = data.privateBankingEnabled ? activeTab : "central";
  const visibleTabs: Array<{ id: HubTab; label: string; icon: typeof Landmark; count?: number }> = [
    ...(data.privateBankingEnabled
      ? [
          {
            id: "private" as const,
            label: "Private banks",
            icon: Building2,
            count: data.privateBanks.length,
          },
        ]
      : []),
    { id: "central", label: "Central banks", icon: Landmark, count: data.centralBanks.length },
    ...(data.privateBankingEnabled
      ? [{ id: "accounts" as const, label: "Your accounts", icon: WalletCards }]
      : []),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 pb-16 sm:px-6 sm:py-8">
      <BankingHero
        primary={primary}
        privateBankingEnabled={data.privateBankingEnabled}
        hasCharacter={!!data.characterId}
        primaryCurrency={data.primaryCurrency}
        personalCash={data.personalCash ?? {}}
        savingsBalances={data.savingsBalances ?? {}}
        displayFxRates={data.displayFxRates ?? {}}
        onNavigate={setActiveTab}
      />

      <HubTabs tabs={visibleTabs} activeTab={resolvedTab} onChange={setActiveTab} />

      {resolvedTab === "central" && (
        <section
          id="banking-panel-central"
          role="tabpanel"
          aria-labelledby="banking-tab-central"
          className="space-y-4"
        >
          <SectionHeading
            id="central-banks-heading"
            eyebrow="Monetary policy"
            title="Central banks"
            description="Compare the policy rates that set the baseline for saving and borrowing in each currency."
            icon={Landmark}
          />
          <CentralBanksTable banks={data.centralBanks} />
        </section>
      )}

      {data.privateBankingEnabled && resolvedTab === "private" && (
        <section
          id="banking-panel-private"
          role="tabpanel"
          aria-labelledby="banking-tab-private"
          className="space-y-4"
        >
          <SectionHeading
            id="private-banks-heading"
            eyebrow="Commercial market"
            title="Private banks"
            description="Chartered institutions compete on rates while reserve rules and deposit insurance shape their risk."
            icon={Building2}
            aside={
              <Badge color="default" variant="outline">
                {data.privateBanks.length} chartered
              </Badge>
            }
          />
          {data.privateBanks.length === 0 ? (
            <EmptyState
              title="No chartered banks yet"
              description="A corporation that owns a financial sector can issue a bank charter from its Bank console."
            />
          ) : (
            <PrivateBanksTable banks={data.privateBanks} hasCharacter={!!data.characterId} />
          )}
        </section>
      )}

      {data.privateBankingEnabled && resolvedTab === "accounts" && (
        <section
          id="banking-panel-accounts"
          role="tabpanel"
          aria-labelledby="banking-tab-accounts"
          className="space-y-4"
        >
          <SectionHeading
            id="accounts-heading"
            eyebrow="Personal finance"
            title="Your accounts"
            description="Place each savings balance where it earns the best return, or arrange new credit."
            icon={WalletCards}
          />
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <YourSavingsSection rows={data.savings} onChanged={load} showToast={showToast} />
            <GetLoanForm
              banks={data.lendingBanks}
              ceoCorporations={data.ceoCorporations}
              personalCash={data.personalCash ?? {}}
              exchangeRates={data.exchangeRates ?? {}}
              personalIncomeByCurrency={data.personalIncomeByCurrency ?? {}}
              currentTurn={data.currentTurn ?? 1}
              loans={data.loans ?? []}
              hasCharacter={!!data.characterId}
              onChanged={load}
              showToast={showToast}
            />
          </div>
          <YourLoansSection loans={data.loans ?? []} />
        </section>
      )}

      {data.isAdmin && (
        <AdminUnwindPanel banks={data.privateBanks} onChanged={load} showToast={showToast} />
      )}
    </div>
  );
}

function HubTabs({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: Array<{ id: HubTab; label: string; icon: typeof Landmark; count?: number }>;
  activeTab: HubTab;
  onChange: (tab: HubTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Banking sections"
      className="flex gap-1 overflow-x-auto rounded-2xl border border-card-border bg-card p-1.5 shadow-card"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            id={`banking-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`banking-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`flex min-w-max flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              active
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:bg-card-elevated hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {tab.label}
            {typeof tab.count === "number" && (
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                  active ? "bg-white/15 text-white" : "bg-card-elevated text-muted"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

type SectionHeadingProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof Landmark;
  aside?: React.ReactNode;
};

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  icon: Icon,
  aside,
}: SectionHeadingProps) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{eyebrow}</p>
          <h2 id={id} className="mt-0.5 text-xl font-bold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
        </div>
      </div>
      {aside && <div className="hidden shrink-0 sm:block">{aside}</div>}
    </div>
  );
}

function BankingHero({
  primary,
  privateBankingEnabled,
  hasCharacter,
  primaryCurrency,
  personalCash,
  savingsBalances,
  displayFxRates,
  onNavigate,
}: {
  primary: HubCentralBank | undefined;
  privateBankingEnabled: boolean;
  hasCharacter: boolean;
  primaryCurrency: CurrencyCode;
  personalCash: Partial<Record<CurrencyCode, number>>;
  savingsBalances: Partial<Record<CurrencyCode, number>>;
  displayFxRates: Partial<Record<CurrencyCode, number>>;
  onNavigate: (tab: HubTab) => void;
}) {
  return (
    <header className="relative overflow-hidden rounded-3xl border border-card-border bg-gradient-to-br from-card via-card to-card-elevated shadow-lg">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-16 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
      />
      <Landmark
        aria-hidden
        className="pointer-events-none absolute -right-6 top-0 h-52 w-52 text-foreground/[0.035] sm:right-6"
        strokeWidth={0.7}
      />

      <div className="relative px-5 pb-6 pt-7 sm:px-8 sm:pb-8 sm:pt-9">
        <div
          className={`grid gap-6 ${hasCharacter ? "xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]" : ""}`}
        >
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              <span className="h-px w-7 bg-primary/70" aria-hidden />
              World financial system
            </div>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Banking &amp; Credit
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
              Follow monetary policy, compare chartered banks, and manage your savings and borrowing
              from one desk.
            </p>
            {privateBankingEnabled && (
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate("private")}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  Browse private banks
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate("accounts")}
                  className="inline-flex items-center gap-2 rounded-lg border border-card-border bg-card/70 px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  Deposit or borrow
                  <WalletCards className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}
          </div>

          {hasCharacter && (
            <YourFundsPanel
              personalCash={personalCash}
              savingsBalances={savingsBalances}
              primaryCurrency={primaryCurrency}
              fxRates={displayFxRates}
            />
          )}
        </div>

        {primary && (
          <div className="mt-7 overflow-hidden rounded-2xl border border-primary/25 bg-background/55 backdrop-blur-sm">
            <div className="grid lg:grid-cols-[1fr_auto]">
              <div className="flex items-center gap-4 p-4 sm:p-5">
                <div className="flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-card-border bg-card-elevated shadow-sm">
                  <CountryFlag
                    country={primary.countryId}
                    width={46}
                    height={31}
                    title={primary.countryName}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                    Your primary central bank
                  </p>
                  <p className="mt-1 truncate text-base font-bold text-foreground sm:text-lg">
                    {primary.bankName}
                  </p>
                  <p className="text-xs text-muted">
                    {primary.countryName} · {primary.currency}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 border-t border-card-border lg:border-l lg:border-t-0">
                <HeroRate label="Prime rate" value={primary.primeRate} />
                <HeroRate
                  label="Savings APY"
                  value={primary.savingsApyPercent}
                  hint="Half the real rate: prime minus inflation"
                  divided
                />
              </div>
            </div>
            <Link
              href={primary.href}
              className="group flex items-center justify-between border-t border-card-border bg-primary/[0.06] px-4 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5"
            >
              Open policy desk
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

function HeroRate({
  label,
  value,
  hint,
  divided = false,
}: {
  label: string;
  value: number;
  hint?: string;
  divided?: boolean;
}) {
  return (
    <div
      className={`min-w-[125px] px-4 py-4 sm:px-6 ${divided ? "border-l border-card-border" : ""}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold tabular-nums text-foreground">
        {formatRatePercent(value)}
      </p>
      {hint && <p className="mt-1 text-[10px] leading-tight text-muted">{hint}</p>}
    </div>
  );
}

// ── Hero "Your balances" panel ─────────────────────────────────────────

function nonzeroBalances(
  balances: Partial<Record<CurrencyCode, number>>
): Array<[CurrencyCode, number]> {
  return (Object.entries(balances) as Array<[CurrencyCode, number]>)
    .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

/** Display total of a multi-currency balance set, converted into `target`. */
function totalInCurrency(
  balances: Partial<Record<CurrencyCode, number>>,
  target: CurrencyCode,
  rates: Partial<Record<CurrencyCode, number>>
): number {
  let total = 0;
  for (const [code, amount] of Object.entries(balances) as Array<[CurrencyCode, number]>) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total +=
      code === target
        ? amount
        : convertFaceBetweenCurrencies(amount, code, target, rates[code] ?? 0, rates[target] ?? 0);
  }
  return total;
}

function YourFundsPanel({
  personalCash,
  savingsBalances,
  primaryCurrency,
  fxRates,
}: {
  personalCash: Partial<Record<CurrencyCode, number>>;
  savingsBalances: Partial<Record<CurrencyCode, number>>;
  primaryCurrency: CurrencyCode;
  fxRates: Partial<Record<CurrencyCode, number>>;
}) {
  return (
    <aside
      aria-label="Your balances"
      className="self-start overflow-hidden rounded-2xl border border-primary/25 bg-background/55 backdrop-blur-sm"
    >
      <p className="border-b border-card-border px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
        Your balances
      </p>
      <div className="grid divide-y divide-card-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-1 xl:divide-x-0 xl:divide-y">
        <FundsStat
          icon={Wallet}
          label="Liquid funds"
          total={totalInCurrency(personalCash, primaryCurrency, fxRates)}
          currency={primaryCurrency}
          entries={nonzeroBalances(personalCash)}
        />
        <FundsStat
          icon={PiggyBank}
          label="Savings"
          total={totalInCurrency(savingsBalances, primaryCurrency, fxRates)}
          currency={primaryCurrency}
          entries={nonzeroBalances(savingsBalances)}
        />
      </div>
      <p className="border-t border-card-border px-4 py-2.5 text-[10px] leading-relaxed text-muted">
        Totals converted to {primaryCurrency} at current exchange rates.
      </p>
    </aside>
  );
}

function FundsStat({
  icon: Icon,
  label,
  total,
  currency,
  entries,
}: {
  icon: typeof Landmark;
  label: string;
  total: number;
  currency: CurrencyCode;
  entries: Array<[CurrencyCode, number]>;
}) {
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-foreground">
        {formatBankMoney(total, currency)}
      </p>
      {entries.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {entries.map(([code, amount]) => (
            <span key={code} className="font-mono text-[11px] tabular-nums text-muted">
              {formatBankMoney(amount, code)} {code}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted">No balance yet</p>
      )}
    </div>
  );
}

// ── Sortable tables ────────────────────────────────────────────────────

type SortDirection = "asc" | "desc";
type SortState<K extends string> = { key: K; dir: SortDirection } | null;

function toggleSort<K extends string>(
  current: SortState<K>,
  column: K,
  defaultDir: SortDirection
): SortState<K> {
  if (current?.key === column) {
    return { key: column, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key: column, dir: defaultDir };
}

function SortableTh<K extends string>({
  label,
  column,
  sort,
  onToggle,
  defaultDir = "desc",
  align = "left",
  className = "",
}: {
  label: string;
  column: K;
  sort: SortState<K>;
  onToggle: (column: K, defaultDir: SortDirection) => void;
  defaultDir?: SortDirection;
  align?: "left" | "right";
  className?: string;
}) {
  const dir = sort && sort.key === column ? sort.dir : null;
  return (
    <th
      scope="col"
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
      className={`px-4 py-3 font-semibold ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <button
        type="button"
        onClick={() => onToggle(column, defaultDir)}
        className={`group inline-flex items-center gap-1 uppercase tracking-widest transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          align === "right" ? "flex-row-reverse" : ""
        } ${dir ? "text-foreground" : ""}`}
      >
        {label}
        {dir ? (
          dir === "asc" ? (
            <ArrowUp className="h-3 w-3 text-primary" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3 text-primary" aria-hidden />
          )
        ) : (
          <ArrowUpDown
            className="h-3 w-3 text-muted/40 transition-colors group-hover:text-muted"
            aria-hidden
          />
        )}
      </button>
    </th>
  );
}

function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  metric: (row: T, key: K) => number | string | null,
  tiebreak: (row: T) => string
): T[] {
  if (!sort) return rows;
  const { key, dir } = sort;
  return [...rows].sort((a, b) => {
    const av = metric(a, key);
    const bv = metric(b, key);
    let cmp: number;
    if (av == null && bv == null) cmp = 0;
    else if (av == null) return 1;
    else if (bv == null) return -1;
    else if (typeof av === "string") cmp = av.localeCompare(String(bv));
    else cmp = av - Number(bv);
    const ordered = dir === "asc" ? cmp : -cmp;
    return ordered === 0 ? tiebreak(a).localeCompare(tiebreak(b)) : ordered;
  });
}

// ── Central banks table ────────────────────────────────────────────────

type CentralBankSortKey = "name" | "prime" | "apy";

function CentralBanksTable({ banks }: { banks: HubCentralBank[] }) {
  const [sort, setSort] = useState<SortState<CentralBankSortKey>>(null);

  const sorted = useMemo(
    () =>
      sortRows(
        banks,
        sort,
        (bank, key) => {
          if (key === "name") return bank.bankName.toLowerCase();
          if (key === "prime") return bank.primeRate;
          return bank.savingsApyPercent;
        },
        (bank) => bank.bankName
      ),
    [banks, sort]
  );

  return (
    <div className="overflow-x-auto rounded-2xl border border-card-border bg-card shadow-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-card-border bg-card-elevated/45 text-[10px] uppercase tracking-widest text-muted">
            <SortableTh
              label="Bank"
              column="name"
              sort={sort}
              onToggle={(key, dir) => setSort((cur) => toggleSort(cur, key, dir))}
              defaultDir="asc"
              className="pl-5"
            />
            <th scope="col" className="px-4 py-3 text-left font-semibold">
              Currency
            </th>
            <SortableTh
              label="Prime rate"
              column="prime"
              sort={sort}
              onToggle={(key, dir) => setSort((cur) => toggleSort(cur, key, dir))}
              align="right"
            />
            <SortableTh
              label="Savings APY"
              column="apy"
              sort={sort}
              onToggle={(key, dir) => setSort((cur) => toggleSort(cur, key, dir))}
              align="right"
            />
            <th scope="col" className="px-5 py-3 text-right font-semibold">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border">
          {sorted.map((bank) => (
            <tr key={bank.currency} className="transition-colors hover:bg-background/40">
              <td className="px-5 py-3.5">
                <Link
                  href={bank.href}
                  className="group flex min-w-0 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex h-8 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-card-border bg-card-elevated">
                    <CountryFlag
                      country={bank.countryId}
                      width={32}
                      height={22}
                      title={bank.countryName}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-foreground transition-colors group-hover:text-primary">
                      {bank.bankName}
                    </span>
                    <span className="block text-xs text-muted">{bank.countryName}</span>
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3.5 font-mono text-xs font-semibold text-muted">
                {bank.currency}
              </td>
              <td className="px-4 py-3.5 text-right font-mono text-sm font-bold tabular-nums text-foreground">
                {formatRatePercent(bank.primeRate)}
              </td>
              <td className="px-4 py-3.5 text-right font-mono text-sm font-bold tabular-nums text-success">
                {formatRatePercent(bank.savingsApyPercent)}
              </td>
              <td className="px-5 py-3.5 text-right">
                {bank.isPrimary ? (
                  <Badge color="primary" variant="subtle">
                    Your bank
                  </Badge>
                ) : (
                  <Link
                    href={bank.href}
                    aria-label={`Open ${bank.bankName}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Open desk
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Private banks table ────────────────────────────────────────────────

type PrivateBankSortKey = "name" | "depositApy" | "loanRate" | "health" | "deposits";

function PrivateBanksTable({
  banks,
  hasCharacter,
}: {
  banks: HubPrivateBank[];
  hasCharacter: boolean;
}) {
  const [sort, setSort] = useState<SortState<PrivateBankSortKey>>({
    key: "depositApy",
    dir: "desc",
  });
  const estRateLabel = hasCharacter ? "Est. yours" : "Est. personal";

  const sorted = useMemo(
    () =>
      sortRows(
        banks,
        sort,
        (bank, key) => {
          switch (key) {
            case "name":
              return bank.name.toLowerCase();
            case "depositApy":
              return bank.charterType === "investment" ? null : bank.depositRatePercent;
            case "loanRate":
              return bank.charterType === "investment" ? null : bank.lendingRatePercent;
            case "health":
              return bank.confidence;
            case "deposits":
              return bank.totalDeposits;
            default:
              return bank.name.toLowerCase();
          }
        },
        (bank) => bank.name
      ),
    [banks, sort]
  );

  const onToggle = (key: PrivateBankSortKey, dir: SortDirection) =>
    setSort((cur) => toggleSort(cur, key, dir));

  return (
    <div className="overflow-x-auto rounded-2xl border border-card-border bg-card shadow-card">
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr className="border-b border-card-border bg-card-elevated/45 text-[10px] uppercase tracking-widest text-muted">
            <SortableTh
              label="Bank"
              column="name"
              sort={sort}
              onToggle={onToggle}
              defaultDir="asc"
              className="pl-5"
            />
            <th scope="col" className="px-4 py-3 text-left font-semibold">
              Charter
            </th>
            <SortableTh
              label="Savings APY"
              column="depositApy"
              sort={sort}
              onToggle={onToggle}
              align="right"
            />
            <SortableTh
              label="Loan rate"
              column="loanRate"
              sort={sort}
              onToggle={onToggle}
              defaultDir="asc"
              align="right"
            />
            <SortableTh
              label="Health"
              column="health"
              sort={sort}
              onToggle={onToggle}
              align="right"
            />
            <SortableTh
              label="Deposits"
              column="deposits"
              sort={sort}
              onToggle={onToggle}
              align="right"
            />
            <th scope="col" className="px-5 py-3 text-right font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border">
          {sorted.map((bank) => (
            <PrivateBankRow key={bank.corporationId} bank={bank} estRateLabel={estRateLabel} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrivateBankRow({ bank, estRateLabel }: { bank: HubPrivateBank; estRateLabel: string }) {
  const customerBank = bank.charterType === "retail" || bank.charterType === "universal";
  const estimatedRate = bank.lendingRatePercent + CHARACTER_LOAN_SPREAD_PP;

  return (
    <tr className="transition-colors hover:bg-background/40">
      <td className="px-5 py-3.5">
        <Link
          href={bank.href}
          className="group flex min-w-0 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="flex h-8 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-card-border bg-card-elevated">
            <CountryFlag country={bank.countryId} width={32} height={22} title={bank.countryName} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-foreground transition-colors group-hover:text-primary">
              {bank.name}
            </span>
            <span className="block text-xs text-muted">
              {bank.countryName} · <span className="font-mono">{bank.currency}</span>
            </span>
          </span>
        </Link>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge color={bank.operatorType === "player" ? "info" : "default"} variant="subtle">
            {bank.operatorType === "player" ? "Player-run" : "NPP-run"}
          </Badge>
          <Badge color="default" variant="subtle">
            {charterLabel(bank.charterType)}
          </Badge>
          {bank.requireApproval && (
            <Badge color="warning" variant="subtle">
              Manual approval
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 py-3.5 text-right">
        {customerBank ? (
          <span className="font-mono text-sm font-bold tabular-nums text-success">
            {formatRatePercent(bank.depositRatePercent)}
          </span>
        ) : (
          <span className="text-xs text-muted">Not offered</span>
        )}
      </td>
      <td className="px-4 py-3.5 text-right">
        {customerBank ? (
          <span title={`Personal loans price at the base rate +${CHARACTER_LOAN_SPREAD_PP}pp`}>
            <span className="block font-mono text-sm font-bold tabular-nums text-foreground">
              {formatRatePercent(bank.lendingRatePercent)}
            </span>
            <span className="block font-mono text-[11px] tabular-nums text-muted">
              {estRateLabel} {formatRatePercent(estimatedRate)}
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted">Not offered</span>
        )}
      </td>
      <td className="px-4 py-3.5">
        <BankHealthCell band={bank.warningBand} confidence={bank.confidence} />
      </td>
      <td className="px-4 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">
        {formatBankMoney(bank.totalDeposits, bank.currency)}
      </td>
      <td className="px-5 py-3.5">
        <div className="flex items-center justify-end gap-2">
          {customerBank ? (
            <>
              <Link
                href={`${bank.href}#customer-deposit`}
                aria-label={`Deposit savings at ${bank.name}`}
                className="rounded-lg border border-success/35 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-success/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success"
              >
                Deposit
              </Link>
              <Link
                href={`${bank.href}#customer-loan`}
                aria-label={`Apply for a loan at ${bank.name}`}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Borrow
              </Link>
            </>
          ) : (
            <Link
              href={bank.href}
              className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              View bank
            </Link>
          )}
        </div>
      </td>
    </tr>
  );
}

const BAND_BAR_COLOR = {
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-error",
} as const;

function BankHealthCell({
  band,
  confidence,
}: {
  band: HubPrivateBank["warningBand"];
  confidence: number | null;
}) {
  const score =
    typeof confidence === "number" && Number.isFinite(confidence)
      ? Math.round(confidence * 100)
      : null;
  return (
    <div className="flex items-center justify-end gap-2.5">
      {score != null && (
        <span
          className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-card-border/50 sm:block"
          aria-hidden
        >
          <span
            className={`block h-full rounded-full ${band ? BAND_BAR_COLOR[band] : "bg-muted"}`}
            style={{ width: `${score}%` }}
          />
        </span>
      )}
      <span className="w-7 text-right font-mono text-sm font-bold tabular-nums text-foreground">
        {score ?? "—"}
      </span>
      <WarningBandBadge band={band} />
    </div>
  );
}

function YourSavingsSection({
  rows,
  onChanged,
  showToast,
}: {
  rows: HubSavingsRow[];
  onChanged: () => Promise<void>;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [withdrawAmounts, setWithdrawAmounts] = useState<Partial<Record<CurrencyCode, string>>>({});

  const setHolder = async (currency: CurrencyCode, holder: string) => {
    setBusy(currency);
    try {
      const res = await fetch("/api/character/savings-holder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency, holder }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not move savings", "error");
        return;
      }
      showToast("Savings holder updated", "success");
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async (currency: CurrencyCode, balance: number) => {
    const amount = Number(withdrawAmounts[currency]);
    if (!Number.isFinite(amount) || amount <= 0 || amount > balance) {
      showToast("Enter a withdrawal amount up to your savings balance", "error");
      return;
    }

    setBusy(`withdraw:${currency}`);
    try {
      const res = await fetch("/api/character/savings/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency, amount }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Withdrawal failed", "error");
        return;
      }
      showToast(`Withdrew ${formatBankMoney(amount, currency)} from savings`, "success");
      setWithdrawAmounts((current) => ({ ...current, [currency]: "" }));
      await onChanged();
    } catch {
      showToast("Withdrawal failed", "error");
    } finally {
      setBusy(null);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
        <AccountCardHeader
          icon={PiggyBank}
          title="Savings"
          description="Choose where each currency balance is held."
        />
        <EmptyState
          title="No savings accounts yet"
          description="Open a savings account at a central bank Savings tab, then choose where it is held here."
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
      <AccountCardHeader
        icon={PiggyBank}
        title="Savings"
        description="Choose where savings earn interest, or withdraw them to your wallet."
      />
      <div className="divide-y divide-card-border">
        {rows.map((row) => (
          <div
            key={row.currency}
            className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_minmax(280px,1.1fr)] sm:items-center"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 font-mono text-xs font-bold text-success">
                {row.currency}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Balance
                </p>
                <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-foreground">
                  {formatBankMoney(row.balance, row.currency)}
                </p>
              </div>
            </div>
            <div className="min-w-0">
              <label className="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                Held at
                <select
                  className="h-10 w-full rounded-lg border border-card-border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                  value={row.currentHolder}
                  disabled={busy !== null}
                  onChange={(e) => void setHolder(row.currency, e.target.value)}
                  aria-label={`Savings holder for ${row.currency}`}
                >
                  {row.options.map((opt) => (
                    <option key={opt.holder} value={opt.holder}>
                      {opt.label} · {formatRatePercent(opt.depositRatePercent)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={row.balance}
                  step="any"
                  value={withdrawAmounts[row.currency] ?? ""}
                  onChange={(event) =>
                    setWithdrawAmounts((current) => ({
                      ...current,
                      [row.currency]: event.target.value,
                    }))
                  }
                  disabled={busy !== null}
                  placeholder={`Amount in ${row.currency}`}
                  aria-label={`Withdrawal amount in ${row.currency}`}
                  className="h-10 min-w-0 rounded-lg border border-card-border bg-background px-3 font-mono text-sm tabular-nums text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                />
                <button
                  type="button"
                  aria-label={`Withdraw ${row.currency} savings`}
                  disabled={
                    busy !== null ||
                    !Number.isFinite(Number(withdrawAmounts[row.currency])) ||
                    Number(withdrawAmounts[row.currency]) <= 0 ||
                    Number(withdrawAmounts[row.currency]) > row.balance
                  }
                  onClick={() => void withdraw(row.currency, row.balance)}
                  className="h-10 rounded-lg border border-card-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === `withdraw:${row.currency}` ? "…" : "Withdraw"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GetLoanForm({
  banks,
  ceoCorporations,
  personalCash,
  exchangeRates,
  personalIncomeByCurrency,
  currentTurn,
  loans,
  hasCharacter,
  onChanged,
  showToast,
}: {
  banks: HubPrivateBank[];
  ceoCorporations: HubCeoCorporation[];
  personalCash: Partial<Record<CurrencyCode, number>>;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  personalIncomeByCurrency: Partial<Record<CurrencyCode, number>>;
  currentTurn: number;
  loans: HubLoan[];
  hasCharacter: boolean;
  onChanged: () => Promise<void>;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
}) {
  const [open, setOpen] = useState(false);

  if (banks.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
        <AccountCardHeader
          icon={HandCoins}
          title="New credit"
          description="Borrow personally or for a corporation you lead."
        />
        <EmptyState
          title="No lending banks"
          description="Deposit-taking banks (retail or universal) appear here when chartered."
        />
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
        <AccountCardHeader
          icon={HandCoins}
          title="New credit"
          description="Borrow personally or for a corporation you lead."
        />
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-card-border bg-background/45 px-4 py-3 text-sm leading-relaxed text-muted">
            <p className="font-semibold text-foreground">Clear terms before you submit</p>
            <p className="mt-1">
              Choose Personal loan or Corporation loan. The review screen shows the lender, quoted
              rate, destination, payment estimate, and maximum before any request is sent.
            </p>
          </div>
          <Button type="button" className="w-full" onClick={() => setOpen(true)}>
            Arrange private-bank loan
          </Button>
        </div>
      </div>
      {open && (
        <PrivateLoanModal
          banks={banks}
          ceoCorporations={ceoCorporations}
          personalCash={personalCash}
          exchangeRates={exchangeRates}
          personalIncomeByCurrency={personalIncomeByCurrency}
          currentTurn={currentTurn}
          loans={loans}
          hasCharacter={hasCharacter}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
          showToast={showToast}
        />
      )}
    </>
  );
}
function YourLoansSection({ loans }: { loans: HubLoan[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
      <AccountCardHeader
        icon={HandCoins}
        title="Your loans"
        description="Private-bank credit already drawn. Character loans land in personal cash; corporation loans land in that company's liquid capital."
      />
      {loans.length === 0 ? (
        <EmptyState
          title="No open private-bank loans"
          description="New credit appears here as soon as it is originated, including where the proceeds were credited."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-widest text-muted">
                <th className="px-5 py-3 font-semibold">Bank</th>
                <th className="px-4 py-3 font-semibold">Borrower</th>
                <th className="px-4 py-3 font-semibold">Credited to</th>
                <th className="px-4 py-3 font-semibold text-right">Outstanding</th>
                <th className="px-4 py-3 font-semibold text-right">Rate</th>
                <th className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {loans.map((loan) => (
                <tr key={loan.id}>
                  <td className="px-5 py-3">
                    <Link
                      href={
                        loan.bankSequentialId != null
                          ? `/corporation/${loan.bankSequentialId}?tab=bank`
                          : `/corporation/${loan.bankCorporationId}?tab=bank`
                      }
                      className="font-medium text-primary hover:opacity-80"
                    >
                      {loan.bankName}
                    </Link>
                    <p className="font-mono text-[11px] text-muted">{loan.currency}</p>
                  </td>
                  <td className="px-4 py-3">
                    {loan.borrowerName}
                    <p className="text-[11px] text-muted">
                      {loan.borrowerType === "character" ? "Personal" : "Corporation"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {loan.creditedTo === "personalCash"
                      ? "Personal cash"
                      : `${loan.borrowerName} liquid capital`}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBankMoney(loan.outstanding, loan.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatRatePercent(loan.ratePercent)}
                  </td>
                  <td className="px-5 py-3">
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
    </div>
  );
}

function AccountCardHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Landmark;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-card-border bg-card-elevated/45 px-5 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div>
        <h3 className="font-bold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
    </div>
  );
}

function AdminUnwindPanel({
  banks,
  onChanged,
  showToast,
}: {
  banks: HubPrivateBank[];
  onChanged: () => Promise<void>;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
}) {
  const [corpId, setCorpId] = useState(banks[0]?.corporationId ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!corpId && banks[0]) setCorpId(banks[0].corporationId);
  }, [banks, corpId]);

  const run = async () => {
    if (!corpId || !reason.trim()) {
      showToast("Corporation and reason are required", "error");
      return;
    }
    if (
      !confirm(
        "Force-unwind this bank? Depositors flip to the central bank. This cannot be undone."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/banking/unwind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corporationId: corpId, reason: reason.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Unwind failed", "error");
        return;
      }
      showToast("Bank unwound", "success");
      setReason("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-error/30 bg-error/5 p-5">
      <h2 className="text-lg font-semibold text-error">Admin: unwind bank</h2>
      <p className="text-sm text-muted">
        Operator escape hatch. Works even when private banking is frozen. Admin only.
      </p>
      {banks.length === 0 ? (
        <p className="text-sm text-muted">No active bank charters to unwind.</p>
      ) : (
        <div className="grid gap-3 max-w-xl">
          <label className="block space-y-1 text-xs text-muted">
            Bank corporation
            <select
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
              value={corpId}
              onChange={(e) => setCorpId(e.target.value)}
              aria-label="Bank to unwind"
            >
              {banks.map((b) => (
                <option key={b.corporationId} value={b.corporationId}>
                  {b.name} ({b.corporationId})
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-xs text-muted">
            Reason
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              aria-label="Unwind reason"
            />
          </label>
          <Button type="button" variant="destructive" onClick={() => void run()} disabled={busy}>
            {busy ? "Unwinding..." : "Force unwind"}
          </Button>
        </div>
      )}
    </section>
  );
}
