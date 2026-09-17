"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  HandCoins,
  Landmark,
  PiggyBank,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { CountryFlag } from "@/components/CountryFlag";
import { Badge, Button, EmptyState, Input, Skeleton } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { WarningBandBadge } from "@/components/banking/WarningBandBadge";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import { PrivateLoanModal } from "@/app/banking/PrivateLoanModal";
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
  personalCash: Partial<Record<CurrencyCode, number>>;
  exchangeRates?: Partial<Record<CurrencyCode, number>>;
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
  const [activeTab, setActiveTab] = useState<HubTab>("central");

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
  const visibleTabs: Array<{ id: HubTab; label: string; icon: typeof Landmark; count?: number }> = [
    { id: "central", label: "Central banks", icon: Landmark, count: data.centralBanks.length },
    ...(data.privateBankingEnabled
      ? [
          {
            id: "private" as const,
            label: "Private banks",
            icon: Building2,
            count: data.privateBanks.length,
          },
          { id: "accounts" as const, label: "Your accounts", icon: WalletCards },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 pb-16 sm:px-6 sm:py-8">
      <BankingHero
        primary={primary}
        privateBankingEnabled={data.privateBankingEnabled}
        onNavigate={setActiveTab}
      />

      <HubTabs tabs={visibleTabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "central" && (
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
          <div className="grid gap-4 md:grid-cols-2">
            {data.centralBanks.map((bank) => (
              <CentralBankCard key={bank.currency} bank={bank} />
            ))}
          </div>
        </section>
      )}

      {data.privateBankingEnabled && activeTab === "private" && (
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
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.privateBanks.map((bank) => (
                <PrivateBankCard key={bank.corporationId} bank={bank} />
              ))}
            </div>
          )}
        </section>
      )}

      {data.privateBankingEnabled && activeTab === "accounts" && (
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
  onNavigate,
}: {
  primary: HubCentralBank | undefined;
  privateBankingEnabled: boolean;
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

function CentralBankCard({ bank }: { bank: HubCentralBank }) {
  return (
    <Link
      href={bank.href}
      className="group relative overflow-hidden rounded-2xl border border-card-border bg-card p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/60 via-primary/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-card-border bg-card-elevated transition-colors group-hover:border-primary/25">
            <CountryFlag country={bank.countryId} width={40} height={27} title={bank.countryName} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-bold text-foreground transition-colors group-hover:text-primary">
              {bank.bankName}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              {bank.countryName} · <span className="font-mono">{bank.currency}</span>
            </p>
          </div>
        </div>
        {bank.isPrimary ? (
          <Badge color="primary" variant="subtle">
            Primary
          </Badge>
        ) : (
          <ArrowRight
            className="mt-1 h-4 w-4 shrink-0 text-muted/50 transition-all group-hover:translate-x-0.5 group-hover:text-primary"
            aria-hidden
          />
        )}
      </div>
      <dl className="mt-5 grid grid-cols-2 divide-x divide-card-border rounded-xl border border-card-border bg-background/45">
        <RateMetric label="Prime rate" value={formatRatePercent(bank.primeRate)} />
        <RateMetric
          label="Savings APY"
          value={formatRatePercent(bank.savingsApyPercent)}
          hint="Half the real rate: prime minus inflation"
        />
      </dl>
    </Link>
  );
}

function PrivateBankCard({ bank }: { bank: HubPrivateBank }) {
  const customerBank = bank.charterType === "retail" || bank.charterType === "universal";
  const depositRate =
    bank.charterType === "investment" ? "Not offered" : formatRatePercent(bank.depositRatePercent);
  const lendingRate =
    bank.charterType === "investment" ? "Not offered" : formatRatePercent(bank.lendingRatePercent);

  return (
    <article className="group flex min-h-full flex-col overflow-hidden rounded-2xl border border-card-border bg-card shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg">
      <Link
        href={bank.href}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card-elevated text-muted transition-colors group-hover:text-primary">
              <Building2 className="h-4.5 w-4.5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-bold text-foreground transition-colors group-hover:text-primary">
                {bank.name}
              </h3>
              <p className="mt-0.5 text-xs text-muted">
                {bank.countryName} · <span className="font-mono">{bank.currency}</span>
              </p>
            </div>
          </div>
          <ArrowRight
            className="mt-1 h-4 w-4 shrink-0 text-muted/50 transition-all group-hover:translate-x-0.5 group-hover:text-primary"
            aria-hidden
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5">
          <Badge color={bank.operatorType === "player" ? "info" : "default"} variant="subtle">
            {bank.operatorType === "player" ? "Player-run" : "NPP-run"}
          </Badge>
          <Badge color="default" variant="subtle">
            {charterLabel(bank.charterType)}
          </Badge>
          <WarningBandBadge band={bank.warningBand} confidence={bank.confidence} />
        </div>

        <dl className="mt-5 grid grid-cols-2 divide-x divide-card-border border-y border-card-border bg-background/35">
          <RateMetric
            label="Deposit rate"
            value={depositRate}
            compact={depositRate === "Not offered"}
          />
          <RateMetric
            label="Lending rate"
            value={lendingRate}
            compact={lendingRate === "Not offered"}
          />
        </dl>
      </Link>

      <div className="mt-auto flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            Total deposits
          </p>
          <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatBankMoney(bank.totalDeposits, bank.currency)}
          </p>
        </div>
        <ShieldCheck className="h-4 w-4 text-muted/60" aria-label="Deposit supervision" />
      </div>

      <div className="grid gap-2 border-t border-card-border p-4 sm:grid-cols-2">
        {customerBank ? (
          <>
            <Link
              href={`${bank.href}#customer-deposit`}
              aria-label={`Deposit savings at ${bank.name}`}
              className="inline-flex items-center justify-center rounded-lg border border-success/35 bg-success/10 px-3 py-2 text-xs font-semibold text-success transition-colors hover:bg-success/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success"
            >
              Deposit savings
            </Link>
            <Link
              href={`${bank.href}#customer-loan`}
              aria-label={`Apply for a loan at ${bank.name}`}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Apply for a loan
            </Link>
          </>
        ) : (
          <Link
            href={bank.href}
            className="col-span-full inline-flex items-center justify-center rounded-lg border border-card-border px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            View bank
          </Link>
        )}
      </div>
    </article>
  );
}

function RateMetric({
  label,
  value,
  hint,
  compact = false,
}: {
  label: string;
  value: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd
        className={`mt-1 font-mono font-bold tabular-nums text-foreground ${compact ? "text-xs" : "text-base"}`}
      >
        {value}
      </dd>
      {hint && <dd className="mt-1 text-[10px] leading-tight text-muted">{hint}</dd>}
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
        description="Moving the holder changes the return, not the balance."
      />
      <div className="divide-y divide-card-border">
        {rows.map((row) => (
          <div
            key={row.currency}
            className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_minmax(220px,0.95fr)] sm:items-center"
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
            <label className="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Held at
              <select
                className="h-10 w-full rounded-lg border border-card-border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                value={row.currentHolder}
                disabled={busy === row.currency}
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
