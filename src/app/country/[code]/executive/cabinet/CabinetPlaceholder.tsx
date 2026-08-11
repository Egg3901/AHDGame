"use client";

import Link from "next/link";
import type { CountryId } from "@/lib/constants/countries";

interface Props {
  countryId: CountryId;
  countryName: string;
}

export default function CabinetPlaceholder({ countryName }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-16 text-center">
        <div className="rounded-2xl border border-card-border bg-card p-12">
          <h1 className="text-2xl font-bold text-foreground">Cabinet</h1>
          <p className="mt-3 text-muted">The {countryName} cabinet simulation is coming soon.</p>
          <Link
            href="/world"
            className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            ← Back to World
          </Link>
        </div>
      </main>
    </div>
  );
}
