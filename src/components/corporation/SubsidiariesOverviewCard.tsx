"use client";

import Link from "next/link";

interface Sub {
  _id: string;
  sequentialId?: number;
  name: string;
  ownershipPct: number;
}

export function SubsidiariesOverviewCard({ subsidiaries }: { subsidiaries: Sub[] }) {
  if (!subsidiaries.length) return null;

  return (
    <section className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      <h2 className="text-base font-bold text-foreground">Subsidiaries</h2>
      <p className="text-xs text-muted">
        Corporations where this company holds over 50% of outstanding shares as a corporate
        shareholder.
      </p>
      <ul className="divide-y divide-card-border rounded-lg border border-card-border overflow-hidden">
        {subsidiaries.map((s) => (
          <li
            key={s._id}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-card-elevated/40"
          >
            <Link
              href={`/corporation/${s.sequentialId ?? s._id}`}
              className="font-medium text-primary hover:underline min-w-0 truncate"
            >
              {s.name}
            </Link>
            <span className="text-xs tabular-nums text-muted shrink-0">
              {s.ownershipPct.toFixed(1)}% owned
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
