"use client";

import { useState, useEffect } from "react";
import type { State } from "@/lib/db/types";
import type { StateTaxRates } from "@/lib/db/types/budget";
import { PositionBadges } from "@/components/PositionBadges";
import { policyApiUrl, regionApiSubUrl } from "@/lib/urls";
import type { PolicyRecordResponse } from "./StatePageTabsTypes";

interface StateTaxRateDisplay {
  id: keyof StateTaxRates;
  name: string;
  description: string;
}

const STATE_TAX_RATES: StateTaxRateDisplay[] = [
  { id: "incomeTax", name: "Income Tax", description: "State income tax rate" },
  { id: "salesTax", name: "Sales Tax", description: "State sales tax rate" },
  {
    id: "domesticCorporateTax",
    name: "Corporate Tax — Domestic",
    description: "State tax rate on corps headquartered in this country",
  },
  {
    id: "foreignCorporateTax",
    name: "Corporate Tax — Foreign",
    description: "State tax rate on corps headquartered outside this country",
  },
  { id: "propertyTax", name: "Property Tax", description: "State property tax rate" },
];

const DOMAIN_LABELS: Record<string, string> = {
  education: "Education",
  healthcare: "Healthcare",
  economic: "Economic",
  infrastructure: "Infrastructure",
  environment: "Environment",
  publicSafety: "Public Safety",
  social: "Social",
  governance: "Governance",
};

const DOMAIN_ORDER = [
  "taxes",
  "economic",
  "education",
  "environment",
  "governance",
  "healthcare",
  "infrastructure",
  "publicSafety",
  "social",
];

function groupByDomain(records: PolicyRecordResponse[]): Map<string, PolicyRecordResponse[]> {
  const map = new Map<string, PolicyRecordResponse[]>();
  for (const r of records) {
    const domain = r.policyDomain || "governance";
    const list = map.get(domain) ?? [];
    list.push(r);
    map.set(domain, list);
  }
  // Sort by domain order
  const sorted = new Map<string, PolicyRecordResponse[]>();
  for (const domain of DOMAIN_ORDER) {
    const list = map.get(domain);
    if (list?.length) {
      // Sort policies within domain alphabetically
      list.sort((a, b) => a.name.localeCompare(b.name));
      sorted.set(domain, list);
    }
  }
  // Add any remaining domains not in the order
  for (const [domain, list] of map) {
    if (!sorted.has(domain)) {
      list.sort((a, b) => a.name.localeCompare(b.name));
      sorted.set(domain, list);
    }
  }
  return sorted;
}

export function LawsTab({ state }: { state: State }) {
  const [records, setRecords] = useState<PolicyRecordResponse[]>([]);
  const [taxRates, setTaxRates] = useState<StateTaxRates | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set(DOMAIN_ORDER));

  useEffect(() => {
    Promise.all([
      fetch(
        `${policyApiUrl(state.countryId)}?scope=state&stateId=${encodeURIComponent(state._id)}`
      ).then((res) => (res.ok ? res.json() : [])),
      fetch(regionApiSubUrl(state.countryId, state._id, "budget")).then((res) =>
        res.ok ? res.json() : null
      ),
    ])
      .then(([policyData, budgetData]) => {
        setRecords(Array.isArray(policyData) ? policyData : []);
        if (budgetData?.taxRates) {
          setTaxRates(budgetData.taxRates);
        }
      })
      .finally(() => setLoading(false));
  }, [state._id, state.countryId]);

  const byDomain = groupByDomain(records);

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  };

  const expandAll = () => setExpandedDomains(new Set(DOMAIN_ORDER));
  const collapseAll = () => setExpandedDomains(new Set());

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-card-border bg-card p-4 animate-pulse">
            <div className="h-6 w-1/3 bg-card-border/50 rounded mb-2" />
            <div className="h-4 w-1/4 bg-card-border/30 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold">State Policy</h3>
            <p className="mt-1 text-sm text-muted">
              Current policy positions for {state.name}. Economic and social axes shown for each
              policy.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={expandAll}
              className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-card hover:text-foreground transition-colors"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-card hover:text-foreground transition-colors"
            >
              Collapse All
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {/* Taxes Accordion */}
        {taxRates && (
          <section className="rounded-xl border border-card-border bg-card overflow-hidden">
            <button
              onClick={() => toggleDomain("taxes")}
              className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-background/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">Taxes</h2>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted">
                  {STATE_TAX_RATES.length} rates
                </span>
              </div>
              <svg
                className={`h-5 w-5 text-muted transition-transform duration-200 ${expandedDomains.has("taxes") ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {expandedDomains.has("taxes") && (
              <ul className="space-y-3 px-6 pb-6">
                {STATE_TAX_RATES.map((tax) => (
                  <li
                    key={tax.id}
                    className="flex items-center justify-between gap-4 rounded-lg bg-background px-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground">{tax.name}</div>
                      <div className="mt-0.5 text-xs text-muted">{tax.description}</div>
                    </div>
                    <div className="text-right">
                      <span className="rounded border border-primary/40 bg-primary/10 px-3 py-1 text-lg font-bold text-primary">
                        {taxRates[tax.id]}%
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Policy Domain Accordions */}
        {[...byDomain.entries()].map(([domain, list]) => {
          const isExpanded = expandedDomains.has(domain);
          return (
            <section
              key={domain}
              className="rounded-xl border border-card-border bg-card overflow-hidden"
            >
              <button
                onClick={() => toggleDomain(domain)}
                className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-background/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold">{DOMAIN_LABELS[domain] ?? domain}</h2>
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted">
                    {list.length} {list.length === 1 ? "policy" : "policies"}
                  </span>
                </div>
                <svg
                  className={`h-5 w-5 text-muted transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {isExpanded && (
                <ul className="space-y-3 px-6 pb-6">
                  {list.map((r) => (
                    <li
                      key={r.legislationTypeId}
                      className="flex items-center justify-between gap-4 rounded-lg bg-background px-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground">{r.name}</span>
                          {r.enactedByKind === "order" && (
                            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                              Executive Order
                            </span>
                          )}
                        </div>
                        {r.policyOptionName ? (
                          <div className="mt-1 text-sm text-muted">
                            {r.enactedByKind === "order" ? "Active by order: " : "Current base: "}
                            <span className="text-foreground/90">{r.policyOptionName}</span>
                          </div>
                        ) : (
                          <div className="mt-0.5 text-xs text-muted">Policy area</div>
                        )}
                        {r.activeOrder && (
                          <div className="mt-0.5 text-xs text-muted/80">
                            Issued by {r.activeOrder.issuedByName} · T{r.activeOrder.issuedAtTurn} →
                            T{r.activeOrder.expiresAtTurn}
                          </div>
                        )}
                      </div>
                      <PositionBadges
                        economic={r.hasEconomic ? r.economic : undefined}
                        social={r.hasSocial ? r.social : undefined}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {/* Empty state */}
        {byDomain.size === 0 && !taxRates && (
          <div className="rounded-xl border border-card-border bg-card p-12 text-center text-muted">
            <svg
              className="mx-auto h-12 w-12 mb-4 opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="font-medium">No state-level policy has been set yet.</p>
            <p className="text-sm mt-1">
              Policy records will appear here once they are configured.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
