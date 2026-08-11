"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui";

interface WikiElectionSummary {
  id: string;
  electionType: string;
  state: string;
  stateName: string;
  senateClass?: number;
  cycle: number;
  totalSeats?: number;
  endTime: string;
  year: number;
  label: string;
}

function isYearKey(key: string): boolean {
  return /^\d{4}$/.test(key);
}

const TYPE_LABELS: Record<string, string> = {
  // US
  governor: "Governor",
  house: "House",
  senate: "Senate",
  stateSenate: "State Senate",
  president: "President",
  // UK
  commons: "House of Commons",
  primeMinister: "Prime Minister",
  regionalCouncil: "Regional Council",
  // JP
  shugiin: "House of Representatives (Shugiin)",
  sangiin: "House of Councillors (Sangiin)",
  // DE
  bundestag: "Bundestag",
  landtag: "Landtag",
  chancellor: "Chancellor",
  ministerPresident: "Minister-President",
  // IE
  dail: "Dáil Éireann",
  seanad: "Seanad Éireann",
  uachtaran: "Uachtarán (President)",
  localCouncil: "Local Council",
  // CN
  npcDelegate: "NPC Delegate",
  peoplesCongress: "People's Congress",
};

export default function WikiElectionsGroupPage({
  params,
}: {
  params: Promise<{ key1: string; key2: string }>;
}) {
  const { key1, key2 } = use(params);
  const [elections, setElections] = useState<WikiElectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isYear = isYearKey(key1);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("type", key2);
    if (isYear) params.set("year", key1);
    else params.set("state", key1);

    fetch(`/api/wiki/elections?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((data: { elections: WikiElectionSummary[] }) => {
        setElections(data.elections ?? []);
      })
      .catch(() => setError("Failed to load elections"))
      .finally(() => setLoading(false));
  }, [key1, key2, isYear]);

  const typeLabel = TYPE_LABELS[key2] ?? key2;
  const pageTitle = isYear
    ? `${key1} ${typeLabel} Elections`
    : elections[0]?.stateName
      ? `${elections[0].stateName} ${typeLabel} Elections`
      : `${key1} ${typeLabel} Elections`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/wiki" className="hover:text-foreground">
          Wiki
        </Link>
        <span aria-hidden>/</span>
        <Link href="/wiki/elections" className="hover:text-foreground">
          Elections
        </Link>
        <span aria-hidden>/</span>
        <span className="text-foreground">{pageTitle}</span>
      </nav>

      <header className="mb-10">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">{pageTitle}</h1>
        <p className="text-muted">
          {elections.length} completed election{elections.length !== 1 ? "s" : ""}
        </p>
      </header>

      {loading && (
        <div className="grid min-h-40 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-card-border bg-card/60 px-4 py-3"
            >
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-4" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center text-error">
          {error}
        </div>
      )}

      {!loading && !error && elections.length === 0 && (
        <div className="rounded-xl border border-card-border bg-card/40 p-8 text-center text-muted">
          No completed elections match this filter.
        </div>
      )}

      {!loading && !error && elections.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {elections.map((item) => (
            <Link
              key={item.id}
              href={`/wiki/elections/${item.id}`}
              className="flex items-center justify-between rounded-lg border border-card-border bg-card/60 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-card/80"
            >
              <span className="font-medium text-foreground">{item.label}</span>
              <span className="text-muted">→</span>
            </Link>
          ))}
        </div>
      )}

      <footer className="mt-10 border-t border-card-border pt-6">
        <Link href="/wiki/elections" className="text-sm text-muted hover:text-foreground">
          ← Back to Election History
        </Link>
      </footer>
    </div>
  );
}
