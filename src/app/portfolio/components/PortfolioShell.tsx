"use client";

import { useEffect, useRef, type ReactNode } from "react";

export interface PortfolioRailItem<K extends string> {
  key: K;
  label: string;
  value: string;
  /** Turn-over-turn percentage delta. Positive = green, negative = red. */
  delta: number | null;
  icon: ReactNode;
  /** Filter this item out of the rail without removing it from the source list. */
  hidden?: boolean;
}

interface PortfolioShellProps<K extends string> {
  title: string;
  subtitle: string;
  netWorthLabel: string;
  netWorth: string;
  /** Optional segmented control (e.g. "My assets" / corp name) shown inside the masthead. */
  ownerSwitcher?: ReactNode;
  /** Optional element shown on the masthead right edge above net worth (e.g. "View corporation" link). */
  mastheadAside?: ReactNode;
  rail: PortfolioRailItem<K>[];
  active: K;
  onSelect: (key: K) => void;
  children: ReactNode;
}

export function PortfolioShell<K extends string>({
  title,
  subtitle,
  netWorthLabel,
  netWorth,
  ownerSwitcher,
  mastheadAside,
  rail,
  active,
  onSelect,
  children,
}: PortfolioShellProps<K>) {
  const visibleRail = rail.filter((r) => !r.hidden);

  return (
    <div className="space-y-6">
      {/* Masthead — integrates title, owner switcher, and net worth into one surface */}
      <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
        <div className="bg-card-elevated px-5 py-5 sm:px-6 sm:py-6">
          {ownerSwitcher && <div className="mb-4">{ownerSwitcher}</div>}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1
                data-coach="nav-portfolio"
                className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate"
              >
                {title}
              </h1>
              <p className="text-xs sm:text-sm text-muted mt-0.5">{subtitle}</p>
              {mastheadAside && <div className="mt-3">{mastheadAside}</div>}
            </div>
            <div className="flex items-baseline gap-3 sm:flex-col sm:items-end sm:gap-0 shrink-0">
              <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                {netWorthLabel}
              </span>
              <span className="text-2xl sm:text-3xl font-bold text-foreground tabular-nums tracking-tight">
                {netWorth}
              </span>
            </div>
          </div>
        </div>
      </div>

      <MobileRail items={visibleRail} active={active} onSelect={onSelect} />

      <div className="grid gap-6 lg:grid-cols-[240px_1fr] lg:gap-8">
        <aside className="hidden lg:block">
          <nav className="sticky top-6 space-y-1" aria-label="Portfolio sections">
            {visibleRail.map((item) => (
              <RailButton
                key={item.key}
                item={item}
                active={active === item.key}
                onClick={() => onSelect(item.key)}
              />
            ))}
          </nav>
        </aside>

        <section className="min-w-0 space-y-6">{children}</section>
      </div>
    </div>
  );
}

function RailButton<K extends string>({
  item,
  active,
  onClick,
}: {
  item: PortfolioRailItem<K>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full rounded-lg border px-3 py-3 text-left transition-all ${
        active
          ? "border-primary/30 bg-primary/5 shadow-sm"
          : "border-transparent hover:border-card-border hover:bg-card-elevated"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
            active
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-card-border bg-card-elevated text-muted group-hover:text-foreground"
          }`}
        >
          {item.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{item.label}</div>
          <div className="flex items-baseline gap-2">
            <span className="truncate text-xs tabular-nums text-muted">{item.value}</span>
            {item.delta !== null && (
              <span
                className={`text-[10px] font-bold tabular-nums shrink-0 ${
                  item.delta >= 0 ? "text-success" : "text-error"
                }`}
              >
                {item.delta >= 0 ? "+" : ""}
                {item.delta.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function MobileRail<K extends string>({
  items,
  active,
  onSelect,
}: {
  items: PortfolioRailItem<K>[];
  active: K;
  onSelect: (k: K) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="-mx-4 overflow-x-auto px-4 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Portfolio sections"
    >
      <div className="flex gap-2 pb-1">
        {items.map((item) => {
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              data-section={item.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(item.key)}
              className={`flex shrink-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 transition-colors ${
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-card-border bg-card hover:bg-card-elevated"
              }`}
            >
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  isActive ? "text-primary" : "text-muted"
                }`}
              >
                {item.label}
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-xs font-semibold text-foreground tabular-nums">
                  {item.value}
                </span>
                {item.delta !== null && (
                  <span
                    className={`text-[10px] font-bold tabular-nums ${
                      item.delta >= 0 ? "text-success" : "text-error"
                    }`}
                  >
                    {item.delta >= 0 ? "+" : ""}
                    {item.delta.toFixed(1)}%
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ================================ Icons ================================ */

export function IconOverview() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

export function IconCash() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v4" />
      <path d="M18 10v4" />
    </svg>
  );
}

export function IconStocks() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  );
}

export function IconBonds() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 15h3" />
    </svg>
  );
}

export function IconFunds() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z" />
      <path d="M3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25z" />
      <path d="M13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z" />
      <path d="M13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
    </svg>
  );
}

export function IconLoans() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

export function IconTransfers() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 7h13" />
      <path d="M16 3l4 4-4 4" />
      <path d="M17 17H4" />
      <path d="M8 21l-4-4 4-4" />
    </svg>
  );
}

/* ======================== Owner toggle (segmented) ======================= */

interface OwnerToggleProps {
  options: { key: string; label: string; subtitle?: string }[];
  active: string;
  onChange: (key: string) => void;
}

export function OwnerToggle({ options, active, onChange }: OwnerToggleProps) {
  return (
    <div
      className="inline-flex items-stretch rounded-lg border border-card-border bg-card p-1 shadow-sm max-w-full"
      role="radiogroup"
      aria-label="Portfolio owner"
    >
      {options.map((opt) => {
        const isActive = opt.key === active;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt.key)}
            className={`relative flex min-w-0 flex-col items-start rounded-md px-3 py-1.5 text-left transition-all ${
              isActive
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:bg-card-elevated hover:text-foreground"
            }`}
          >
            <span className="text-xs font-semibold truncate max-w-[160px] sm:max-w-none">
              {opt.label}
            </span>
            {opt.subtitle && (
              <span
                className={`text-[10px] truncate max-w-[160px] sm:max-w-none ${
                  isActive ? "text-white/80" : "text-muted"
                }`}
              >
                {opt.subtitle}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ================================ Pills ================================ */

export function ChartPill({
  active,
  activeTone = "primary",
  onClick,
  children,
}: {
  active: boolean;
  activeTone?: "primary" | "success" | "warning" | "info";
  onClick: () => void;
  children: ReactNode;
}) {
  const toneClass = {
    primary: "bg-primary text-white",
    success: "bg-success text-white",
    warning: "bg-warning text-white",
    info: "bg-info text-white",
  }[activeTone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        active ? toneClass : "bg-card-elevated text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "success";
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card px-4 py-4 shadow-sm">
      <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">
        {label}
      </span>
      <span
        className={`block text-lg sm:text-xl font-bold tabular-nums ${
          accent === "success" ? "text-success" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
