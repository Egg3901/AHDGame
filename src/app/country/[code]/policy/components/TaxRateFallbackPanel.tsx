"use client";

/**
 * State tax rates read straight from the region budget.
 *
 * A fallback only. Where a country's state taxes exist as catalog laws (the
 * five `us.tax.state*` rows), they arrive as ordinary `tax`-domain records and
 * the statute book renders them; showing this panel too listed every rate
 * twice. It survives for the countries whose state taxes are not catalog laws,
 * which would otherwise lose their tax display entirely.
 */

import type { StateTaxRates } from "@/lib/db/types/budget";

interface Row {
  id: keyof StateTaxRates;
  name: string;
  description: string;
}

const ROWS: Row[] = [
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

export function TaxRateFallbackPanel({ taxRates }: { taxRates: StateTaxRates }) {
  return (
    <section className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="bg-card-muted px-5 py-3">
        <span className="font-serif text-heading-sm font-semibold">Tax rates</span>
      </div>
      <ul className="space-y-3 px-5 py-4">
        {ROWS.map((tax) => (
          <li
            key={tax.id}
            className="flex items-center justify-between gap-4 rounded-lg bg-background px-3 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">{tax.name}</div>
              <div className="mt-0.5 text-xs text-muted">{tax.description}</div>
            </div>
            <span className="rounded border border-primary/40 bg-primary/10 px-3 py-1 text-lg font-bold text-primary">
              {taxRates[tax.id]}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default TaxRateFallbackPanel;
